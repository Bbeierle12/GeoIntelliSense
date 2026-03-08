"""
Live data context builder for Claude AI endpoints.

Assembles a snapshot of all available real-time and recent data so Claude
can reason from LIVE conditions rather than training data.
"""

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from app.database import get_pool
from app.cache import get_redis

logger = logging.getLogger(__name__)

# Expected update intervals (seconds) — staleness = 2x this
SOURCE_INTERVALS = {
    "purpleair": 120,       # PurpleAir fetcher runs every 2 min
    "airnow": 3600,         # AirNow updates hourly
    "nws_forecast": 3600,   # NWS forecast cached 1 hour
    "fires": 1800,          # FIRMS polling every 30 min
    "earthquakes": 300,     # USGS earthquake poller every 5 min
    "water": 900,           # USGS water polling every 15 min
    "enviroscreen": 604800, # Static dataset, 7-day cache
    "inversion": 1800,      # Inversion polling every 30 min
}


def _freshness(last_updated: datetime | None, source: str) -> dict[str, Any]:
    """Return freshness metadata for a data source."""
    if last_updated is None:
        return {"lastUpdated": None, "stale": True, "status": "unavailable"}

    now = datetime.now(timezone.utc)
    if last_updated.tzinfo is None:
        last_updated = last_updated.replace(tzinfo=timezone.utc)

    age_seconds = (now - last_updated).total_seconds()
    interval = SOURCE_INTERVALS.get(source, 3600)
    stale = age_seconds > interval * 2

    return {
        "lastUpdated": last_updated.isoformat(),
        "ageSeconds": int(age_seconds),
        "stale": stale,
        "status": "stale" if stale else "live",
    }


async def build_live_context() -> dict[str, Any]:
    """Assemble a JSON context object with all available live data."""
    pool = await get_pool()
    context: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": {},
    }

    # Run all queries concurrently-ish (asyncpg handles connection pooling)
    context["aqi"] = await _get_aqi_context(pool)
    context["forecast"] = await _get_forecast_context(pool)
    context["fires"] = await _get_fire_context(pool)
    context["earthquakes"] = await _get_earthquake_context(pool)
    context["water"] = await _get_water_context(pool)
    context["enviroscreen"] = await _get_enviroscreen_context(pool)
    context["inversion"] = _get_inversion_context()
    context["prediction"] = await _get_prediction_context(pool)

    return context


async def build_context_text() -> str:
    """Build a human-readable context string for injection into system prompts."""
    ctx = await build_live_context()
    lines = ["=== LIVE DATA CONTEXT (do NOT use training data when this is available) ==="]
    lines.append(f"Generated: {ctx['generatedAt']}")
    lines.append("")

    # Data freshness summary
    sources = ctx.get("sources", {})
    live_sources = [s for s, info in sources.items() if info.get("status") == "live"]
    stale_sources = [s for s, info in sources.items() if info.get("status") == "stale"]
    unavailable = [s for s, info in sources.items() if info.get("status") == "unavailable"]

    if live_sources:
        lines.append(f"LIVE data sources: {', '.join(live_sources)}")
    if stale_sources:
        lines.append(f"STALE data sources (may be outdated): {', '.join(stale_sources)}")
    if unavailable:
        lines.append(f"UNAVAILABLE data sources: {', '.join(unavailable)}")
    lines.append("")

    # AQI
    aqi = ctx.get("aqi", {})
    if aqi.get("readings"):
        lines.append("── Current Air Quality ──")
        for r in aqi["readings"]:
            lines.append(f"  {r['station']}: AQI {r['aqi']} ({r['category']}) PM2.5={r['pm25']}µg/m³ [source: {r['source']}]")
        lines.append("")

    # Forecast
    forecast = ctx.get("forecast", {})
    if forecast.get("periods"):
        lines.append("── NWS Weather Forecast ──")
        for p in forecast["periods"][:4]:  # Next 2 day/night periods
            lines.append(f"  {p['name']}: {p['temp']}°F — {p['conditions']}")
        lines.append("")

    # Fires
    fires = ctx.get("fires", {})
    if fires.get("count", 0) > 0:
        lines.append("── Active Fire Detections ──")
        lines.append(f"  {fires['count']} active detections within 200km")
        lines.append(f"  Upwind fires: {fires.get('upwindCount', 0)}")
        lines.append(f"  Smoke risk: {fires.get('smokeRisk', 'unknown')}")
        if fires.get("nearest"):
            n = fires["nearest"]
            lines.append(f"  Nearest: {n['distanceKm']}km away, FRP={n.get('frp', '?')} MW, confidence={n.get('confidence', '?')}")
        lines.append("")

    # Earthquakes
    quakes = ctx.get("earthquakes", {})
    if quakes.get("count", 0) > 0:
        lines.append("── Recent Seismic Activity (7 days) ──")
        lines.append(f"  {quakes['count']} events (M≥2.0 within 200km)")
        if quakes.get("largest"):
            lg = quakes["largest"]
            lines.append(f"  Largest: M{lg['magnitude']} at {lg['place']} ({lg['distanceKm']}km away, {lg['time']})")
        lines.append("")

    # Water
    water = ctx.get("water", {})
    if water.get("stations"):
        lines.append("── Water Levels ──")
        for s in water["stations"]:
            lines.append(f"  {s['name']}: {s['value']} {s['unit']} (discharge) [{s['status']}]")
        lines.append("")

    # EnviroScreen
    ces = ctx.get("enviroscreen", {})
    if ces.get("summary"):
        s = ces["summary"]
        lines.append("── Environmental Justice (CalEnviroScreen) ──")
        lines.append(f"  Kern County tracts: {s.get('tractCount', '?')}")
        lines.append(f"  Avg CES percentile: {s.get('avgCesPercentile', '?')}")
        lines.append(f"  High-burden tracts (≥75th pctl): {s.get('highBurdenCount', '?')}")
        lines.append("")

    # Inversion
    inv = ctx.get("inversion", {})
    if inv.get("status"):
        s = inv["status"]
        strength = s.get("inversionStrength", "unknown")
        lines.append("── Temperature Inversion Status ──")
        lines.append(f"  Inversion: {strength.upper()}")
        if s.get("tempDiffC") is not None:
            lines.append(f"  850mb - surface temp diff: {s['tempDiffC']}°C")
        if s.get("surfaceTempF") is not None:
            lines.append(f"  Surface temp: {s['surfaceTempF']}°F")
        if s.get("fogLikely"):
            lines.append("  TULE FOG CONDITIONS LIKELY — near-zero visibility expected in valley")
        if strength in ("moderate", "strong"):
            lines.append("  *** Pollutant trapping active — AQI readings should be interpreted with this in mind ***")
        lines.append("")

    # ML Prediction
    pred = ctx.get("prediction", {})
    if pred.get("predictedAqi") is not None:
        lines.append("── Local AQI Prediction (24h) ──")
        lines.append(f"  Predicted AQI: {pred['predictedAqi']} ({pred.get('category', '?')})")
        ci = pred.get("confidenceInterval", {})
        if ci:
            lines.append(f"  95% confidence: {ci.get('low', '?')}–{ci.get('high', '?')}")
        if pred.get("topFactors"):
            top3 = pred["topFactors"][:3]
            factor_strs = [f"{f['feature']}({f['importance']:.0%})" for f in top3]
            lines.append(f"  Top drivers: {', '.join(factor_strs)}")
        lines.append(f"  Model R²: {pred.get('modelR2', '?')}, MAE: {pred.get('modelMAE', '?')}")
        if pred.get("airnowComparison"):
            an = pred["airnowComparison"]
            lines.append(f"  AirNow forecast for comparison: AQI {an.get('aqi', '?')} ({an.get('category', '?')})")
        lines.append("")

    if stale_sources:
        lines.append("⚠ IMPORTANT: Stale data sources may not reflect current conditions.")
        lines.append("  Caveat any analysis that depends on stale sources.")
        lines.append("")

    return "\n".join(lines)


# ── Data Source Fetchers ────────────────────────────────

async def _get_aqi_context(pool) -> dict[str, Any]:
    """Get latest AQI readings from DB (PurpleAir + AirNow)."""
    readings = []
    last_updated = None

    try:
        rows = await pool.fetch(
            """
            SELECT DISTINCT ON (location_id)
                l.name AS station, sr.aqi, sr.pm25, sr.category, sr.source, sr.time
            FROM sensor_readings sr
            JOIN locations l ON l.id = sr.location_id
            WHERE sr.time > now() - interval '1 hour'
            ORDER BY location_id, sr.time DESC
            """
        )

        for r in rows:
            readings.append({
                "station": r["station"],
                "aqi": r["aqi"],
                "pm25": round(r["pm25"], 1) if r["pm25"] else None,
                "category": r["category"],
                "source": r["source"] or "unknown",
            })
            if last_updated is None or r["time"] > last_updated:
                last_updated = r["time"]

    except Exception as e:
        logger.warning("AQI context fetch failed: %s", e)

    # Determine source type for freshness
    source_type = "purpleair"
    if readings and all(r["source"] == "airnow" for r in readings):
        source_type = "airnow"

    freshness = _freshness(last_updated, source_type)
    # Store in sources dict (will be added to context by caller)
    return {"readings": readings, "freshness": freshness, "_source": source_type}


async def _get_forecast_context(pool) -> dict[str, Any]:
    """Get cached NWS forecast from Redis."""
    periods = []

    try:
        # Check Redis cache for NWS forecast (same key the nws_forecast route uses)
        r = await get_redis()
        import json
        # Try to find any forecast cache key
        keys = []
        async for key in r.scan_iter("geointelli:analytics:forecast:*"):
            keys.append(key)
            break  # Just need one

        if keys:
            val = await r.get(keys[0])
            if val:
                cached = json.loads(val)
                # cached is a list of forecast records
                if isinstance(cached, list):
                    for p in cached[:6]:
                        periods.append({
                            "name": p.get("conditions", ""),
                            "temp": p.get("tempHigh") or p.get("tempLow"),
                            "conditions": p.get("conditions", ""),
                            "wind": p.get("windSpeed", ""),
                            "precipProbability": p.get("precipProbability", 0),
                            "date": p.get("date", ""),
                        })

    except Exception as e:
        logger.warning("Forecast context fetch failed: %s", e)

    # NWS forecast freshness — use the date of the first period if available
    last_updated = None
    if periods and periods[0].get("date"):
        try:
            last_updated = datetime.fromisoformat(periods[0]["date"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            pass

    return {"periods": periods, "freshness": _freshness(last_updated, "nws_forecast")}


async def _get_fire_context(pool) -> dict[str, Any]:
    """Get active fire detections."""
    result: dict[str, Any] = {"count": 0}

    try:
        # Count + nearest + upwind from DB
        row = await pool.fetchrow(
            """
            SELECT
                COUNT(*) AS cnt,
                SUM(CASE WHEN ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(-119.0187, 35.3733), 4326)::geography) / 1000 < 200 THEN 1 ELSE 0 END) AS nearby,
                MAX(time) AS last_time
            FROM fire_detections
            WHERE time > now() - interval '48 hours'
            """
        )

        if row and row["cnt"] > 0:
            result["count"] = row["nearby"] or 0
            last_time = row["last_time"]

            # Get nearest fire
            nearest = await pool.fetchrow(
                """
                SELECT latitude, longitude, brightness, frp, confidence, satellite, time,
                       ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(-119.0187, 35.3733), 4326)::geography) / 1000 AS dist_km
                FROM fire_detections
                WHERE time > now() - interval '48 hours'
                ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint(-119.0187, 35.3733), 4326)::geography
                LIMIT 1
                """
            )

            if nearest:
                result["nearest"] = {
                    "distanceKm": round(nearest["dist_km"], 1),
                    "frp": nearest["frp"],
                    "confidence": nearest["confidence"],
                    "satellite": nearest["satellite"],
                }

            # Get smoke context from the fire polling module
            try:
                from app.routes.fires import get_current_smoke_context
                smoke = get_current_smoke_context()
                if smoke:
                    # Parse upwind/smoke risk from the smoke context string
                    result["smokeRisk"] = "high" if "ACTIVE FIRE" in smoke.upper() else "moderate"
                    upwind_lines = [l for l in smoke.split("\n") if "upwind" in l.lower()]
                    result["upwindCount"] = len(upwind_lines)
            except Exception:
                result["smokeRisk"] = "unknown"
                result["upwindCount"] = 0

            result["freshness"] = _freshness(last_time, "fires")
        else:
            result["freshness"] = _freshness(None, "fires")

    except Exception as e:
        logger.warning("Fire context fetch failed: %s", e)
        result["freshness"] = _freshness(None, "fires")

    return result


async def _get_earthquake_context(pool) -> dict[str, Any]:
    """Get recent seismic activity."""
    result: dict[str, Any] = {"count": 0}

    try:
        rows = await pool.fetch(
            """
            SELECT event_id, time, magnitude, place,
                   ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(-119.0187, 35.3733), 4326)::geography) / 1000 AS dist_km
            FROM earthquake_events
            WHERE time > now() - interval '7 days'
              AND magnitude >= 2.0
            ORDER BY magnitude DESC
            LIMIT 20
            """
        )

        last_time = None
        events = []
        for r in rows:
            if r["dist_km"] <= 200:
                events.append({
                    "magnitude": r["magnitude"],
                    "place": r["place"],
                    "distanceKm": round(r["dist_km"], 1),
                    "time": r["time"].isoformat(),
                })
            if last_time is None or r["time"] > last_time:
                last_time = r["time"]

        result["count"] = len(events)
        if events:
            result["largest"] = events[0]  # Already sorted by magnitude DESC

        result["freshness"] = _freshness(last_time, "earthquakes")

    except Exception as e:
        logger.warning("Earthquake context fetch failed: %s", e)
        result["freshness"] = _freshness(None, "earthquakes")

    return result


async def _get_water_context(pool) -> dict[str, Any]:
    """Get latest water station readings."""
    stations = []
    last_updated = None

    try:
        rows = await pool.fetch(
            """
            SELECT DISTINCT ON (site_id)
                site_id, site_name, value, unit, time
            FROM water_readings
            WHERE time > now() - interval '2 hours'
              AND parameter = 'discharge'
            ORDER BY site_id, time DESC
            """
        )

        for r in rows:
            val = r["value"]
            # Classify flow status
            status = "normal"
            if val is not None:
                if val < 10:
                    status = "low"
                elif val > 1000:
                    status = "high"

            stations.append({
                "siteNo": r["site_id"],
                "name": r["site_name"],
                "value": round(val, 1) if val else None,
                "unit": r["unit"] or "cfs",
                "status": status,
            })
            if last_updated is None or r["time"] > last_updated:
                last_updated = r["time"]

    except Exception as e:
        logger.warning("Water context fetch failed: %s", e)

    return {"stations": stations, "freshness": _freshness(last_updated, "water")}


async def _get_enviroscreen_context(pool) -> dict[str, Any]:
    """Get CalEnviroScreen summary for Kern County."""
    summary = None

    try:
        row = await pool.fetchrow(
            """
            SELECT
                COUNT(*) AS tract_count,
                ROUND(AVG(ces_percentile)::numeric, 1) AS avg_ces_pctl,
                SUM(CASE WHEN ces_percentile >= 75 THEN 1 ELSE 0 END) AS high_burden,
                ROUND(AVG(pm25_pctl)::numeric, 1) AS avg_pm25_pctl,
                ROUND(AVG(poverty_pctl)::numeric, 1) AS avg_poverty_pctl
            FROM census_tracts
            WHERE county = 'Kern'
            """
        )

        if row and row["tract_count"] > 0:
            summary = {
                "tractCount": row["tract_count"],
                "avgCesPercentile": float(row["avg_ces_pctl"]) if row["avg_ces_pctl"] else None,
                "highBurdenCount": row["high_burden"],
                "avgPm25Percentile": float(row["avg_pm25_pctl"]) if row["avg_pm25_pctl"] else None,
                "avgPovertyPercentile": float(row["avg_poverty_pctl"]) if row["avg_poverty_pctl"] else None,
            }

    except Exception as e:
        logger.warning("EnviroScreen context fetch failed: %s", e)

    # CES is a static dataset, check if any data exists
    freshness = _freshness(datetime.now(timezone.utc), "enviroscreen") if summary else _freshness(None, "enviroscreen")

    return {"summary": summary, "freshness": freshness}


def _get_inversion_context() -> dict[str, Any]:
    """Get current inversion status from the polling module."""
    status = None
    try:
        from app.routes.inversion import get_current_inversion
        status = get_current_inversion()
    except Exception as e:
        logger.warning("Inversion context fetch failed: %s", e)

    if status:
        # Parse last update time for freshness
        last_updated = None
        time_str = status.get("time")
        if time_str:
            try:
                last_updated = datetime.fromisoformat(time_str)
            except (ValueError, AttributeError):
                pass
        return {"status": status, "freshness": _freshness(last_updated, "inversion")}

    return {"status": None, "freshness": _freshness(None, "inversion")}


async def _get_prediction_context(pool) -> dict[str, Any]:
    """Get the latest AQI prediction from the ML model."""
    try:
        from app.ml.aqi_model import predict_aqi, get_model
        model, _ = get_model()
        if model is None:
            return {}

        result = await predict_aqi(pool)
        return result or {}
    except Exception as e:
        logger.warning("Prediction context fetch failed: %s", e)
        return {}
