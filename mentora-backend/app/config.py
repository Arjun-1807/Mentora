"""
Application configuration.

Loads settings from environment variables / a local .env file using
pydantic-settings. Copy `.env.example` to `.env` and fill in real values
before running the app.

Security note: `JWT_SECRET` is validated at import time (see
`_validate_security`). The app deliberately refuses to start with a
missing/weak signing secret rather than silently issuing forgeable tokens.
"""
import logging
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Minimum acceptable length (in characters) for the JWT signing secret.
MIN_JWT_SECRET_LENGTH = 32

# Obviously-insecure placeholder secrets that must never be used.
_FORBIDDEN_JWT_SECRETS = {
    "change_me",
    "changeme",
    "secret",
    "supersecret",
    "your_jwt_secret_here",
    "jwt_secret",
    "test",
}


class ConfigurationError(RuntimeError):
    """Raised when the process is configured in a way that is unsafe to run."""


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

    # Auth (JWT). JWT_SECRET has no usable default on purpose - see
    # _validate_security() below, which fails fast if it is unset or weak.
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24

    # Uploads
    MAX_UPLOAD_BYTES: int = 10 * 1024 * 1024  # 10 MB

    # Rate limiting (in-process; see app/services/rate_limit.py)
    RATE_LIMIT_ENABLED: bool = True
    LOGIN_RATE_LIMIT: int = 10          # attempts per window, per client IP
    LOGIN_RATE_WINDOW_SECONDS: int = 300
    LLM_RATE_LIMIT: int = 20            # /extract + /email calls per window, per user
    LLM_RATE_WINDOW_SECONDS: int = 3600

    # CORS
    FRONTEND_ORIGIN: str = "http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


def _validate_security(settings: "Settings") -> None:
    """Fail fast and loudly on an unsafe auth configuration.

    An empty or short JWT_SECRET means every issued token can be forged by
    anyone, so refusing to boot is strictly safer than running.
    """
    secret = settings.JWT_SECRET or ""
    if not secret.strip():
        raise ConfigurationError(
            "JWT_SECRET is not set. Generate one with "
            "`python -c \"import secrets; print(secrets.token_hex(32))\"` and add it "
            "to your .env file before starting the app."
        )
    if len(secret) < MIN_JWT_SECRET_LENGTH:
        raise ConfigurationError(
            f"JWT_SECRET is too short ({len(secret)} chars); at least "
            f"{MIN_JWT_SECRET_LENGTH} characters are required. Generate a strong "
            "secret with `python -c \"import secrets; print(secrets.token_hex(32))\"`."
        )
    if secret.strip().lower() in _FORBIDDEN_JWT_SECRETS:
        raise ConfigurationError(
            "JWT_SECRET is a well-known placeholder value and must be replaced "
            "with a randomly generated secret."
        )


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton so the .env file is only parsed once."""
    settings = Settings()
    _validate_security(settings)
    return settings


settings = get_settings()
