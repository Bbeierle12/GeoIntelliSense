from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://geointellisense:geointellisense_dev@localhost:5432/geointellisense"
    port: int = 3002
    anthropic_api_key: str = ""
    epa_aqs_email: str = ""
    epa_aqs_key: str = ""
    airnow_api_key: str = ""
    noaa_cdo_token: str = ""
    nasa_firms_key: str = ""
    redis_url: str = "redis://localhost:6379"
    census_api_key: str = ""
    google_maps_api_key: str = ""
    admin_token: str = ""
    # Comma-separated extra origins (e.g. production web domain) appended to the defaults
    allowed_origins: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()

# Origins always allowed for browser-facing endpoints: local dev servers,
# the Caddy gateway, and the Capacitor Android WebView (androidScheme: https).
_DEFAULT_WEB_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:8080",
    "https://localhost",
]


def allowed_web_origins() -> list[str]:
    """Origin allowlist shared by CORS and per-endpoint origin checks."""
    extra = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
    return _DEFAULT_WEB_ORIGINS + extra
