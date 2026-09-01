"""
Password hashing and JWT issuance/verification for user authentication.

Uses bcrypt directly for password hashing and PyJWT for token
encoding/decoding (see app.config.settings for JWT_SECRET / JWT_ALGORITHM /
JWT_EXPIRE_MINUTES).
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import bcrypt
import jwt

from app.config import settings

logger = logging.getLogger(__name__)


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt, returning a utf-8 string."""
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Check a plaintext password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        logger.warning("Malformed password hash encountered during verification")
        return False


def create_access_token(user_id: str, role: str) -> str:
    """Create a signed JWT access token carrying the user id and role."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT access token, returning its payload.

    Raises jwt.PyJWTError (or a subclass, e.g. ExpiredSignatureError,
    InvalidTokenError) on any failure; callers should catch and translate
    to an HTTPException.
    """
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
