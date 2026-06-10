import asyncio
import logging
import traceback
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from app.cache import get_cached, set_cached, cache_headers
from app.database import get_pool
from app.middleware import check_admin_auth
from app.ml.aqi_model import predict_aqi, train_model, get_model_status, get_model

router = APIRouter()
logger = logging.getLogger(__name__)

PREDICT_TTL = 1800   # 30 min — re-predict with fresher features
MODEL_TTL = 604800   # 7 days — retrain weekly

# Background training state
_train_task: asyncio.Task | None = None
_train_status: dict[str, Any] = {"state": "idle"}

# Weekly retrain task
_retrain_task: asyncio.Task | None = None


async def start_retrain_scheduler():
    """Start weekly model retraining background task."""
    global _retrain_task
    if _retrain_task and not _retrain_task.done():
        return
    _retrain_task = asyncio.create_task(_retrain_loop())
    logger.info("AQI model retrain scheduler started (weekly)")


async def _retrain_loop():
    while True:
        # Wait 7 days between retrains
        await asyncio.sleep(604800)

        try:
            pool = await get_pool()
            meta = await train_model(pool)
            if "error" not in meta:
                logger.info("Weekly AQI model retrain complete: R²=%.4f", meta.get("r2_score", 0))
            else:
                logger.warning("Weekly retrain skipped: %s", meta["error"])
        except Exception as e:
            logger.error("Weekly retrain failed: %s", e)


@router.get("/api/predict/aqi")
async def aqi_prediction():
    """24-hour AQI forecast with confidence interval.

    Returns the model's prediction based on current conditions.
    Falls back to cached prediction if the model hasn't been trained yet.
    """
    cached, hit = await get_cached("predict-aqi", "current")
    if cached is not None:
        return JSONResponse(content=cached, headers=cache_headers(hit, PREDICT_TTL))

    model, _ = get_model()
    if model is None:
        return JSONResponse(
            status_code=503,
            content={
                "error": "Model not trained yet",
                "hint": "POST /api/predict/train to train the model",
                "status": get_model_status(),
            },
        )

    pool = await get_pool()

    try:
        result = await predict_aqi(pool)
        if result is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Insufficient current data for prediction"},
            )

        # Try to get AirNow forecast for comparison
        comparison = await _get_airnow_comparison(pool)
        if comparison:
            result["airnowComparison"] = comparison

        await set_cached("predict-aqi", "current", result, PREDICT_TTL)
        return JSONResponse(content=result, headers=cache_headers(False, PREDICT_TTL))

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": "Prediction failed", "details": str(e)},
        )


@router.get("/api/predict/factors")
async def prediction_factors():
    """Feature importance — which factors drive the current AQI prediction."""
    status = get_model_status()
    if not status["trained"]:
        return JSONResponse(
            status_code=503,
            content={"error": "Model not trained yet", "hint": "POST /api/predict/train"},
        )

    importances = status.get("featureImportance", {})

    # Sort by importance
    ranked = sorted(importances.items(), key=lambda x: -x[1])

    # Human-readable factor descriptions
    descriptions = {
        "aqi": "Current AQI level",
        "pm25": "Current PM2.5 concentration",
        "temperature": "Air temperature",
        "humidity": "Relative humidity",
        "wind_speed": "Wind speed (higher = better dispersion)",
        "wind_direction_sin": "Wind direction (N-S component)",
        "wind_direction_cos": "Wind direction (E-W component)",
        "fire_count_200km": "Active fires within 200km",
        "fire_total_frp": "Total fire radiative power (fire intensity)",
        "inversion_strength": "Temperature inversion (traps pollutants)",
        "day_of_week": "Day of week (weekday traffic/industry)",
        "month": "Month (seasonal patterns)",
        "hour": "Hour of day",
    }

    factors = []
    for name, importance in ranked:
        factors.append({
            "feature": name,
            "importance": importance,
            "pctContribution": round(importance * 100, 1),
            "description": descriptions.get(name, name),
        })

    return {
        "modelR2": status["r2Score"],
        "modelMAE": status["mae"],
        "trainedAt": status["trainedAt"],
        "trainingSamples": status["trainingSamples"],
        "factors": factors,
    }


@router.get("/api/predict/status")
async def model_status():
    """Current model status and training info."""
    return get_model_status()


@router.post("/api/predict/train")
async def start_training(
    request: Request,
    min_days: int = Query(90, ge=7, le=730, description="Minimum days of history to train on"),
):
    """Train or retrain the AQI prediction model.

    Runs as a background task — poll /api/predict/train/status for progress.
    """
    global _train_task, _train_status

    auth_err = check_admin_auth(request)
    if auth_err:
        return auth_err

    if _train_task and not _train_task.done():
        return JSONResponse(
            status_code=409,
            content={"error": "Training already in progress", "status": _train_status},
        )

    _train_status = {"state": "running", "minDays": min_days}
    _train_task = asyncio.create_task(_run_training(min_days))
    return {"message": "Model training started", "status": _train_status}


@router.get("/api/predict/train/status")
async def training_status():
    return _train_status


async def _run_training(min_days: int) -> None:
    global _train_status

    try:
        pool = await get_pool()
        meta = await train_model(pool)
        _train_status = {**_train_status, "state": "completed", "result": meta}
        logger.info("AQI model training complete")
    except Exception as e:
        traceback.print_exc()
        _train_status = {**_train_status, "state": "failed", "error": str(e)}


# ── Helpers ──────────────────────────────────────────

async def _get_airnow_comparison(pool) -> dict[str, Any] | None:
    """Get AirNow's forecast for comparison (if cached)."""
    try:
        cached, _ = await get_cached("airnow-forecast", "all")
        if cached and cached.get("forecasts"):
            # Find Bakersfield forecast
            for f in cached["forecasts"]:
                if "bakersfield" in f.get("stationName", "").lower():
                    return {
                        "source": "AirNow EPA",
                        "aqi": f.get("aqi"),
                        "category": f.get("category"),
                        "date": f.get("date"),
                        "parameter": f.get("parameter"),
                    }
    except Exception:
        pass
    return None


def get_current_prediction() -> dict[str, Any] | None:
    """Called by AI context builder."""
    model, meta = get_model()
    if model is None:
        return None
    return {
        "trained": True,
        "r2Score": meta.get("r2_score"),
        "mae": meta.get("mae"),
        "trainedAt": meta.get("trained_at"),
    }
