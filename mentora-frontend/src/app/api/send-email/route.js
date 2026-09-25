// POST /api/send-email — delivers a founder's intro email to a mentor via
// Resend (https://resend.com/docs).
//
// Body: { to: string, subject: string, body: string }
//
// Guardrails: the caller must present the same bearer token the FastAPI
// backend issued (checked against its /me endpoint), so this route can't be
// used as an open relay for the project's Resend key. The founder's own
// address is set as Reply-To so the mentor's reply reaches them directly.
import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE_URL =
  process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
// Resend's shared test domain; set RESEND_FROM_EMAIL once you verify your own.
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || "Mentora <mentora@resend.dev>";

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

export async function POST(request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[send-email] RESEND_API_KEY is not set in .env.local");
    return error(500, "Email sending is not configured. Set RESEND_API_KEY in .env.local.");
  }

  const { user, response } = await authenticate(request);
  if (response) return response;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return error(400, "Request body must be JSON.");
  }

  const to = typeof payload?.to === "string" ? payload.to.trim() : "";
  const subject = typeof payload?.subject === "string" ? payload.subject.trim() : "";
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";

  if (!EMAIL_RE.test(to)) return error(400, "A valid recipient email address is required.");
  if (!subject) return error(400, "Subject is required.");
  if (!body) return error(400, "Body is required.");
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return error(400, `Subject must be at most ${MAX_SUBJECT_LENGTH} characters.`);
  }
  if (body.length > MAX_BODY_LENGTH) {
    return error(400, `Body must be at most ${MAX_BODY_LENGTH} characters.`);
  }

  const replyTo = typeof user?.email === "string" && EMAIL_RE.test(user.email) ? user.email : undefined;

  try {
    const resend = new Resend(apiKey);
    const { data, error: sendError } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [to],
      subject,
      text: body,
      ...(replyTo ? { replyTo } : {}),
    });

    if (sendError) {
      console.error("[send-email] Resend rejected the email:", sendError);
      return error(502, sendError.message || "The email provider rejected the message.");
    }
    return NextResponse.json({ success: true, id: data?.id ?? null });
  } catch (err) {
    console.error("[send-email] Resend request failed:", err);
    return error(502, "Could not reach the email provider. Please try again.");
  }
}
