"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  FileText,
  Lightbulb,
  ScanText,
  Sparkles,
  Upload,
  UserRoundCheck,
  X,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { PageHeader, PageShell } from "@/components/PageShell";
import { FadeIn, SPRING } from "@/components/motion";
import { InlineError } from "@/components/StateCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { extractPitchDeck } from "@/lib/api";
import { clearStoredMatches, setStoredProfile } from "@/lib/storage";
import { MAX_UPLOAD_BYTES, validateUploadFile } from "@/lib/validation";
import { cn } from "@/lib/utils";

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdf(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

/** Inline (never toasted) validation, worded per the spec; falls back to the shared rules. */
function checkFile(file) {
  if (file && !isPdf(file)) return "Only PDF files are supported";
  if (file && file.size > MAX_UPLOAD_BYTES) return "File too large. Maximum size is 10MB";
  return validateUploadFile(file);
}

/** Statuses where the deck itself was the problem (vs. auth, rate limits…). */
const DECK_PROBLEM_STATUSES = new Set([400, 413, 422, 500, 502]);
const DECK_ERROR_HINT = "Make sure it's a text-based PDF exported from Slides, Keynote or PowerPoint.";

const STAGES = [
  { label: "Extracting text", detail: "Reading every slide of your PDF.", icon: ScanText },
  {
    label: "Analyzing with AI",
    detail: "Finding your domain, stage, challenges and team gaps.",
    icon: Sparkles,
  },
  { label: "Building your profile", detail: "Structuring it for mentor matching.", icon: UserRoundCheck },
];

const TIPS = [
  "Export a text-based PDF from Slides, Keynote or PowerPoint.",
  "Include your team, traction and ask slides.",
  "Name the problems you want help with.",
];

/** Which of STAGES the fake progress is in (mirrors statusTextFor). */
function stageIndexFor(progress) {
  if (progress < 30) return 0;
  if (progress < 70) return 1;
  return 2;
}

/** A stylised deck "slide" with a scan line sweeping over it while analyzing. */
function DeckTile({ scanning }) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="absolute inset-0 translate-x-2 translate-y-2 rotate-6 rounded-xl border border-border bg-card/70"
      />
      <div className="relative flex h-24 w-20 flex-col gap-1.5 overflow-hidden rounded-xl border border-border bg-card p-2.5 shadow-soft">
        <span className="h-1.5 w-10 rounded-full bg-primary/60" />
        <span className="h-1 w-full rounded-full bg-muted-foreground/25" />
        <span className="h-1 w-4/5 rounded-full bg-muted-foreground/25" />
        <span className="h-1 w-full rounded-full bg-muted-foreground/25" />
        <span className="mt-auto h-6 w-full rounded-md bg-gradient-to-r from-primary/25 to-spark/25" />
        {scanning && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-x-0 h-6 bg-gradient-to-b from-transparent via-primary/35 to-transparent"
            initial={{ top: "-25%" }}
            animate={{ top: ["-25%", "100%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", repeatType: "reverse" }}
          />
        )}
      </div>
      {!scanning && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ ...SPRING.bouncy, delay: 0.1 }}
          className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-success text-background shadow-soft"
        >
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        </motion.span>
      )}
    </div>
  );
}

function statusTextFor(progress) {
  if (progress < 30) return "Extracting text...";
  if (progress < 70) return "Analyzing with AI...";
  return "Building your profile...";
}

function UploadPageContent() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const intervalRef = useRef(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileError, setFileError] = useState("");
  const [uploadError, setUploadError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => () => clearInterval(intervalRef.current), []);

  function acceptFile(candidate) {
    if (!candidate) return;
    const problem = checkFile(candidate);
    setUploadError(null);
    if (problem) {
      setFile(null);
      setFileError(problem);
      return;
    }
    setFileError("");
    setFile(candidate);
  }

  function handleFileChange(e) {
    acceptFile(e.target.files && e.target.files[0]);
    // Let the same file be re-picked after an error.
    e.target.value = "";
  }

  function handleChooseFile() {
    if (loading) return;
    fileInputRef.current?.click();
  }

  function clearFile(e) {
    e?.stopPropagation();
    setFile(null);
    setFileError("");
    setUploadError(null);
  }

  function handleDragOver(e) {
    e.preventDefault();
    if (!loading) setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    // Ignore leave events fired when moving between the zone's children.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    if (loading) return;
    acceptFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  }

  function startFakeProgress() {
    clearInterval(intervalRef.current);
    setProgress(4);
    intervalRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 90) return 90;
        // Fast at first, easing off as it approaches 90%.
        const step = Math.max(0.6, (90 - p) * 0.06);
        return Math.min(90, p + step);
      });
    }, 200);
  }

  function stopFakeProgress() {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  }

  async function handleAnalyze() {
    if (loading) return;
    // Re-check right before the request, in case the file changed on disk.
    const problem = checkFile(file);
    if (problem) {
      setFileError(problem);
      return;
    }

    setLoading(true);
    setUploadError(null);
    startFakeProgress();
    try {
      const data = await extractPitchDeck(file);
      stopFakeProgress();
      setProgress(100);
      // Keep everything /extract returned, including `deck_feedback`.
      setStoredProfile(data);
      // The old matches belong to the previous deck; clearing them (rather
      // than storing []) tells /matches that matching hasn't run yet.
      clearStoredMatches();
      toast.success("Profile extracted");
      // Let the bar visibly reach 100% before leaving.
      setTimeout(() => router.push("/profile"), 350);
    } catch (err) {
      stopFakeProgress();
      setProgress(0);
      setLoading(false);
      // Network failures (status 0) already raised the "Server unavailable"
      // toast in api.js — show the inline message only.
      setUploadError({
        message: err.message || "Something went wrong analyzing your deck.",
        hint: DECK_PROBLEM_STATUSES.has(err.status) ? DECK_ERROR_HINT : "",
      });
    }
  }

  const statusText = statusTextFor(progress);
  const stageIndex = stageIndexFor(progress);

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Step 1 of 3 · Upload"
        title={
          <>
            Upload your{" "}
            <span className="font-display text-[1.12em] font-normal italic text-gradient-primary">
              pitch deck
            </span>
          </>
        }
        description="We'll read your deck and build a startup profile to find your best-fit mentors."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <FadeIn className="surface relative min-w-0 overflow-hidden rounded-3xl p-4 sm:p-6">
          <Label htmlFor="pitch-deck-input" className="sr-only">
            Pitch deck PDF
          </Label>
          <input
            id="pitch-deck-input"
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            disabled={loading}
            className="sr-only"
            aria-describedby={fileError ? "pitch-deck-error" : undefined}
          />

          <motion.div
            role="button"
            tabIndex={loading ? -1 : 0}
            aria-controls="pitch-deck-input"
            aria-disabled={loading || undefined}
            aria-label={
              file
                ? `Selected ${file.name}. Press Enter to choose a different PDF.`
                : "Drop your PDF here or press Enter to browse. Supports PDF, max 10MB"
            }
            onClick={handleChooseFile}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                handleChooseFile();
              }
            }}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            animate={{ scale: isDragging ? 1.015 : 1 }}
            transition={SPRING.soft}
            className={cn(
              "group/drop relative isolate flex min-h-[300px] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl border-2 px-6 py-12 text-center outline-none transition-colors duration-300 focus-visible:ring-4 focus-visible:ring-primary/20 sm:min-h-[340px]",
              loading ? "cursor-not-allowed" : "cursor-pointer",
              isDragging
                ? "border-solid border-primary bg-primary/8"
                : fileError
                  ? "border-dashed border-destructive/50 bg-destructive/5"
                  : file
                    ? "border-dashed border-primary/40 bg-primary/5"
                    : "border-dashed border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5"
            )}
          >
            {/* Dot texture + glow that brightens on hover / drag. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 bg-dots [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
            />
            <div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute left-1/2 top-1/2 -z-10 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl transition-opacity duration-500",
                isDragging || loading ? "opacity-100" : "opacity-0 group-hover/drop:opacity-60"
              )}
            />

            <AnimatePresence mode="wait" initial={false}>
              {file ? (
                <motion.div
                  key="file"
                  initial={{ opacity: 0, scale: 0.92, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={SPRING.soft}
                  className="flex max-w-full flex-col items-center gap-4"
                >
                  <DeckTile scanning={loading} />
                  <div className="flex max-w-full flex-col items-center gap-1">
                    <div className="flex max-w-full items-center gap-2">
                      <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="truncate text-sm font-medium text-foreground">{file.name}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatBytes(file.size)} · PDF
                    </span>
                  </div>
                  {!loading && (
                    <button
                      type="button"
                      onClick={clearFile}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <X className="size-3" aria-hidden="true" />
                      Remove
                    </button>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col items-center gap-4"
                >
                  <motion.span
                    animate={isDragging ? { y: -8, scale: 1.08 } : { y: 0, scale: 1 }}
                    transition={SPRING.bouncy}
                    className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[color-mix(in_oklch,var(--primary),var(--spark)_55%)] text-primary-foreground shadow-glow"
                  >
                    <Upload className="size-7" aria-hidden="true" />
                  </motion.span>
                  <div className="space-y-1.5">
                    <p className="text-base font-semibold text-foreground">
                      {isDragging ? "Release to upload" : "Drop your PDF here or click to browse"}
                    </p>
                    <p className="text-sm text-muted-foreground">Supports PDF · Max 10MB</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <div className="mt-5 space-y-4">
            <AnimatePresence initial={false}>
              {fileError && (
                <motion.p
                  key="file-error"
                  id="pitch-deck-error"
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 text-sm text-destructive"
                >
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  {fileError}
                </motion.p>
              )}
            </AnimatePresence>

            {uploadError && (
              <InlineError message={uploadError.message}>
                <Button type="button" size="sm" variant="outline" onClick={handleAnalyze} disabled={loading}>
                  Try again
                </Button>
              </InlineError>
            )}
            {uploadError?.hint && (
              <p className="-mt-2 text-xs text-muted-foreground">{uploadError.hint}</p>
            )}

            {loading ? (
              <div className="space-y-2.5" role="status" aria-live="polite">
                <Progress value={Math.round(progress)} aria-label="Analyzing your pitch deck" />
                <div className="flex items-center justify-between text-xs">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={statusText}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="font-medium text-foreground"
                    >
                      {statusText}
                    </motion.span>
                  </AnimatePresence>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {Math.round(progress)}%
                  </span>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                onClick={handleAnalyze}
                disabled={!file}
                className="w-full"
                size="xl"
              >
                <Sparkles aria-hidden="true" />
                Analyze My Deck
              </Button>
            )}
          </div>
        </FadeIn>

        <div className="flex min-w-0 flex-col gap-6">
          <FadeIn className="surface rounded-3xl p-5 sm:p-6">
            <p className="eyebrow">{loading ? "Analyzing" : "What happens next"}</p>
            <ol className="relative mt-5 space-y-5">
              <span
                aria-hidden="true"
                className="absolute bottom-3 left-[17px] top-3 w-px bg-border"
              />
              {STAGES.map((stage, i) => {
                const Icon = stage.icon;
                const done = loading && (i < stageIndex || progress >= 100);
                const active = loading && !done && i === stageIndex;
                return (
                  <li key={stage.label} className="relative flex items-start gap-3.5">
                    <span className="relative flex size-[35px] shrink-0 items-center justify-center">
                      {active && (
                        <span
                          aria-hidden="true"
                          className="step-pulse-ring absolute inset-0 rounded-xl bg-primary/40"
                        />
                      )}
                      <span
                        className={cn(
                          "relative flex size-[35px] items-center justify-center rounded-xl border transition-colors duration-300",
                          done
                            ? "border-success/30 bg-success/12 text-success"
                            : active
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-muted-foreground"
                        )}
                      >
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={done ? "done" : "icon"}
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.5, opacity: 0 }}
                            transition={SPRING.bouncy}
                            className="flex"
                          >
                            {done ? (
                              <Check className="size-4" strokeWidth={3} aria-hidden="true" />
                            ) : (
                              <Icon className="size-4" aria-hidden="true" />
                            )}
                          </motion.span>
                        </AnimatePresence>
                      </span>
                    </span>
                    <div className="min-w-0 pt-1">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          active || done || !loading ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {stage.label}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {stage.detail}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </FadeIn>

          <FadeIn className="rounded-3xl border border-dashed border-border bg-muted/30 p-5 sm:p-6">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Lightbulb className="size-4 text-spark" aria-hidden="true" />
              For the sharpest matches
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {TIPS.map((tip) => (
                <li key={tip} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
                  {tip}
                </li>
              ))}
            </ul>
          </FadeIn>
        </div>
      </div>
    </PageShell>
  );
}

export default function UploadPage() {
  return (
    <AuthGuard requiredRole="startup">
      <UploadPageContent />
    </AuthGuard>
  );
}
