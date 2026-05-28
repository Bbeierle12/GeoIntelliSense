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
    admin_token: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
