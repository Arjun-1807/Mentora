"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import AuthGuard from "@/components/AuthGuard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { InlineError } from "@/components/StateCard";
import { FadeIn, HoverCard } from "@/components/motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChevronsUpDown, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMe, updateMentorProfile } from "@/lib/api";
import {
  AVAILABILITY_OPTIONS,
  CAPACITY_OPTIONS,
  EXPERIENCE_OPTIONS,
  GEOGRAPHY_OPTIONS,
  MAX_BIO_LENGTH,
  SECTOR_OPTIONS,
  STAGE_OPTIONS,
  normalizeStages,
  toMentorProfilePayload,
  validateOnboardingStep,
} from "@/lib/validation";

const STEPS = [
  { title: "About You", description: "Tell startups who you are." },
  { title: "Your Expertise", description: "Where you can help most." },
  { title: "Startup Preferences", description: "Who you'd like to mentor, and when." },
  { title: "Review & Submit", description: "Check everything before you go live." },
];
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
  const stages = Array.isArray(profile.preferred_stages) ? profile.preferred_stages : [];
  return {
    ...EMPTY_FORM,
    name: profile.name || "",
    linkedinUrl: profile.linkedin_url || "",
    bio: profile.bio || "",
    geography: pick(profile.geography, GEOGRAPHY_OPTIONS),
    sectorExpertise: sectors.filter((s) => SECTOR_OPTIONS.includes(s)),
    yearsExperience: pick(profile.years_experience, EXPERIENCE_OPTIONS),
    pastExits: typeof profile.past_exits === "string" ? profile.past_exits : "",
    preferredStages: stages.filter((s) => stageValues.includes(s)),
    maxStartupsPerMonth: pick(profile.max_startups_per_month, CAPACITY_OPTIONS),
    availability: pick(profile.availability, AVAILABILITY_OPTIONS),
  };
}

function stageLabels(values) {
  return STAGE_OPTIONS.filter((s) => values.includes(s.value)).map((s) => s.label);
}

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

/** "Step N of 4" plus a segmented bar whose filled part animates between steps. */
function StepIndicator({ step }) {
  return (
    <div className="mb-6" aria-label={`Step ${step} of ${TOTAL_STEPS}`}>
      <div className="mb-2 flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium text-foreground">
          Step {step} of {TOTAL_STEPS}
        </span>
        <span className="text-muted-foreground truncate">{STEPS[step - 1].title}</span>
      </div>
      <ol className="grid grid-cols-4 gap-1.5">
        {STEPS.map((s, i) => {
          const index = i + 1;
          return (
            <li key={s.title} className="relative h-1.5 overflow-hidden bg-muted">
              <motion.span
                className="absolute inset-y-0 left-0 bg-primary"
                initial={false}
                animate={{ width: index <= step ? "100%" : "0%" }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              />
              <span className="sr-only">
                {s.title}
                {index < step ? " (done)" : index === step ? " (current)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SelectField({ id, label, value, onChange, options, placeholder, error, format }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          className="w-full"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <SelectValue placeholder={placeholder}>
            {(current) => (current ? (format ? format(current) : current) : placeholder)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {format ? format(option) : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

/** Searchable multi-select for sectors, built on Command inside a Popover. */
function SectorMultiSelect({ value, onChange, error }) {
  const [open, setOpen] = useState(false);

  function toggle(sector) {
    onChange(value.includes(sector) ? value.filter((s) => s !== sector) : [...value, sector]);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="onboarding-sectors">Sector expertise</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id="onboarding-sectors"
              type="button"
              variant="outline"
              className="w-full justify-between font-normal"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "onboarding-sectors-error" : undefined}
            />
          }
        >
          <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
            {value.length === 0
              ? "Search and select sectors"
              : `${value.length} sector${value.length === 1 ? "" : "s"} selected`}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) p-0" align="start">
          <Command>
            <CommandInput placeholder="Search sectors…" />
            <CommandList>
              <CommandEmpty>No sector found.</CommandEmpty>
              <CommandGroup>
                {SECTOR_OPTIONS.map((sector) => {
                  const selected = value.includes(sector);
                  return (
                    <CommandItem
                      key={sector}
                      value={sector}
                      data-checked={selected}
                      aria-selected={selected}
                      onSelect={() => toggle(sector)}
                    >
                      {sector}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2 pt-1" aria-label="Selected sectors">
          {value.map((sector) => (
            <li key={sector}>
              <Badge variant="secondary" className="gap-1 pr-1">
                {sector}
                <button
                  type="button"
                  onClick={() => toggle(sector)}
                  className="inline-flex items-center justify-center p-0.5 hover:text-foreground"
                  aria-label={`Remove ${sector}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <FieldError id="onboarding-sectors-error" message={error} />
    </div>
  );
}

function StepAbout({ form, update, errors }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="onboarding-name">Full name</Label>
        <Input
          id="onboarding-name"
          autoComplete="name"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          aria-invalid={Boolean(errors.name) || undefined}
          aria-describedby={errors.name ? "onboarding-name-error" : undefined}
        />
        <FieldError id="onboarding-name-error" message={errors.name} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="onboarding-linkedin">
          LinkedIn URL <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="onboarding-linkedin"
          type="url"
          inputMode="url"
          placeholder="https://linkedin.com/in/your-name"
          value={form.linkedinUrl}
          onChange={(e) => update("linkedinUrl", e.target.value)}
          aria-invalid={Boolean(errors.linkedinUrl) || undefined}
          aria-describedby={errors.linkedinUrl ? "onboarding-linkedin-error" : undefined}
        />
        <FieldError id="onboarding-linkedin-error" message={errors.linkedinUrl} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="onboarding-bio">Short bio</Label>
          <span
            id="onboarding-bio-count"
            className={cn(
              "text-xs tabular-nums",
              form.bio.length >= MAX_BIO_LENGTH ? "text-destructive" : "text-muted-foreground"
            )}
            aria-live="polite"
          >
            {form.bio.length}/{MAX_BIO_LENGTH}
          </span>
        </div>
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
        <FieldError id="onboarding-bio-error" message={errors.bio} />
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
          Past exits <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="onboarding-exits"
          placeholder="e.g. Exited Series B SaaS startup in 2021"
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
          aria-describedby={errors.preferredStages ? "onboarding-stages-error" : undefined}
          className="flex-wrap"
        >
          {STAGE_OPTIONS.map((stage) => (
            <ToggleGroupItem
              key={stage.value}
              value={stage.value}
              className="px-4 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:border-primary"
            >
              {stage.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldError id="onboarding-stages-error" message={errors.preferredStages} />
      </div>

      <SelectField
        id="onboarding-capacity"
        label="Max startups per month"
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
  );
}

function SummaryRow({ label, children }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground break-words">{children || "—"}</dd>
    </div>
  );
}

function SummarySection({ title, step, onEdit, children }) {
  return (
    <section className="py-4 first:pt-0 last:pb-0 border-b border-border last:border-0">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={() => onEdit(step)}
          aria-label={`Edit ${title}`}
        >
          Edit
        </Button>
      </div>
      <dl>{children}</dl>
    </section>
  );
}

function StepReview({ form, goTo }) {
  return (
    <Card size="sm" className="bg-muted/30">
      <CardContent>
        <SummarySection title="About You" step={1} onEdit={goTo}>
          <SummaryRow label="Full name">{form.name}</SummaryRow>
          <SummaryRow label="LinkedIn">{form.linkedinUrl}</SummaryRow>
          <SummaryRow label="Bio">{form.bio}</SummaryRow>
          <SummaryRow label="Geography">{form.geography}</SummaryRow>
        </SummarySection>
        <SummarySection title="Your Expertise" step={2} onEdit={goTo}>
          <SummaryRow label="Sectors">{form.sectorExpertise.join(", ")}</SummaryRow>
          <SummaryRow label="Experience">
            {form.yearsExperience && `${form.yearsExperience} years`}
          </SummaryRow>
          <SummaryRow label="Past exits">{form.pastExits}</SummaryRow>
        </SummarySection>
        <SummarySection title="Startup Preferences" step={3} onEdit={goTo}>
          <SummaryRow label="Stages">{stageLabels(form.preferredStages).join(", ")}</SummaryRow>
          <SummaryRow label="Startups / month">{form.maxStartupsPerMonth}</SummaryRow>
          <SummaryRow label="Availability">{form.availability}</SummaryRow>
        </SummarySection>
      </CardContent>
    </Card>
  );
}

function MentorOnboardingContent() {
  const router = useRouter();
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Only mentor accounts may onboard; startups are sent back to their flow.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getMe()
      .then((me) => {
        if (cancelled) return;
        if (me?.role !== "mentor") {
          toast.info("Mentor onboarding is only for mentor accounts.", { id: "not-mentor" });
          router.replace("/upload");
          return;
        }
        setForm(formFromProfile(me.profile || {}));
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
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
    setStep(target);
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
      router.push("/onboarding/mentor/success");
    } catch (err) {
      setSubmitError(err.message || "Could not save your profile.");
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <PageShell key="loading" width="lg">
        <Skeleton className="h-9 w-64 mx-auto mb-3" />
        <Skeleton className="h-5 w-80 mx-auto mb-10" />
        <Skeleton className="h-96 w-full" />
      </PageShell>
    );
  }

  if (status === "error") {
    return (
      <PageShell key="error" width="lg" center>
        <FadeIn className="w-full">
          <InlineError message={loadError}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Try again
            </Button>
          </InlineError>
        </FadeIn>
      </PageShell>
    );
  }

  const current = STEPS[step - 1];
  const isLast = step === TOTAL_STEPS;

  return (
    <PageShell width="lg">
      <PageHeader
        align="center"
        title="Set up your mentor profile"
        description="A complete profile helps Mentora match you with startups you can genuinely help."
      />

      <HoverCard>
        <Card>
          <CardHeader>
            <StepIndicator step={step} />
            <CardTitle>{current.title}</CardTitle>
            <CardDescription>{current.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                initial={{ opacity: 0, x: direction * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -24 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                {step === 1 && <StepAbout form={form} update={update} errors={errors} />}
                {step === 2 && <StepExpertise form={form} update={update} errors={errors} />}
                {step === 3 && <StepPreferences form={form} update={update} errors={errors} />}
                {step === 4 && <StepReview form={form} goTo={goTo} />}
              </motion.div>
            </AnimatePresence>

            {submitError && <InlineError message={submitError} className="mt-5" />}

            <div className="mt-6 flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => goTo(step - 1)}
                disabled={step === 1 || submitting}
              >
                Back
              </Button>
              {isLast ? (
                <Button type="button" onClick={handleSubmit} disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {submitting ? "Saving…" : "Complete Profile"}
                </Button>
              ) : (
                <Button type="button" onClick={handleNext}>
                  Next
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </HoverCard>
    </PageShell>
  );
}

export default function MentorOnboardingPage() {
  return (
    <AuthGuard>
      <MentorOnboardingContent />
    </AuthGuard>
  );
}
