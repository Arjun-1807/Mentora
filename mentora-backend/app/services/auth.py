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
from fastapi import HTTPException

from app.config import settings
from app.models.schemas import MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH

logger = logging.getLogger(__name__)


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt, returning a utf-8 string.

    bcrypt (4.x and later) *raises* on inputs longer than 72 bytes rather
    than silently truncating them, and rejects empty/short passwords by
    policy here, so both cases are turned into a clean 400 instead of an
    unhandled 500.
    """
    encoded = password.encode("utf-8")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters long.",
        )
    if len(encoded) > MAX_PASSWORD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Password is too long: bcrypt supports at most {MAX_PASSWORD_BYTES} "
                "bytes (note that non-ASCII characters use several bytes each)."
            ),
        )

    hashed = bcrypt.hashpw(encoded, bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Check a plaintext password against a bcrypt hash.

    Returns False (rather than raising) for a malformed hash or an
    over-long password, so callers can answer with a uniform 401.
    """
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        logger.warning("Password verification failed: malformed hash or unsupported password length")
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
