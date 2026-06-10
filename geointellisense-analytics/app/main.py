from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import get_pool, close_pool
from app.cache import get_redis, close_redis
from app.routes.health import router as health_router
from app.routes.chat import router as chat_router
from app.routes.grounded_search import router as grounded_search_router
from app.routes.grounded_maps import router as grounded_maps_router
from app.routes.low_latency import router as low_latency_router
from app.routes.deep_analysis import router as deep_analysis_router
from app.routes.predictive_analysis import router as predictive_analysis_router
from app.routes.weather_forecast import router as weather_forecast_router
from app.routes.historical_aqi import router as historical_aqi_router
from app.routes.historical_weather import router as historical_weather_router
from app.routes.nws_forecast import router as nws_forecast_router
from app.routes.maps_config import router as maps_config_router
from app.routes.epa_aqi import router as epa_aqi_router
from app.routes.earthquakes import router as earthquakes_router
from app.routes.airnow import router as airnow_router
from app.routes.weather_historical import router as weather_historical_router
from app.routes.calgem import router as calgem_router
from app.routes.enviroscreen import router as enviroscreen_router
from app.routes.sentinel import router as sentinel_router
from app.routes.water import router as water_router, start_water_polling
from app.routes.fires import router as fires_router, start_fire_polling
from app.routes.traffic import router as traffic_router
from app.routes.cropscape import router as cropscape_router
from app.routes.elevation import router as elevation_router
from app.routes.landsat import router as landsat_router
from app.routes.inversion import router as inversion_router, start_inversion_polling
from app.routes.water_quality import router as water_quality_router
from app.routes.predict import router as predict_router, start_retrain_scheduler
from app.routes.explore import router as explore_router
from app.routes.ai_context import router as ai_context_router
from app.routes.demographics import router as demographics_router
from app.routes.yard import router as yard_router
from app.routes.yard_context import router as yard_context_router
from app.routes.soil import router as soil_router
from app.routes.admin import router as admin_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    await get_redis()
    await start_water_polling()
    await start_fire_polling()
    await start_inversion_polling()
    await start_retrain_scheduler()
    yield
    await close_redis()
    await close_pool()


app = FastAPI(title="GeoIntelliSense Analytics", version="0.1.0", lifespan=lifespan)

# CORS — restrict to known origins in production
_allowed_origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:8080",
]
# Allow all origins only if no admin token is set (dev mode)
if not settings.admin_token:
    _allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "x-api-key", "x-admin-token"],
    # Wildcard origins + credentials is forbidden by the CORS spec; auth uses
    # the x-api-key header, which does not require credentialed requests.
    allow_credentials="*" not in _allowed_origins,
)

app.include_router(health_router)
app.include_router(chat_router)
app.include_router(grounded_search_router)
app.include_router(grounded_maps_router)
app.include_router(low_latency_router)
app.include_router(deep_analysis_router)
app.include_router(predictive_analysis_router)
app.include_router(weather_forecast_router)
app.include_router(historical_aqi_router)
app.include_router(historical_weather_router)
app.include_router(nws_forecast_router)
app.include_router(maps_config_router)
app.include_router(epa_aqi_router)
app.include_router(earthquakes_router)
app.include_router(airnow_router)
app.include_router(weather_historical_router)
app.include_router(calgem_router)
app.include_router(enviroscreen_router)
app.include_router(sentinel_router)
app.include_router(water_router)
app.include_router(fires_router)
app.include_router(traffic_router)
app.include_router(cropscape_router)
app.include_router(elevation_router)
app.include_router(landsat_router)
app.include_router(inversion_router)
app.include_router(water_quality_router)
app.include_router(predict_router)
app.include_router(explore_router)
app.include_router(ai_context_router)
app.include_router(demographics_router)
app.include_router(yard_router)
app.include_router(yard_context_router)
app.include_router(soil_router)
app.include_router(admin_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port, reload=True)
