"""
Application configuration.

Loads settings from environment variables / a local .env file using
pydantic-settings. Copy `.env.example` to `.env` and fill in real values
before running the app.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Groq LLM API
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-20b"

    # MongoDB Atlas
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "mentora"
    MONGODB_MENTORS_COLLECTION: str = "mentors"
    MONGODB_VECTOR_INDEX_NAME: str = "mentor_vector_index"
    MONGODB_FEEDBACK_COLLECTION: str = "feedback"
    MONGODB_MATCHES_COLLECTION: str = "matches"
    MONGODB_USERS_COLLECTION: str = "users"

    # Embeddings
    EMBEDDING_MODEL_NAME: str = "BAAI/bge-base-en-v1.5"
    EMBEDDING_DIMENSIONS: int = 768

    # Auth (JWT)
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24

    # CORS
    FRONTEND_ORIGIN: str = "http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton so the .env file is only parsed once."""
    return Settings()


settings = get_settings()
