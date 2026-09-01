"""
FastAPI dependency that extracts and validates the bearer JWT from the
Authorization header, for protecting routes.
"""
import logging
from typing import Any, Dict

import jwt
from fastapi import Header, HTTPException

from app.services.auth import decode_access_token

logger = logging.getLogger(__name__)


async def get_current_user(authorization: str = Header(default=None)) -> Dict[str, Any]:
    """Parse `Authorization: Bearer <token>`, validate it, and return the
    decoded JWT payload (contains `sub` = user_id and `role`).

    Raises HTTPException(401) on a missing, malformed, invalid, or expired token.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header.")

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authorization header must be 'Bearer <token>'.")

    token = parts[1]
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Access token has expired.")
    except jwt.PyJWTError as exc:
        logger.warning("Invalid access token: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid access token.")

    return payload
