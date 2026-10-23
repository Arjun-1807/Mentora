"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  CircleAlert,
  ClipboardCheck,
  Loader2,
  Pencil,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import PageWrapper from "@/components/layout/PageWrapper";
import StepIndicator from "@/components/ui/StepIndicator";
import { InlineError, StateCard } from "@/components/StateCard";
import { EASE_OUT, SPRING } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { getMe, updateMentorProfile } from "@/lib/api";
import { roleHome, setUserRole } from "@/lib/storage";
import {
  AVAILABILITY_OPTIONS,
  CAPACITY_OPTIONS,
  EXPERIENCE_OPTIONS,
  GEOGRAPHY_OPTIONS,
  MAX_BIO_LENGTH,
  SECTOR_OPTIONS,
  STAGE_OPTIONS,
  normalizeStages,
  sectorLabel,
  toMentorProfilePayload,
  validateOnboardingStep,
} from "@/lib/validation";
import { FieldError, OptionalTag, SectorMultiSelect, SelectField } from "./_components/fields";

const STEPS = [
  { title: "About You", description: "Tell startups who you are.", icon: UserRound },
  { title: "Your Expertise", description: "Where you can help most.", icon: Briefcase },
  {
    title: "Startup Preferences",
    description: "Who you'd like to mentor, and how often.",
    icon: Target,
  },
  { title: "Review", description: "Check everything before you go live.", icon: ClipboardCheck },
];
const STEP_LABELS = STEPS.map((s) => s.title);
const TOTAL_STEPS = STEPS.length;

const EMPTY_FORM = {
  name: "",
  linkedinUrl: "",
  bio: "",
  geography: "",
  sectorExpertise: [],
  yearsExperience: "",
  pastExits: "",
  preferredStages: [],
  maxStartupsPerMonth: "",
  availability: "",
};

/** Pre-fills the form from whatever the mentor already saved (register or a past onboarding). */
function formFromProfile(profile = {}) {
  const pick = (value, options) => (options.includes(value) ? value : "");
  const stageValues = STAGE_OPTIONS.map((s) => s.value);
  const sectors = Array.isArray(profile.sector_expertise) ? profile.sector_expertise : [];
  const stages = Array.isArray(profile.preferred_stages)
    ? profile.preferred_stages
    : profile.stage_focus
      ? [profile.stage_focus]
      : [];
  return {
    ...EMPTY_FORM,
    name: profile.name || "",
    linkedinUrl: profile.linkedin_url || "",
    bio: (profile.bio || "").slice(0, MAX_BIO_LENGTH),
    geography: pick(profile.geography, GEOGRAPHY_OPTIONS),
    sectorExpertise: sectors
      .map((s) => (s === "Other" ? "Others" : s))
      .filter((s) => SECTOR_OPTIONS.includes(s)),
    yearsExperience: pick(profile.years_experience, EXPERIENCE_OPTIONS),
    pastExits: typeof profile.past_exits === "string" ? profile.past_exits : "",
    preferredStages: stages.filter((s) => stageValues.includes(s)),
    maxStartupsPerMonth: pick(String(profile.max_startups_per_month ?? ""), CAPACITY_OPTIONS),
    availability: pick(profile.availability, AVAILABILITY_OPTIONS),
  };
}

function stageLabels(values) {
  return STAGE_OPTIONS.filter((s) => values.includes(s.value)).map((s) => s.label);
}

const slide = {
  enter: (dir) => ({ opacity: 0, x: dir >= 0 ? 48 : -48, filter: "blur(4px)" }),
  center: { opacity: 1, x: 0, filter: "none" },
  exit: (dir) => ({ opacity: 0, x: dir >= 0 ? -48 : 48, filter: "blur(4px)" }),
};

/* ------------------------------------------------------------------ steps */

function StepAbout({ form, update, errors }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="onboarding-name">Full name</Label>
        <Input
          id="onboarding-name"
          autoComplete="name"
          className="h-11"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          aria-invalid={Boolean(errors.name) || undefined}
          aria-describedby={errors.name ? "onboarding-name-error" : undefined}
        />
        <FieldError id="onboarding-name-error" message={errors.name} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboarding-linkedin">
          LinkedIn URL <OptionalTag />
        </Label>
        <Input
          id="onboarding-linkedin"
          type="url"
          inputMode="url"
          className="h-11"
          placeholder="https://linkedin.com/in/your-name"
          value={form.linkedinUrl}
          onChange={(e) => update("linkedinUrl", e.target.value)}
          aria-invalid={Boolean(errors.linkedinUrl) || undefined}
          aria-describedby={errors.linkedinUrl ? "onboarding-linkedin-error" : undefined}
        />
        <FieldError id="onboarding-linkedin-error" message={errors.linkedinUrl} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboarding-bio">
          Short bio <OptionalTag />
        </Label>
        <Textarea
          id="onboarding-bio"
          rows={4}
          maxLength={MAX_BIO_LENGTH}
          placeholder="What you've built, and what founders come to you for."
          value={form.bio}
          onChange={(e) => update("bio", e.target.value.slice(0, MAX_BIO_LENGTH))}
          aria-invalid={Boolean(errors.bio) || undefined}
          aria-describedby={
            errors.bio ? "onboarding-bio-error onboarding-bio-count" : "onboarding-bio-count"
          }
        />
        <div className="flex items-start justify-between gap-2">
          <FieldError id="onboarding-bio-error" message={errors.bio} />
          <span
            id="onboarding-bio-count"
            className={cn(
              "ml-auto font-mono text-xs tabular-nums",
              form.bio.length >= MAX_BIO_LENGTH
                ? "text-destructive"
                : form.bio.length >= MAX_BIO_LENGTH * 0.9
                  ? "text-warning"
                  : "text-muted-foreground"
            )}
            aria-live="polite"
          >
            {form.bio.length}/{MAX_BIO_LENGTH}
          </span>
        </div>
      </div>

      <SelectField
        id="onboarding-geography"
        label="Geography"
        value={form.geography}
        onChange={(v) => update("geography", v)}
        options={GEOGRAPHY_OPTIONS}
        placeholder="Select your city"
        error={errors.geography}
      />
    </div>
  );
}

function StepExpertise({ form, update, errors }) {
  return (
    <div className="space-y-6">
      <SectorMultiSelect
        id="onboarding-sectors"
        value={form.sectorExpertise}
        onChange={(v) => update("sectorExpertise", v)}
        error={errors.sectorExpertise}
      />

      <SelectField
        id="onboarding-experience"
        label="Years of experience"
        value={form.yearsExperience}
        onChange={(v) => update("yearsExperience", v)}
        options={EXPERIENCE_OPTIONS}
        placeholder="Select a range"
        format={(v) => `${v} years`}
        error={errors.yearsExperience}
      />

      <div className="space-y-2">
        <Label htmlFor="onboarding-exits">
          Past exits <OptionalTag />
        </Label>
        <Input
          id="onboarding-exits"
          className="h-11"
          placeholder="e.g. Exited Series B SaaS in 2021"
          value={form.pastExits}
          onChange={(e) => update("pastExits", e.target.value)}
          aria-invalid={Boolean(errors.pastExits) || undefined}
          aria-describedby={errors.pastExits ? "onboarding-exits-error" : undefined}
        />
        <FieldError id="onboarding-exits-error" message={errors.pastExits} />
      </div>
    </div>
  );
}

function StepPreferences({ form, update, errors }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label id="onboarding-stages-label">Preferred stage</Label>
        <ToggleGroup
          multiple
          variant="outline"
          value={form.preferredStages}
          onValueChange={(next) =>
            update("preferredStages", normalizeStages(next, form.preferredStages))
          }
          aria-labelledby="onboarding-stages-label"
          aria-describedby={
            errors.preferredStages ? "onboarding-stages-error" : "onboarding-stages-hint"
          }
          className="flex-wrap gap-2"
        >
          {STAGE_OPTIONS.map((stage) => {
            const pressed = form.preferredStages.includes(stage.value);
            return (
              <ToggleGroupItem
                key={stage.value}
                value={stage.value}
                className="h-10 rounded-full border-border bg-card/60 px-4 text-muted-foreground hover:border-[color-mix(in_oklch,var(--primary)_35%,var(--border))] hover:bg-card hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.22)]"
              >
                <AnimatePresence initial={false}>
                  {pressed && (
                    <motion.span
                      key="check"
                      initial={{ width: 0, opacity: 0, scale: 0.5 }}
                      animate={{ width: "auto", opacity: 1, scale: 1 }}
                      exit={{ width: 0, opacity: 0, scale: 0.5 }}
                      transition={SPRING.snappy}
                      className="flex overflow-hidden"
                      aria-hidden="true"
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
                {stage.label}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        {errors.preferredStages ? (
          <FieldError id="onboarding-stages-error" message={errors.preferredStages} />
        ) : (
          <p id="onboarding-stages-hint" className="text-xs text-muted-foreground">
            Pick one or more. &ldquo;All&rdquo; means any stage.
          </p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          id="onboarding-capacity"
          label="Max startups / month"
          value={form.maxStartupsPerMonth}
          onChange={(v) => update("maxStartupsPerMonth", v)}
          options={CAPACITY_OPTIONS}
          placeholder="Select a number"
          error={errors.maxStartupsPerMonth}
        />
        <SelectField
          id="onboarding-availability"
          label="Availability"
          value={form.availability}
          onChange={(v) => update("availability", v)}
          options={AVAILABILITY_OPTIONS}
          placeholder="Select availability"
          error={errors.availability}
        />
      </div>
    </div>
  );
}

function SummaryRow({ label, children }) {
  const empty = children === undefined || children === null || children === "" || children === false;
  return (
    <div className="grid grid-cols-1 gap-1 py-2.5 text-sm sm:grid-cols-[9.5rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("break-words", empty ? "text-muted-foreground/70" : "text-foreground")}>
        {empty ? "—" : children}
      </dd>
    </div>
  );
}

function SummarySection({ title, step, onEdit, children, index = 0 }) {
  const Icon = STEPS[step - 1]?.icon;
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.08 * index }}
      className="rounded-2xl border border-border bg-muted/30 p-4 sm:p-5"
    >
      <div className="mb-1 flex items-center justify-between gap-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {Icon && (
            <span className="flex size-6 items-center justify-center rounded-md bg-primary/12 text-primary">
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
          )}
          {title}
        </h3>
        <Button
          type="button"
          variant="soft"
          size="xs"
          onClick={() => onEdit(step)}
          aria-label={`Edit ${title}`}
        >
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      </div>
      <dl className="divide-y divide-border">{children}</dl>
    </motion.section>
  );
}

function BadgeList({ items }) {
  if (!items.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item} variant="soft">
          {item}
        </Badge>
      ))}
    </span>
  );
}

function StepReview({ form, goTo }) {
  return (
    <div className="space-y-3">
      <SummarySection title="About You" step={1} onEdit={goTo} index={0}>
        <SummaryRow label="Full name">{form.name.trim()}</SummaryRow>
        <SummaryRow label="LinkedIn">{form.linkedinUrl.trim()}</SummaryRow>
        <SummaryRow label="Bio">{form.bio.trim()}</SummaryRow>
        <SummaryRow label="Geography">{form.geography}</SummaryRow>
      </SummarySection>
      <SummarySection title="Your Expertise" step={2} onEdit={goTo} index={1}>
        <SummaryRow label="Sectors">
          {form.sectorExpertise.length > 0 && (
            <BadgeList items={form.sectorExpertise.map(sectorLabel)} />
          )}
        </SummaryRow>
        <SummaryRow label="Experience">
          {form.yearsExperience && `${form.yearsExperience} years`}
        </SummaryRow>
        <SummaryRow label="Past exits">{form.pastExits.trim()}</SummaryRow>
      </SummarySection>
      <SummarySection title="Startup Preferences" step={3} onEdit={goTo} index={2}>
        <SummaryRow label="Stages">
          {form.preferredStages.length > 0 && (
            <BadgeList items={stageLabels(form.preferredStages)} />
          )}
        </SummaryRow>
        <SummaryRow label="Startups / month">{form.maxStartupsPerMonth}</SummaryRow>
        <SummaryRow label="Availability">{form.availability}</SummaryRow>
      </SummarySection>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

function MentorOnboardingContent() {
  const router = useRouter();
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Only mentor accounts may onboard; everyone else goes back to the landing page.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getMe()
      .then((me) => {
        if (cancelled) return;
        if (me?.role) setUserRole(me.role);
        if (me?.role !== "mentor") {
          toast.info("Mentor onboarding is only for mentor accounts.", { id: "not-mentor" });
          router.replace("/");
          return;
        }
        const profile = me.profile || {};
        setForm(formFromProfile(profile));
        setIsEditing(Boolean(profile.onboarding_completed || profile.years_experience));
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.status === 403) {
          router.replace("/");
          return;
        }
        setLoadError(err.message || "Could not load your account.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [router, reloadKey]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function goTo(target) {
    setDirection(target > step ? 1 : -1);
    setErrors({});
    setSubmitError("");
    setStep(target);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleNext() {
    const stepErrors = validateOnboardingStep(step, form);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    goTo(step + 1);
  }

  async function handleSubmit() {
    if (submitting) return;
    // Re-validate every step — "Edit" links let users jump around.
    for (let s = 1; s < TOTAL_STEPS; s += 1) {
      const stepErrors = validateOnboardingStep(s, form);
      if (Object.keys(stepErrors).length > 0) {
        goTo(s);
        setErrors(stepErrors);
        return;
      }
    }

    setSubmitting(true);
    setSubmitError("");
    try {
      await updateMentorProfile(toMentorProfilePayload(form));
      toast.success("You're live on Mentora!");
      router.push(roleHome("mentor"));
    } catch (err) {
      setSubmitError(err.message || "Could not save your profile.");
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <PageWrapper className="max-w-2xl">
        <div role="status" aria-label="Loading your profile" className="flex flex-col items-center">
          <Skeleton className="mb-4 h-4 w-28" />
          <Skeleton className="mb-3 h-10 w-80 max-w-full" />
          <Skeleton className="mb-10 h-5 w-96 max-w-full" />
          <Skeleton className="mb-10 h-14 w-full rounded-2xl" />
          <Skeleton className="h-[28rem] w-full rounded-3xl" />
        </div>
      </PageWrapper>
    );
  }

  if (status === "error") {
    return (
      <PageWrapper className="flex max-w-md flex-1 items-center">
        <StateCard
          tone="error"
          icon={CircleAlert}
          title="Couldn't load your profile"
          description={loadError}
          actions={
            <Button type="button" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </Button>
          }
        />
      </PageWrapper>
    );
  }

  const current = STEPS[step - 1];
  const CurrentIcon = current.icon;
  const isLast = step === TOTAL_STEPS;

  return (
    <PageWrapper className="max-w-2xl pt-4 sm:pt-8">
      <header className="mb-10 text-center">
        <p className="eyebrow inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Mentor profile
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {isEditing ? "Edit your" : "Set up your"}{" "}
          <span className="font-display text-[1.1em] font-normal italic text-gradient-primary">
            mentor profile
          </span>
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[0.9375rem] text-muted-foreground sm:text-base">
          A complete profile helps Mentora match you with startups you can genuinely help.
        </p>
      </header>

      <StepIndicator steps={STEP_LABELS} current={step - 1} className="mb-10" />

      <section
        aria-labelledby="onboarding-step-title"
        className="surface relative overflow-hidden rounded-3xl"
      >
        {/* Progress hairline along the card's top edge. */}
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-border/60">
          <motion.div
            className="h-full origin-left bg-gradient-to-r from-primary to-spark"
            initial={false}
            animate={{ scaleX: step / TOTAL_STEPS }}
            transition={SPRING.soft}
          />
        </div>

        <div className="flex items-start gap-4 border-b border-border px-5 py-5 sm:px-7">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={step}
              initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={SPRING.bouncy}
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary"
            >
              <CurrentIcon className="size-5" aria-hidden="true" />
            </motion.span>
          </AnimatePresence>
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Step {step} of {TOTAL_STEPS}
            </p>
            <h2
              id="onboarding-step-title"
              className="mt-1 text-lg font-semibold tracking-tight text-foreground"
            >
              {current.title}
            </h2>
            <p className="text-sm text-muted-foreground">{current.description}</p>
          </div>
        </div>

        <div className="overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: EASE_OUT }}
            >
              {step === 1 && <StepAbout form={form} update={update} errors={errors} />}
              {step === 2 && <StepExpertise form={form} update={update} errors={errors} />}
              {step === 3 && <StepPreferences form={form} update={update} errors={errors} />}
              {step === 4 && <StepReview form={form} goTo={goTo} />}
            </motion.div>
          </AnimatePresence>

          {submitError && <InlineError message={submitError} className="mt-5" />}
        </div>

        <div className="border-t border-border bg-muted/30 px-5 py-4 sm:px-7">
          {isLast ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => goTo(step - 1)}
                disabled={submitting}
              >
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
              <Button
                type="button"
                size="lg"
                className="w-full sm:w-auto"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                {submitting ? "Saving…" : "Complete profile"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => goTo(step - 1)}
                disabled={step === 1}
                className={cn(step === 1 && "invisible")}
              >
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
              <Button type="button" onClick={handleNext} className="pr-3">
                Continue
                <ArrowRight
                  className="transition-transform group-hover/button:translate-x-0.5"
                  aria-hidden="true"
                />
              </Button>
            </div>
          )}
        </div>
      </section>
    </PageWrapper>
  );
}

export default function MentorOnboardingPage() {
  return (
    <AuthGuard>
      <MentorOnboardingContent />
    </AuthGuard>
  );
}
