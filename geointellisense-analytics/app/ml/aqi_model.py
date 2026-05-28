"""
Local AQI prediction model using gradient boosting.

Predicts AQI 24 hours from now based on:
- Current AQI and PM2.5
- Temperature, wind speed/direction, humidity
- Fire detections within 200km
- Inversion status (none=0, weak=1, moderate=2, strong=3)
- Day of week, month (seasonality)

Trained on joined historical data from TimescaleDB hypertables.
"""

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np

logger = logging.getLogger(__name__)

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/app/data/models"))
MODEL_PATH = MODEL_DIR / "aqi_gbr.joblib"
META_PATH = MODEL_DIR / "aqi_gbr_meta.joblib"

FEATURE_NAMES = [
    "aqi",
    "pm25",
    "temperature",
    "humidity",
    "wind_speed",
    "wind_direction_sin",
    "wind_direction_cos",
    "fire_count_200km",
    "fire_total_frp",
    "inversion_strength",
    "day_of_week",
    "month",
    "hour",
]

INVERSION_MAP = {"none": 0, "weak": 1, "moderate": 2, "strong": 3}

# In-memory model cache
_model = None
_model_meta: dict[str, Any] = {}


def get_model():
    """Load model from disk if not already cached."""
    global _model, _model_meta

    if _model is not None:
        return _model, _model_meta

    if MODEL_PATH.exists():
        _model = joblib.load(MODEL_PATH)
        if META_PATH.exists():
            _model_meta = joblib.load(META_PATH)
        logger.info("AQI model loaded from disk (trained: %s)", _model_meta.get("trained_at", "unknown"))
        return _model, _model_meta

    return None, {}


def get_model_status() -> dict[str, Any]:
    """Get model status without loading it."""
    model, meta = get_model()
    return {
        "trained": model is not None,
        "trainedAt": meta.get("trained_at"),
        "trainingSamples": meta.get("n_samples"),
        "r2Score": meta.get("r2_score"),
        "mae": meta.get("mae"),
        "featureImportance": meta.get("feature_importance"),
    }


async def build_training_data(pool, min_days: int = 30) -> tuple[np.ndarray, np.ndarray] | None:
    """Build feature matrix and target vector from historical TimescaleDB data.

    Joins sensor_readings, fire_detections, and inversion_events.
    Target: AQI 24 hours later at the same location.
    """
    rows = await pool.fetch(
        """
        WITH hourly_aqi AS (
            SELECT
                time_bucket('1 hour', sr.time) AS bucket,
                AVG(sr.aqi) AS aqi,
                AVG(sr.pm25) AS pm25,
                AVG(sr.temperature) AS temperature,
                AVG(sr.humidity) AS humidity,
                AVG(sr.wind_speed) AS wind_speed,
                AVG(sr.wind_direction) AS wind_direction
            FROM sensor_readings sr
            WHERE sr.time > now() - make_interval(days => $1)
              AND sr.aqi IS NOT NULL
              AND sr.aqi > 0
            GROUP BY bucket
        ),
        hourly_fires AS (
            SELECT
                time_bucket('1 hour', fd.time) AS bucket,
                COUNT(*) AS fire_count,
                COALESCE(SUM(fd.frp), 0) AS total_frp
            FROM fire_detections fd
            WHERE fd.time > now() - make_interval(days => $1)
              AND ST_DWithin(
                  fd.geom::geography,
                  ST_SetSRID(ST_MakePoint(-119.0187, 35.3733), 4326)::geography,
                  200000
              )
            GROUP BY bucket
        ),
        hourly_inversion AS (
            SELECT
                time_bucket('1 hour', ie.time) AS bucket,
                MAX(CASE
                    WHEN ie.inversion_strength = 'strong' THEN 3
                    WHEN ie.inversion_strength = 'moderate' THEN 2
                    WHEN ie.inversion_strength = 'weak' THEN 1
                    ELSE 0
                END) AS inversion
            FROM inversion_events ie
            WHERE ie.time > now() - make_interval(days => $1)
            GROUP BY bucket
        )
        SELECT
            a.bucket,
            a.aqi, a.pm25, a.temperature, a.humidity, a.wind_speed, a.wind_direction,
            COALESCE(f.fire_count, 0) AS fire_count,
            COALESCE(f.total_frp, 0) AS total_frp,
            COALESCE(i.inversion, 0) AS inversion,
            EXTRACT(dow FROM a.bucket) AS dow,
            EXTRACT(month FROM a.bucket) AS month,
            EXTRACT(hour FROM a.bucket) AS hour
        FROM hourly_aqi a
        LEFT JOIN hourly_fires f ON a.bucket = f.bucket
        LEFT JOIN hourly_inversion i ON a.bucket = i.bucket
        ORDER BY a.bucket
        """,
        min_days,
    )

    if len(rows) < 48:  # Need at least 2 days of data
        logger.warning("Insufficient training data: %d rows (need >= 48)", len(rows))
        return None

    # Build feature/target pairs: features at time T, target = AQI at T+24h
    features = []
    targets = []

    # Index rows by bucket for O(1) lookup
    row_map = {}
    for r in rows:
        row_map[r["bucket"]] = r

    from datetime import timedelta

    for r in rows:
        bucket = r["bucket"]
        future_bucket = bucket + timedelta(hours=24)

        if future_bucket not in row_map:
            continue

        future_aqi = row_map[future_bucket]["aqi"]
        if future_aqi is None:
            continue

        wd = r["wind_direction"] or 0
        wd_rad = np.radians(wd)

        feat = [
            r["aqi"] or 0,
            r["pm25"] or 0,
            r["temperature"] or 20,
            r["humidity"] or 50,
            r["wind_speed"] or 0,
            np.sin(wd_rad),
            np.cos(wd_rad),
            r["fire_count"],
            r["total_frp"],
            r["inversion"],
            r["dow"],
            r["month"],
            r["hour"],
        ]
        features.append(feat)
        targets.append(future_aqi)

    if len(features) < 24:
        logger.warning("Too few training pairs: %d (need >= 24)", len(features))
        return None

    return np.array(features, dtype=np.float32), np.array(targets, dtype=np.float32)


async def train_model(pool) -> dict[str, Any]:
    """Train the gradient boosting model on historical data."""
    global _model, _model_meta

    from sklearn.ensemble import GradientBoostingRegressor
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import mean_absolute_error, r2_score

    result = await build_training_data(pool)
    if result is None:
        return {"error": "Insufficient training data"}

    X, y = result

    # Train/test split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # Gradient Boosting — interpretable, handles mixed feature types well
    model = GradientBoostingRegressor(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.05,
        min_samples_leaf=5,
        subsample=0.8,
        random_state=42,
    )

    t0 = time.time()
    model.fit(X_train, y_train)
    train_time = time.time() - t0

    # Evaluate
    y_pred = model.predict(X_test)
    r2 = r2_score(y_test, y_pred)
    mae = mean_absolute_error(y_test, y_pred)

    # Feature importance
    importances = dict(zip(FEATURE_NAMES, [round(float(x), 4) for x in model.feature_importances_]))

    meta = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": len(X),
        "n_train": len(X_train),
        "n_test": len(X_test),
        "r2_score": round(r2, 4),
        "mae": round(mae, 2),
        "train_time_secs": round(train_time, 2),
        "feature_importance": importances,
    }

    # Save
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    joblib.dump(meta, META_PATH)

    _model = model
    _model_meta = meta

    logger.info("AQI model trained: R²=%.4f, MAE=%.2f, samples=%d, time=%.1fs", r2, mae, len(X), train_time)
    return meta


async def predict_aqi(pool) -> dict[str, Any] | None:
    """Predict AQI 24 hours from now using current conditions."""
    model, meta = get_model()
    if model is None:
        return None

    # Gather current features from DB
    features = await _get_current_features(pool)
    if features is None:
        return None

    X = np.array([features], dtype=np.float32)

    # Point prediction
    predicted = float(model.predict(X)[0])
    predicted = max(0, round(predicted))

    # Confidence interval via individual tree predictions (for GBR)
    # GBR stages predictions cumulatively — use staged_predict for variance estimate
    staged = np.array([float(p) for p in model.staged_predict(X)])
    # Use last 50 estimators' incremental changes as variance proxy
    if len(staged) > 50:
        increments = np.diff(staged[-50:])
        std_estimate = np.std(increments) * np.sqrt(50)
    else:
        std_estimate = max(predicted * 0.15, 5)  # Fallback: 15% of prediction

    ci_low = max(0, round(predicted - 1.96 * std_estimate))
    ci_high = round(predicted + 1.96 * std_estimate)

    # Feature contributions (approximate via feature importance * deviation from mean)
    importances = meta.get("feature_importance", {})
    top_factors = sorted(importances.items(), key=lambda x: -x[1])[:5]

    return {
        "predictedAqi": predicted,
        "confidenceInterval": {"low": ci_low, "high": ci_high},
        "category": _aqi_category(predicted),
        "horizon": "24 hours",
        "modelR2": meta.get("r2_score"),
        "modelMAE": meta.get("mae"),
        "trainedAt": meta.get("trained_at"),
        "topFactors": [{"feature": f, "importance": round(imp, 4)} for f, imp in top_factors],
        "currentFeatures": dict(zip(FEATURE_NAMES, [round(float(v), 2) for v in features])),
    }


async def _get_current_features(pool) -> list[float] | None:
    """Assemble current feature vector from live data."""
    # Latest AQI/weather
    aqi_row = await pool.fetchrow(
        """
        SELECT AVG(aqi) AS aqi, AVG(pm25) AS pm25,
               AVG(temperature) AS temperature, AVG(humidity) AS humidity,
               AVG(wind_speed) AS wind_speed, AVG(wind_direction) AS wind_direction
        FROM sensor_readings
        WHERE time > now() - interval '2 hours'
          AND aqi IS NOT NULL AND aqi > 0
        """
    )

    if not aqi_row or aqi_row["aqi"] is None:
        return None

    # Fire count within 200km
    fire_row = await pool.fetchrow(
        """
        SELECT COUNT(*) AS fire_count, COALESCE(SUM(frp), 0) AS total_frp
        FROM fire_detections
        WHERE time > now() - interval '48 hours'
          AND ST_DWithin(
              geom::geography,
              ST_SetSRID(ST_MakePoint(-119.0187, 35.3733), 4326)::geography,
              200000
          )
        """
    )

    # Latest inversion
    inv_row = await pool.fetchrow(
        "SELECT inversion_strength FROM inversion_events WHERE time > now() - interval '6 hours' ORDER BY time DESC LIMIT 1"
    )

    now = datetime.now(timezone.utc)
    wd = aqi_row["wind_direction"] or 0
    wd_rad = np.radians(wd)

    return [
        float(aqi_row["aqi"] or 0),
        float(aqi_row["pm25"] or 0),
        float(aqi_row["temperature"] or 20),
        float(aqi_row["humidity"] or 50),
        float(aqi_row["wind_speed"] or 0),
        float(np.sin(wd_rad)),
        float(np.cos(wd_rad)),
        float(fire_row["fire_count"]) if fire_row else 0,
        float(fire_row["total_frp"]) if fire_row else 0,
        float(INVERSION_MAP.get(inv_row["inversion_strength"], 0)) if inv_row else 0,
        float(now.weekday()),
        float(now.month),
        float(now.hour),
    ]


def _aqi_category(aqi: int) -> str:
    if aqi <= 50:
        return "Good"
    if aqi <= 100:
        return "Moderate"
    if aqi <= 150:
        return "Unhealthy for Sensitive Groups"
    if aqi <= 200:
        return "Unhealthy"
    if aqi <= 300:
        return "Very Unhealthy"
    return "Hazardous"
