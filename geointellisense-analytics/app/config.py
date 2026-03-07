from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://geointellisense:geointellisense_dev@localhost:5432/geointellisense"
    port: int = 3002
    anthropic_api_key: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
