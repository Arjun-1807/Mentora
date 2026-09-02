"""Tests for the fail-fast security configuration checks."""
import pytest

from app.config import ConfigurationError, Settings, _validate_security


def _settings(secret: str) -> Settings:
    return Settings(JWT_SECRET=secret)


@pytest.mark.parametrize("secret", ["", "   ", "short", "a" * 31, "changeme", "secret"])
def test_weak_or_missing_jwt_secret_is_rejected(secret):
    with pytest.raises(ConfigurationError):
        _validate_security(_settings(secret))


def test_strong_jwt_secret_is_accepted():
    _validate_security(_settings("a" * 64))


def test_forbidden_placeholder_of_sufficient_length_is_rejected():
    with pytest.raises(ConfigurationError):
        _validate_security(_settings("your_jwt_secret_here" + " " * 20))
