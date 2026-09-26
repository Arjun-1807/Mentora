// POST /api/send-email — delivers a founder's intro email to a mentor via
// Gmail SMTP (nodemailer + Google App Password).
//
// Body: { to: string, subject: string, body: string }
//
// Guardrails: the caller must present the same bearer token the FastAPI
// backend issued (checked against its /me endpoint), so this route can't be
// used as an open relay. The founder's own address is set as Reply-To so
// the mentor's reply reaches them directly.
//
// Gmail setup (one-time):
//   1. Enable 2-Step Verification on the sending Google account.
//   2. Go to myaccount.google.com → Security → App Passwords → create one.
//   3. Set GMAIL_USER and GMAIL_APP_PASSWORD in mentora-frontend/.env.local
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE_URL =
  process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 10_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function error(status, message) {
  return NextResponse.json({ error: message }, { status });
}

/** Resolves the signed-in user from the backend, or returns an error response. */
async function authenticate(request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return { response: error(401, "Please sign in to send email.") };

  let res;
  try {
    res = await fetch(`${API_BASE_URL}/me`, {
      headers: { Authorization: authorization },
      cache: "no-store",
    });
  } catch {
    return { response: error(503, "Server unavailable. Please try again shortly.") };
  }
  if (!res.ok) return { response: error(401, "Your session has expired. Please sign in again.") };

  try {
    return { user: await res.json() };
  } catch {
    return { user: {} };
  }
}

/** Creates a nodemailer transporter using Gmail SMTP + App Password. */
function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

export async function POST(request) {
  const transporter = createTransporter();
  if (!transporter) {
    console.error(
      "[send-email] GMAIL_USER or GMAIL_APP_PASSWORD is not set in .env.local"
    );
    return error(
      500,
      "Email sending is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local."
    );
  }

  const { user, response } = await authenticate(request);
  if (response) return response;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return error(400, "Request body must be JSON.");
  }

  const to      = typeof payload?.to      === "string" ? payload.to.trim()      : "";
  const subject = typeof payload?.subject === "string" ? payload.subject.trim() : "";
  const body    = typeof payload?.body    === "string" ? payload.body.trim()    : "";

  if (!EMAIL_RE.test(to))  return error(400, "A valid recipient email address is required.");
  if (!subject)            return error(400, "Subject is required.");
  if (!body)               return error(400, "Body is required.");
  if (subject.length > MAX_SUBJECT_LENGTH)
    return error(400, `Subject must be at most ${MAX_SUBJECT_LENGTH} characters.`);
  if (body.length > MAX_BODY_LENGTH)
    return error(400, `Body must be at most ${MAX_BODY_LENGTH} characters.`);

  const fromName    = "Mentora";
  const fromAddress = process.env.GMAIL_USER;
  const replyTo     =
    typeof user?.email === "string" && EMAIL_RE.test(user.email)
      ? user.email
      : undefined;

  try {
    const info = await transporter.sendMail({
      from:    `"${fromName}" <${fromAddress}>`,
      to,
      subject,
      text:    body,
      ...(replyTo ? { replyTo } : {}),
    });

    console.log("[send-email] Sent OK — messageId:", info.messageId, "| to:", to);
    return NextResponse.json({ success: true, messageId: info.messageId ?? null });
  } catch (err) {
    console.error("[send-email] Gmail SMTP error:", err);
    return error(
      502,
      err?.message?.includes("Invalid login")
        ? "Gmail authentication failed. Check your GMAIL_USER and GMAIL_APP_PASSWORD in .env.local."
        : "Could not send the email. Please try again."
    );
  }
}
