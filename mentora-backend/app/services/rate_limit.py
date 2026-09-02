"""
Dependency-light, in-process rate limiting.

Implements a simple sliding-window counter: for each key we keep the
timestamps of recent hits, drop the ones that fell out of the window, and
reject the request if what remains has reached the limit.

Scope and limitations
---------------------
State lives in this process's memory, guarded by a lock. That is fine for
the single-uvicorn-worker deployment this app currently uses, but a
multi-process / multi-instance deployment would need a shared store
(Redis with `INCR` + `EXPIRE`, or a proper API gateway) - otherwise each
worker enforces its own separate quota.

Used for:
  * POST /login   - keyed by client IP, to slow password brute-forcing.
  * POST /extract - keyed by user id, because each call costs Groq tokens.
  * POST /email   - same.
"""
import logging
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from fastapi import HTTPException, Request

from app.config import settings

logger = logging.getLogger(__name__)


class SlidingWindowRateLimiter:
    """Thread-safe sliding-window rate limiter keyed by arbitrary strings."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window_seconds = float(window_seconds)
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, hits: Deque[float], now: float) -> None:
        cutoff = now - self.window_seconds
        while hits and hits[0] <= cutoff:
            hits.popleft()

    def check(self, key: str) -> Optional[int]:
        """Register a hit for `key`.

        Returns None if the request is allowed, or the number of seconds to
        wait (>= 1) if the caller has exhausted its quota.
        """
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            self._prune(hits, now)
            if len(hits) >= self.limit:
                retry_after = self.window_seconds - (now - hits[0])
                return max(1, int(retry_after) + 1)
            hits.append(now)
            return None

    def reset(self, key: Optional[str] = None) -> None:
        """Clear recorded hits (all keys, or just one). Used by tests."""
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)


# --- Shared limiter instances ----------------------------------------------
login_limiter = SlidingWindowRateLimiter(
    limit=settings.LOGIN_RATE_LIMIT,
    window_seconds=settings.LOGIN_RATE_WINDOW_SECONDS,
)
llm_limiter = SlidingWindowRateLimiter(
    limit=settings.LLM_RATE_LIMIT,
    window_seconds=settings.LLM_RATE_WINDOW_SECONDS,
)


def reset_all_limiters() -> None:
    """Clear all rate-limit state (used by tests)."""
    login_limiter.reset()
    llm_limiter.reset()


def client_ip(request: Request) -> str:
    """Best-effort client IP.

    Honours the left-most entry of `X-Forwarded-For` when present, since the
    app is expected to sit behind a single trusted reverse proxy in
    deployment; falls back to the socket peer address.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def _enforce(limiter: SlidingWindowRateLimiter, key: str, what: str) -> None:
    if not settings.RATE_LIMIT_ENABLED:
        return
    retry_after = limiter.check(key)
    if retry_after is not None:
        logger.warning("Rate limit exceeded for %s (key=%s)", what, key)
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )


def rate_limit_login(request: Request) -> None:
    """FastAPI dependency: throttle login attempts per client IP."""
    _enforce(login_limiter, f"login:{client_ip(request)}", "login")


def rate_limit_llm_for_user(user_id: str) -> None:
    """Throttle expensive LLM-backed endpoints per authenticated user id."""
    _enforce(llm_limiter, f"llm:{user_id or 'anonymous'}", "llm endpoint")
