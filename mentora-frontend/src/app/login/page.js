"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import AuthSplitLayout from "@/components/layout/AuthSplitLayout";
import { InlineError } from "@/components/StateCard";
import { FadeIn, Stagger } from "@/components/motion";
import { FieldError } from "@/app/onboarding/mentor/_components/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, startSession } from "@/lib/api";
import { roleHome } from "@/lib/storage";
import { isValidEmail } from "@/lib/validation";

/** Where to land after signing in — honours a same-origin `?next=` set by the auth guard. */
function nextDestination(role) {
  try {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login")) {
      return next;
    }
  } catch {
    // ignore
  }
  return roleHome(role);
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;

    const errors = {};
    if (!email.trim()) errors.email = "Enter your email address.";
    else if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    setError("");
    try {
      const data = await login(email.trim(), password);
      const session = await startSession(data, { email: email.trim() });
      if (!session) throw new Error("Signed in, but no session token came back. Try again.");
      toast.success("Signed in.");
      router.push(nextDestination(session.role));
    } catch (err) {
      setError(err.message || "Could not sign in.");
      setLoading(false);
    }
  }

  return (
    <AuthSplitLayout>
      <Stagger>
        <FadeIn as="p" className="eyebrow">
          Welcome back
        </FadeIn>
        <FadeIn
          as="h1"
          className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >
          Sign in to{" "}
          <span className="font-display text-[1.1em] font-normal italic text-gradient-primary">
            Mentora
          </span>
        </FadeIn>
        <FadeIn as="p" className="mt-3 text-[0.9375rem] text-muted-foreground">
          Pick up where you left off — your matches and meetings are waiting.
        </FadeIn>

        <FadeIn>
          <form onSubmit={handleSubmit} noValidate className="mt-9 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="login-email">Email</Label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  className="h-11 pl-10"
                  placeholder="you@company.com"
                  disabled={loading}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldErrors((p) => ({ ...p, email: undefined }));
                  }}
                  aria-invalid={Boolean(fieldErrors.email) || undefined}
                  aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
                />
              </div>
              <FieldError id="login-email-error" message={fieldErrors.email} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-password">Password</Label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="h-11 pl-10 pr-11"
                  disabled={loading}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors((p) => ({ ...p, password: undefined }));
                  }}
                  aria-invalid={Boolean(fieldErrors.password) || undefined}
                  aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <FieldError id="login-password-error" message={fieldErrors.password} />
            </div>

            {error && <InlineError message={error} />}

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {loading ? "Signing in…" : "Sign in"}
              {!loading && (
                <ArrowRight
                  className="transition-transform group-hover/button:translate-x-0.5"
                  aria-hidden="true"
                />
              )}
            </Button>
          </form>
        </FadeIn>

        <FadeIn className="mt-8 flex items-center gap-4 text-xs text-muted-foreground">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          New to Mentora?
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </FadeIn>
        <FadeIn className="mt-5">
          <Button variant="outline" size="lg" className="w-full" render={<Link href="/register" />}>
            Create an account
          </Button>
        </FadeIn>
      </Stagger>
    </AuthSplitLayout>
  );
}
