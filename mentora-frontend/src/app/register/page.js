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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { register, tokenFromAuthResponse } from "@/lib/api";
import { setToken } from "@/lib/storage";
import { MIN_PASSWORD_LENGTH, SECTOR_OPTIONS, validateRegistration } from "@/lib/validation";

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState("startup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sectorExpertise, setSectorExpertise] = useState([]);

  function clearFieldError(field) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function toggleSector(sector) {
    clearFieldError("sectorExpertise");
    setSectorExpertise((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;

    const errors = validateRegistration({ role, name, email, password, sectorExpertise });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError("");
      return;
    }

    // Mentors only give the basics here; the rest of their profile is
    // collected by the /onboarding/mentor flow right after sign-up.
    const profile =
      role === "mentor"
        ? { name: name.trim(), sector_expertise: sectorExpertise }
        : { name: name.trim() };

    setLoading(true);
    setError("");
    try {
      const data = await register({ email: email.trim(), password, role, profile });
      const token = tokenFromAuthResponse(data);
      if (token) {
        setToken(token);
        toast.success("Account created.");
        router.push(role === "mentor" ? "/onboarding/mentor" : "/upload");
      } else {
        toast.success("Account created. Please sign in.");
        router.push("/login");
      }
    } catch (err) {
      if (err.status === 409) {
        setFieldErrors({ email: "Account already exists." });
      } else {
        setError(err.message || "Could not create account.");
      }
      setLoading(false);
    }
  }

  return (
    <PageShell width="lg" center>
      <HoverCard>
        <Card>
          <CardHeader>
            <CardTitle>Create an account</CardTitle>
            <CardDescription>Join Mentora as a startup or a mentor.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={role} onValueChange={setRole}>
              <TabsList className="w-full">
                <TabsTrigger value="startup" className="flex-1" disabled={loading}>
                  Startup
                </TabsTrigger>
                <TabsTrigger value="mentor" className="flex-1" disabled={loading}>
                  Mentor
                </TabsTrigger>
              </TabsList>

              <form onSubmit={handleSubmit} noValidate className="space-y-4 mt-6">
                <div className="space-y-1.5">
                  <Label htmlFor="register-name">Name</Label>
                  <Input
                    id="register-name"
                    name="name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      clearFieldError("name");
                    }}
                    aria-invalid={Boolean(fieldErrors.name) || undefined}
                    aria-describedby={fieldErrors.name ? "register-name-error" : undefined}
                    disabled={loading}
                  />
                  <FieldError id="register-name-error" message={fieldErrors.name} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="register-email">Email</Label>
                  <Input
                    id="register-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearFieldError("email");
                    }}
                    aria-invalid={Boolean(fieldErrors.email) || undefined}
                    aria-describedby={fieldErrors.email ? "register-email-error" : undefined}
                    disabled={loading}
                  />
                  <FieldError id="register-email-error" message={fieldErrors.email} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="register-password">Password</Label>
                  <Input
                    id="register-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={Boolean(fieldErrors.password) || undefined}
                    aria-describedby={
                      fieldErrors.password ? "register-password-error" : "register-password-hint"
                    }
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearFieldError("password");
                    }}
                    disabled={loading}
                  />
                  {fieldErrors.password ? (
                    <FieldError id="register-password-error" message={fieldErrors.password} />
                  ) : (
                    <p id="register-password-hint" className="text-xs text-muted-foreground">
                      At least {MIN_PASSWORD_LENGTH} characters.
                    </p>
                  )}
                </div>

                <TabsContent value="mentor" className="space-y-4 mt-0">
                  <fieldset
                    className="space-y-1.5"
                    disabled={loading}
                    aria-describedby={
                      fieldErrors.sectorExpertise ? "register-sectors-error" : "register-sectors-hint"
                    }
                  >
                    <legend className="text-sm font-medium leading-none mb-2">
                      Sector expertise
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {SECTOR_OPTIONS.map((sector) => {
                        const active = sectorExpertise.includes(sector);
                        return (
                          <Badge
                            key={sector}
                            variant={active ? "default" : "outline"}
                            className="cursor-pointer select-none px-2.5 py-1 h-auto"
                            render={
                              <button
                                type="button"
                                aria-pressed={active}
                                onClick={() => toggleSector(sector)}
                              />
                            }
                          >
                            {sector}
                          </Badge>
                        );
                      })}
                    </div>
                    {fieldErrors.sectorExpertise ? (
                      <FieldError
                        id="register-sectors-error"
                        message={fieldErrors.sectorExpertise}
                      />
                    ) : (
                      <p id="register-sectors-hint" className="text-xs text-muted-foreground">
                        Pick at least one. You&apos;ll add the rest of your profile next.
                      </p>
                    )}
                  </fieldset>
                </TabsContent>

                {error && <InlineError message={error} />}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {loading ? "Creating account…" : "Create Account"}
                </Button>
              </form>
            </Tabs>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </HoverCard>
    </PageShell>
  );
}
