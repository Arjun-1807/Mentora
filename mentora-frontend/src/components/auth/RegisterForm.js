"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, GraduationCap, Loader2, Rocket } from "lucide-react";
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

export const ROLE_META = {
  startup: { label: "Startup", icon: Rocket, copy: "Upload your deck and get matched with mentors in seconds." },
  mentor: { label: "Mentor", icon: GraduationCap, copy: "Share your expertise with founders who need it." },
  coordinator: { label: "Coordinator", icon: Building2, copy: "Track how every startup in your cohort is doing." },
};

/**
 * The account-creation form, shared by /register (self-service startup or
 * mentor sign-up) and /join/[token] (invite sign-up).
 *
 * - `roles`: the roles offered as tabs; with a single role no tabs render.
 * - `inviteToken`: sent as `invite_token`, placing the user in the invite's
 *   org/cohort.
 * - `lockedEmail`: an email-bound invite's address (prefilled, read-only).
 * - `claimMentorName`: the invite claims an existing mentor profile, so the
 *   mentor detail fields are skipped (the backend copies the profile).
 */
export default function RegisterForm({
  roles = ["startup", "mentor"],
  initialRole,
  inviteToken = null,
  lockedEmail = null,
  claimMentorName = null,
  title = "Create your account",
  description,
  footer,
}) {
  const router = useRouter();
  const [role, setRole] = useState(roles.includes(initialRole) ? initialRole : roles[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const [name, setName] = useState(claimMentorName || "");
  const [email, setEmail] = useState(lockedEmail || "");
  const [password, setPassword] = useState("");
  const [sectorExpertise, setSectorExpertise] = useState([]);
  const [pastExits, setPastExits] = useState("");
  const [stageFocus, setStageFocus] = useState("");
  const [geography, setGeography] = useState("");
  const [availability, setAvailability] = useState("");

  const isMentor = role === "mentor";
  const isClaim = isMentor && Boolean(claimMentorName);
  const showMentorFields = isMentor && !isClaim;

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
    if (!showMentorFields) return trimmedName ? { name: trimmedName } : {};
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

    // A claimed mentor profile already has a name and sectors.
    const errors = validateRegistration({
      role: showMentorFields ? "mentor" : "startup",
      name,
      email,
      password,
      sectorExpertise,
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const payload = { email: email.trim(), password, role, profile: buildProfile() };
      if (inviteToken) payload.invite_token = inviteToken;
      const data = await register(payload);
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
      if (err.status === 409 && !isClaim) {
        setFieldErrors({ email: "An account with this email already exists." });
      } else {
        setError(err.message || "Could not create account.");
      }
      setLoading(false);
    }
  }

  return (
    <Card className="shadow-xl shadow-black/20">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{title}</CardTitle>
        <CardDescription>{description ?? ROLE_META[role]?.copy}</CardDescription>
      </CardHeader>
      <CardContent>
        {roles.length > 1 && (
          <Tabs
            value={role}
            onValueChange={(value) => {
              setRole(value);
              setFieldErrors({});
              setError("");
            }}
          >
            <TabsList className="mb-6 h-10! w-full" aria-label="Account type">
              {roles.map((value) => {
                const { icon: Icon, label } = ROLE_META[value];
                return (
                  <TabsTrigger key={value} value={value} disabled={loading} className="flex-1">
                    <Icon aria-hidden="true" />
                    {label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="register-name">
              Full name
              {!showMentorFields && <span className="font-normal text-muted-foreground">(optional)</span>}
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
              readOnly={Boolean(lockedEmail)}
              onChange={(e) => {
                setEmail(e.target.value);
                clearFieldError("email");
              }}
              aria-invalid={Boolean(fieldErrors.email) || undefined}
              aria-describedby={
                fieldErrors.email ? "register-email-error" : lockedEmail ? "register-email-hint" : undefined
              }
              disabled={loading}
            />
            {fieldErrors.email ? (
              <FieldError id="register-email-error" message={fieldErrors.email} />
            ) : (
              lockedEmail && (
                <p id="register-email-hint" className="text-xs text-muted-foreground">
                  This invite was issued for this address.
                </p>
              )
            )}
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
              aria-describedby={fieldErrors.password ? "register-password-error" : "register-password-hint"}
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
            {showMentorFields && (
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

        {footer}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
