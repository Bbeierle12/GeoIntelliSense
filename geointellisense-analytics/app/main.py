from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import get_pool, close_pool
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield
    await close_pool()


app = FastAPI(title="GeoIntelliSense Analytics", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port, reload=True)
