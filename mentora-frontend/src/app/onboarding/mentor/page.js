"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, Pencil } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import PageWrapper from "@/components/layout/PageWrapper";
import StepIndicator from "@/components/ui/StepIndicator";
import { InlineError } from "@/components/StateCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  parseSkills,
  sectorLabel,
  toMentorProfilePayload,
  validateOnboardingStep,
} from "@/lib/validation";
import { FieldError, SectorMultiSelect, SelectField } from "./_components/fields";

const STEPS = [
  { title: "About You", description: "Tell startups who you are." },
  { title: "Your Expertise", description: "Where you can help most." },
  { title: "Startup Preferences", description: "Who you'd like to mentor, and how often." },
  { title: "Review", description: "Check everything before you go live." },
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
  skills: "",
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
    skills: parseSkills(profile.skills).join(", "),
    preferredStages: stages.filter((s) => stageValues.includes(s)),
    maxStartupsPerMonth: pick(String(profile.max_startups_per_month ?? ""), CAPACITY_OPTIONS),
    availability: pick(profile.availability, AVAILABILITY_OPTIONS),
  };
}

function stageLabels(values) {
  return STAGE_OPTIONS.filter((s) => values.includes(s.value)).map((s) => s.label);
}

const slide = {
  enter: (dir) => ({ opacity: 0, x: dir >= 0 ? 40 : -40 }),
  center: { opacity: 1, x: 0 },
  exit: (dir) => ({ opacity: 0, x: dir >= 0 ? -40 : 40 }),
};

/* ------------------------------------------------------------------ steps */

function StepAbout({ form, update, errors }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="onboarding-name">Full name</Label>
        <Input
          id="onboarding-name"
          autoComplete="name"
          className="h-10"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          aria-invalid={Boolean(errors.name) || undefined}
          aria-describedby={errors.name ? "onboarding-name-error" : undefined}
        />
        <FieldError id="onboarding-name-error" message={errors.name} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="onboarding-linkedin">
          LinkedIn URL <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="onboarding-linkedin"
          type="url"
          inputMode="url"
          className="h-10"
          placeholder="https://linkedin.com/in/your-name"
          value={form.linkedinUrl}
          onChange={(e) => update("linkedinUrl", e.target.value)}
          aria-invalid={Boolean(errors.linkedinUrl) || undefined}
          aria-describedby={errors.linkedinUrl ? "onboarding-linkedin-error" : undefined}
        />
        <FieldError id="onboarding-linkedin-error" message={errors.linkedinUrl} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="onboarding-bio">
          Short bio <span className="font-normal text-muted-foreground">(optional)</span>
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
              "ml-auto text-xs tabular-nums",
              form.bio.length >= MAX_BIO_LENGTH
                ? "text-destructive"
                : form.bio.length >= MAX_BIO_LENGTH * 0.9
                  ? "text-amber-300"
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
    <div className="space-y-5">
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

      <div className="space-y-1.5">
        <Label htmlFor="onboarding-exits">
          Past exits <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="onboarding-exits"
          className="h-10"
          placeholder="e.g. Exited Series B SaaS in 2021"
          value={form.pastExits}
          onChange={(e) => update("pastExits", e.target.value)}
          aria-invalid={Boolean(errors.pastExits) || undefined}
          aria-describedby={errors.pastExits ? "onboarding-exits-error" : undefined}
        />
        <FieldError id="onboarding-exits-error" message={errors.pastExits} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="onboarding-skills">
          Skills <span className="font-normal text-muted-foreground">(optional, comma-separated)</span>
        </Label>
        <Input
          id="onboarding-skills"
          className="h-10"
          placeholder="e.g. Seed fundraising, Enterprise sales, Hiring engineers"
          value={form.skills}
          onChange={(e) => update("skills", e.target.value)}
          aria-invalid={Boolean(errors.skills) || undefined}
          aria-describedby={errors.skills ? "onboarding-skills-error" : "onboarding-skills-hint"}
        />
        {errors.skills ? (
          <FieldError id="onboarding-skills-error" message={errors.skills} />
        ) : (
          <p id="onboarding-skills-hint" className="text-xs text-muted-foreground">
            We match these against startups&rsquo; challenges and team gaps.
          </p>
        )}
      </div>
    </div>
  );
}

function StepPreferences({ form, update, errors }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
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
          className="flex-wrap"
        >
          {STAGE_OPTIONS.map((stage) => (
            <ToggleGroupItem
              key={stage.value}
              value={stage.value}
              className="h-9 px-4 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {stage.label}
            </ToggleGroupItem>
          ))}
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
    <div className="grid grid-cols-1 gap-1 py-2 text-sm sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("break-words", empty ? "text-muted-foreground" : "text-foreground")}>
        {empty ? "—" : children}
      </dd>
    </div>
  );
}

function SummarySection({ title, step, onEdit, children }) {
  return (
    <section className="border-b border-border py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto gap-1 px-0"
          onClick={() => onEdit(step)}
          aria-label={`Edit ${title}`}
        >
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      </div>
      <dl>{children}</dl>
    </section>
  );
}

function BadgeList({ items }) {
  if (!items.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item} variant="secondary">
          {item}
        </Badge>
      ))}
    </span>
  );
}

function StepReview({ form, goTo }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 sm:p-5">
      <SummarySection title="About You" step={1} onEdit={goTo}>
        <SummaryRow label="Full name">{form.name.trim()}</SummaryRow>
        <SummaryRow label="LinkedIn">{form.linkedinUrl.trim()}</SummaryRow>
        <SummaryRow label="Bio">{form.bio.trim()}</SummaryRow>
        <SummaryRow label="Geography">{form.geography}</SummaryRow>
      </SummarySection>
      <SummarySection title="Your Expertise" step={2} onEdit={goTo}>
        <SummaryRow label="Sectors">
          {form.sectorExpertise.length > 0 && (
            <BadgeList items={form.sectorExpertise.map(sectorLabel)} />
          )}
        </SummaryRow>
        <SummaryRow label="Experience">
          {form.yearsExperience && `${form.yearsExperience} years`}
        </SummaryRow>
        <SummaryRow label="Past exits">{form.pastExits.trim()}</SummaryRow>
        <SummaryRow label="Skills">
          {parseSkills(form.skills).length > 0 && <BadgeList items={parseSkills(form.skills)} />}
        </SummaryRow>
      </SummarySection>
      <SummarySection title="Startup Preferences" step={3} onEdit={goTo}>
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
        <Skeleton className="mx-auto mb-3 h-9 w-72" />
        <Skeleton className="mx-auto mb-10 h-5 w-96 max-w-full" />
        <Skeleton className="mb-8 h-14 w-full" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </PageWrapper>
    );
  }

  if (status === "error") {
    return (
      <PageWrapper className="flex max-w-2xl flex-1 items-center">
        <InlineError message={loadError} className="w-full rounded-lg">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Try again
          </Button>
        </InlineError>
      </PageWrapper>
    );
  }

  const current = STEPS[step - 1];
  const isLast = step === TOTAL_STEPS;

  return (
    <PageWrapper className="max-w-2xl">
      <header className="mb-8 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
          Mentor profile
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {isEditing ? "Edit your mentor profile" : "Set up your mentor profile"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          A complete profile helps Mentora match you with startups you can genuinely help.
        </p>
      </header>

      <StepIndicator steps={STEP_LABELS} current={step - 1} className="mb-8" />

      <Card className="overflow-hidden">
        <CardHeader className="px-5 sm:px-6">
          <CardTitle className="text-lg font-semibold">{current.title}</CardTitle>
          <CardDescription>{current.description}</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-1 sm:px-6">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {step === 1 && <StepAbout form={form} update={update} errors={errors} />}
              {step === 2 && <StepExpertise form={form} update={update} errors={errors} />}
              {step === 3 && <StepPreferences form={form} update={update} errors={errors} />}
              {step === 4 && <StepReview form={form} goTo={goTo} />}
            </motion.div>
          </AnimatePresence>

          {submitError && <InlineError message={submitError} className="mt-5 rounded-lg" />}

          {isLast ? (
            <div className="mt-6 space-y-3">
              <Button
                type="button"
                className="h-11 w-full text-base"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {submitting ? "Saving…" : "Complete Profile"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => goTo(step - 1)}
                disabled={submitting}
              >
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
            </div>
          ) : (
            <div className="mt-6 flex items-center justify-between gap-3">
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
              <Button type="button" className="h-9 px-4" onClick={handleNext}>
                Next
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
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
