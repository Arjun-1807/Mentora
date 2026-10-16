"""
Outgoing email: intro requests (POST /matches/{id}/request) and lifecycle
notifications (mentor on a new request, startup on accept / decline).

Delivery mode (settings.EMAIL_DELIVERY):
  * "smtp" - Gmail SMTP over SSL with GMAIL_USER + a Google App Password
             (GMAIL_APP_PASSWORD). This replaces the old Next.js
             /api/send-email route, which let any signed-in user mail any
             address; recipients are now always looked up server-side.
  * "log"  - nothing leaves the server; the message is only recorded.
  * ""     - (default) smtp when both Gmail settings are set, else log, so
             local and staging setups work without credentials.

Every message, in either mode, is recorded in the `outbox` collection
({to, subject, body, reply_to, kind, match_id, delivery, status, error,
created_at, sent_at}) as an audit trail.

Gmail setup: enable 2-Step Verification on the sending account, create an
App Password (myaccount.google.com -> Security -> App passwords) and set
GMAIL_USER / GMAIL_APP_PASSWORD in mentora-backend/.env.
"""
import logging
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Any, Dict, Optional

from app.config import settings
from app.db.mongo import get_outbox_collection

logger = logging.getLogger(__name__)

DELIVERY_SMTP = "smtp"
DELIVERY_LOG = "log"


class MailError(RuntimeError):
    """Delivery failed (or SMTP was requested but is not configured)."""


def delivery_mode() -> str:
    mode = (settings.EMAIL_DELIVERY or "").strip().lower()
    if mode in (DELIVERY_SMTP, DELIVERY_LOG):
        return mode
    if mode:
        logger.warning("Unknown EMAIL_DELIVERY %r; falling back to auto-detection", settings.EMAIL_DELIVERY)
    return DELIVERY_SMTP if settings.GMAIL_USER and settings.GMAIL_APP_PASSWORD else DELIVERY_LOG


def frontend_url(path: str = "") -> str:
    """Absolute link into the frontend (base = FRONTEND_ORIGIN)."""
    return f"{settings.FRONTEND_ORIGIN.rstrip('/')}/{path.lstrip('/')}"


def _build_message(to: str, subject: str, body: str, reply_to: Optional[str]) -> EmailMessage:
    message = EmailMessage()
    message["From"] = formataddr((settings.EMAIL_FROM_NAME, settings.GMAIL_USER))
    message["To"] = to
    message["Subject"] = subject
    message["Message-ID"] = make_msgid(domain=(settings.GMAIL_USER.split("@")[-1] or None))
    if reply_to:
        message["Reply-To"] = reply_to
    message.set_content(body)
    return message


def _send_smtp(message: EmailMessage) -> None:
    if not (settings.GMAIL_USER and settings.GMAIL_APP_PASSWORD):
        raise MailError("Email delivery is set to smtp but GMAIL_USER / GMAIL_APP_PASSWORD are not configured.")
    try:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=settings.SMTP_TIMEOUT_SECONDS) as smtp:
            smtp.login(settings.GMAIL_USER, settings.GMAIL_APP_PASSWORD)
            smtp.send_message(message)
    except smtplib.SMTPAuthenticationError as exc:
        raise MailError("Gmail rejected the login; check GMAIL_USER / GMAIL_APP_PASSWORD.") from exc
    except (smtplib.SMTPException, OSError) as exc:
        raise MailError(f"SMTP delivery failed: {exc.__class__.__name__}") from exc


def send_mail(
    *,
    to: str,
    subject: str,
    body: str,
    reply_to: Optional[str] = None,
    kind: str = "notification",
    match_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Deliver (or log) one plain-text email; returns the outbox document.

    Raises MailError if SMTP delivery fails. The outbox record is written in
    every case (status "logged", "sent" or "failed").
    """
    mode = delivery_mode()
    now = datetime.now(timezone.utc)
    record: Dict[str, Any] = {
        "to": to,
        "subject": subject,
        "body": body,
        "reply_to": reply_to,
        "kind": kind,
        "match_id": match_id,
        "delivery": mode,
        "status": "logged" if mode == DELIVERY_LOG else "pending",
        "error": None,
        "created_at": now,
        "sent_at": None,
    }

    error: Optional[MailError] = None
    if mode == DELIVERY_SMTP:
        try:
            _send_smtp(_build_message(to, subject, body, reply_to))
            record["status"] = "sent"
            record["sent_at"] = datetime.now(timezone.utc)
        except MailError as exc:
            logger.error("Email delivery failed (kind=%s, match=%s): %s", kind, match_id, exc)
            record["status"] = "failed"
            record["error"] = str(exc)
            error = exc
    else:
        logger.info("EMAIL_DELIVERY=log: recorded %s email for match %s (not sent)", kind, match_id)

    try:
        record["_id"] = get_outbox_collection().insert_one(dict(record)).inserted_id
    except Exception:
        # The outbox is an audit trail; losing a record must not fail a send
        # that already happened. In log mode it is the delivery, so surface it.
        logger.exception("Failed to record outgoing email in the outbox")
        if mode == DELIVERY_LOG:
            raise MailError("Could not record the email.")

    if error is not None:
        raise error
    return record


def notify(**kwargs: Any) -> Optional[Dict[str, Any]]:
    """Best-effort `send_mail` for notifications: never raises."""
    try:
        return send_mail(**kwargs)
    except Exception:
        logger.exception("Notification email failed (kind=%s)", kwargs.get("kind"))
        return None
