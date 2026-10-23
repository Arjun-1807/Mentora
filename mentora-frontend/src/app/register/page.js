"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Building2, GraduationCap, Loader2, Lock, Mail, Rocket } from "lucide-react";
import AuthSplitLayout from "@/components/layout/AuthSplitLayout";
import { InlineError } from "@/components/StateCard";
import { EASE_OUT, FadeIn, SPRING, Stagger } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FieldError,
  OptionalTag,
  SectorMultiSelect,
  SelectField,
} from "@/app/onboarding/mentor/_components/fields";
import { register, startSession } from "@/lib/api";
import { roleHome } from "@/lib/storage";
import { cn } from "@/lib/utils";
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
  const roleRefs = useRef({});

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

  const roleIndex = ROLES.findIndex((r) => r.value === role);

  function selectRole(value) {
    if (value === role) return;
    setRole(value);
    setFieldErrors({});
    setError("");
  }

  // Radio-group keyboard support: arrows move (and select) like native radios.
  function handleRoleKeyDown(e) {
    const delta =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta || loading) return;
    e.preventDefault();
    const next = ROLES[(roleIndex + delta + ROLES.length) % ROLES.length];
    selectRole(next.value);
    roleRefs.current[next.value]?.focus();
  }

  const strength = Math.min(password.length / MIN_PASSWORD_LENGTH, 1);

  return (
    <AuthSplitLayout>
      <Stagger>
        <FadeIn as="p" className="eyebrow">
          Get started
        </FadeIn>
        <FadeIn
          as="h1"
          className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >
          Create your{" "}
          <span className="font-display text-[1.1em] font-normal italic text-gradient-primary">
            account
          </span>
        </FadeIn>
        <FadeIn className="mt-3 min-h-12 overflow-hidden sm:min-h-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={role}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="text-[0.9375rem] text-muted-foreground"
            >
              {ROLE_COPY[role]}
            </motion.p>
          </AnimatePresence>
        </FadeIn>

        <FadeIn className="mt-7">
          <p id="register-role-label" className="mb-2 text-sm font-medium text-foreground">
            I&apos;m joining as
          </p>
          <div
            role="radiogroup"
            aria-labelledby="register-role-label"
            onKeyDown={handleRoleKeyDown}
            className="grid grid-cols-3 gap-2"
          >
            {ROLES.map((r) => {
              const Icon = r.icon;
              const selected = r.value === role;
              return (
                <button
                  key={r.value}
                  ref={(el) => {
                    roleRefs.current[r.value] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  disabled={loading}
                  onClick={() => selectRole(r.value)}
                  className={cn(
                    "relative isolate flex flex-col items-center gap-2 rounded-2xl border px-2 py-3.5 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                    selected
                      ? "border-primary/40 text-foreground"
                      : "border-border bg-card/50 text-muted-foreground hover:border-[color-mix(in_oklch,var(--primary)_30%,var(--border))] hover:text-foreground"
                  )}
                >
                  {selected && (
                    <motion.span
                      layoutId="register-role"
                      transition={SPRING.snappy}
                      aria-hidden="true"
                      className="absolute inset-0 -z-10 rounded-[inherit] bg-primary/10 shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_14%,transparent)]"
                    />
                  )}
                  <motion.span
                    animate={{ scale: selected ? 1 : 0.92, rotate: selected ? 0 : -4 }}
                    transition={SPRING.bouncy}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-xl transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)]"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </motion.span>
                  {r.label}
                </button>
              );
            })}
          </div>
        </FadeIn>

        <FadeIn>
          <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="register-name">
                Full name
                {!isMentor && <OptionalTag />}
              </Label>
              <Input
                id="register-name"
                name="name"
                autoComplete="name"
                className="h-11"
                placeholder="Ada Lovelace"
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

            <div className="space-y-2">
              <Label htmlFor="register-email">Email</Label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="register-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  className="h-11 pl-10"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldError("email");
                  }}
                  aria-invalid={Boolean(fieldErrors.email) || undefined}
                  aria-describedby={fieldErrors.email ? "register-email-error" : undefined}
                  disabled={loading}
                />
              </div>
              <FieldError id="register-email-error" message={fieldErrors.email} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="register-password">Password</Label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="register-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  className="h-11 pl-10"
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
              </div>
              {/* Length meter: fills as the password approaches the minimum. */}
              <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className={cn(
                    "h-full origin-left rounded-full",
                    strength >= 1 ? "bg-success" : "bg-primary"
                  )}
                  initial={false}
                  animate={{ scaleX: strength }}
                  transition={SPRING.soft}
                />
              </div>
              {fieldErrors.password ? (
                <FieldError id="register-password-error" message={fieldErrors.password} />
              ) : (
                <p
                  id="register-password-hint"
                  className={cn(
                    "text-xs transition-colors",
                    strength >= 1 ? "text-success" : "text-muted-foreground"
                  )}
                >
                  At least {MIN_PASSWORD_LENGTH} characters.
                </p>
              )}
            </div>

            <AnimatePresence initial={false}>
              {isMentor && (
                <motion.div
                  key="mentor-fields"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.35, ease: EASE_OUT }}
                  className="-mx-1 overflow-hidden px-1 pb-1"
                >
                  <div className="space-y-5 rounded-2xl border border-primary/15 bg-primary/[0.04] p-4 sm:p-5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
                        <GraduationCap className="size-4" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Mentor details</p>
                        <p className="text-xs text-muted-foreground">
                          Helps us match you from day one.
                        </p>
                      </div>
                    </div>
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
                    <div className="space-y-2">
                      <Label htmlFor="register-exits">
                        Past exits
                        <OptionalTag />
                      </Label>
                      <Input
                        id="register-exits"
                        className="h-11"
                        placeholder="e.g. Exited Series B SaaS in 2021"
                        value={pastExits}
                        onChange={(e) => setPastExits(e.target.value)}
                        disabled={loading}
                      />
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2">
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

            {error && <InlineError message={error} />}

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {loading ? "Creating account…" : "Create account"}
              {!loading && (
                <ArrowRight
                  className="transition-transform group-hover/button:translate-x-0.5"
                  aria-hidden="true"
                />
              )}
            </Button>
          </form>
        </FadeIn>

        <FadeIn as="p" className="mt-7 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </FadeIn>
      </Stagger>
    </AuthSplitLayout>
  );
}
