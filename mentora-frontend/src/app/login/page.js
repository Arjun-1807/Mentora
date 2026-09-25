"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { PageShell } from "@/components/PageShell";
import { InlineError } from "@/components/StateCard";
import { HoverCard } from "@/components/motion";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { login, tokenFromAuthResponse } from "@/lib/api";
import { setToken } from "@/lib/storage";

/**
 * Reads the `role` claim from a JWT without verifying it — only used to pick
 * a landing page; the backend still verifies the token on every request.
 */
function roleFromToken(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload))?.role || null;
  } catch {
    return null;
  }
}

/** Where to land after signing in — honours `?next=` set by the auth guard. */
function nextDestination(role) {
  try {
    const next = new URLSearchParams(window.location.search).get("next");
    // Only allow same-origin paths.
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  } catch {
    // ignore
  }
  return role === "mentor" ? "/dashboard" : "/upload";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");
    try {
      const data = await login(email, password);
      const token = tokenFromAuthResponse(data);
      if (!token) {
        throw new Error("Signed in, but no session token came back. Try again.");
      }
      setToken(token);
      toast.success("Signed in.");
      router.push(nextDestination(roleFromToken(token)));
    } catch (err) {
      setError(err.message || "Could not sign in.");
      setLoading(false);
    }
  }

  return (
    <PageShell width="md" center>
      <HoverCard>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Welcome back. Sign in to continue to Mentora.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={loading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && <InlineError message={error} />}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {loading ? "Signing in…" : "Sign In"}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="text-primary hover:underline">
                Register
              </Link>
            </p>
          </CardContent>
        </Card>
      </HoverCard>
    </PageShell>
  );
}
