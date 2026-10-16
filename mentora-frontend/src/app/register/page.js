"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, GraduationCap, Loader2, Rocket } from "lucide-react";
import AuthSplitLayout from "@/components/layout/AuthSplitLayout";
import { InlineError } from "@/components/StateCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FieldError,
  SectorMultiSelect,
  SelectField,
} from "@/app/onboarding/mentor/_components/fields";
import { register, startSession } from "@/lib/api";
import { roleHome } from "@/lib/storage";
import {
  AVAILABILITY_OPTIONS,
  GEOGRAPHY_OPTIONS,
  MIN_PASSWORD_LENGTH,
  STAGE_OPTIONS,
  validateRegistration,
} from "@/lib/validation";

const ROLES = [
  { value: "startup", label: "Startup", icon: Rocket },
  { value: "mentor", label: "Mentor", icon: GraduationCap },
  { value: "coordinator", label: "Coordinator", icon: Building2 },
];

const ROLE_COPY = {
  startup: "Upload your deck and get matched with mentors in seconds.",
  mentor: "Share your expertise with founders who need it.",
  coordinator: "Track how every startup in your cohort is doing.",
};

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
  const [pastExits, setPastExits] = useState("");
  const [stageFocus, setStageFocus] = useState("");
  const [geography, setGeography] = useState("");
  const [availability, setAvailability] = useState("");

  // "/register?role=mentor" (the landing page's "For Mentors" button) preselects the tab.
  useEffect(() => {
    try {
      const requested = new URLSearchParams(window.location.search).get("role");
      if (ROLES.some((r) => r.value === requested)) setRole(requested);
    } catch {
      // ignore
    }
  }, []);

  const isMentor = role === "mentor";

  function clearFieldError(field) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function handlePasswordBlur() {
    if (password && password.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors((prev) => ({
        ...prev,
        password: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      }));
    }
  }

  function buildProfile() {
    const trimmedName = name.trim();
    if (!isMentor) return trimmedName ? { name: trimmedName } : {};
    // Mentors give the basics here; /onboarding/mentor collects the rest
    // (and is pre-filled with these values).
    const profile = { name: trimmedName, sector_expertise: sectorExpertise };
    if (pastExits.trim()) profile.past_exits = pastExits.trim();
    if (stageFocus) {
      profile.stage_focus = stageFocus;
      profile.preferred_stages = [stageFocus];
    }
    if (geography) profile.geography = geography;
    if (availability) profile.availability = availability;
    return profile;
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

    setLoading(true);
    setError("");
    try {
      const data = await register({
        email: email.trim(),
        password,
        role,
        profile: buildProfile(),
      });
      const session = await startSession(data, { email: email.trim(), fallbackRole: role });
      if (!session) {
        toast.success("Account created. Please sign in.");
        router.push("/login");
        return;
      }
      const finalRole = session.role || role;
      if (finalRole === "mentor") {
        toast.success("Account created. Let's finish your mentor profile.");
        router.push("/onboarding/mentor");
      } else {
        toast.success("Account created.");
        router.push(roleHome(finalRole));
      }
    } catch (err) {
      if (err.status === 409) {
        setFieldErrors({ email: "An account with this email already exists." });
      } else {
        setError(err.message || "Could not create account.");
      }
      setLoading(false);
    }
  }

  return (
    <AuthSplitLayout>
      <Card className="shadow-xl shadow-black/20">
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Create your account</CardTitle>
          <CardDescription>{ROLE_COPY[role]}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={role}
            onValueChange={(value) => {
              setRole(value);
              setFieldErrors({});
              setError("");
            }}
          >
            <TabsList className="h-10! w-full" aria-label="Account type">
              {ROLES.map((r) => {
                const Icon = r.icon;
                return (
                  <TabsTrigger key={r.value} value={r.value} disabled={loading} className="flex-1">
                    <Icon aria-hidden="true" />
                    {r.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="register-name">
                Full name
                {!isMentor && <span className="font-normal text-muted-foreground">(optional)</span>}
              </Label>
              <Input
                id="register-name"
                name="name"
                autoComplete="name"
                className="h-10"
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
                placeholder="you@company.com"
                className="h-10"
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
                className="h-10"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (e.target.value.length >= MIN_PASSWORD_LENGTH) clearFieldError("password");
                }}
                onBlur={handlePasswordBlur}
                aria-invalid={Boolean(fieldErrors.password) || undefined}
                aria-describedby={
                  fieldErrors.password ? "register-password-error" : "register-password-hint"
                }
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

            <AnimatePresence initial={false}>
              {isMentor && (
                <motion.div
                  key="mentor-fields"
                  initial={{ opacity: 0, height: 0, y: -8 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="-mx-1 overflow-hidden px-1 pb-1"
                >
                  <div className="space-y-4 border-t border-border pt-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                      Mentor details
                    </p>
                    <SectorMultiSelect
                      id="register-sectors"
                      value={sectorExpertise}
                      onChange={(v) => {
                        setSectorExpertise(v);
                        clearFieldError("sectorExpertise");
                      }}
                      error={fieldErrors.sectorExpertise}
                      hint="Pick at least one. You'll complete the rest of your profile next."
                      disabled={loading}
                    />
                    <div className="space-y-1.5">
                      <Label htmlFor="register-exits">
                        Past exits
                        <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Input
                        id="register-exits"
                        className="h-10"
                        placeholder="e.g. Exited Series B SaaS in 2021"
                        value={pastExits}
                        onChange={(e) => setPastExits(e.target.value)}
                        disabled={loading}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <SelectField
                        id="register-stage"
                        label="Stage focus"
                        value={stageFocus}
                        onChange={setStageFocus}
                        options={STAGE_OPTIONS}
                        placeholder="Any stage"
                        disabled={loading}
                      />
                      <SelectField
                        id="register-geography"
                        label="Geography"
                        value={geography}
                        onChange={setGeography}
                        options={GEOGRAPHY_OPTIONS}
                        placeholder="Select city"
                        disabled={loading}
                      />
                    </div>
                    <SelectField
                      id="register-availability"
                      label="Availability"
                      value={availability}
                      onChange={setAvailability}
                      options={AVAILABILITY_OPTIONS}
                      placeholder="Select availability"
                      disabled={loading}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && <InlineError message={error} className="rounded-lg" />}

            <Button type="submit" className="h-10 w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {loading ? "Creating account…" : "Create Account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthSplitLayout>
  );
}
