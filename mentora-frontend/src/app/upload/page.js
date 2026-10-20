"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FileText, Upload } from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import PageWrapper from "@/components/layout/PageWrapper";
import { InlineError } from "@/components/StateCard";
import { Card, CardContent } from "@/components/ui/card";
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

  return (
    <PageWrapper className="max-w-lg">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Upload your pitch deck</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;ll read your deck and build a startup profile to find your best-fit mentors.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
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

          <div
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
            className={cn(
              "flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 px-6 py-12 text-center outline-none transition-colors duration-200 focus-visible:ring-3 focus-visible:ring-ring/50",
              loading ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              isDragging
                ? "border-solid border-primary bg-primary/5"
                : fileError
                  ? "border-dashed border-destructive/60"
                  : file
                    ? "border-dashed border-primary/40"
                    : "border-dashed border-border hover:border-primary/50 hover:bg-muted/30"
            )}
          >
            {file ? (
              <>
                <CheckCircle2 className="h-10 w-10 text-primary" aria-hidden="true" />
                <div className="flex max-w-full items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate text-sm font-medium text-foreground">{file.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                {!loading && (
                  <button
                    type="button"
                    onClick={clearFile}
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    Remove
                  </button>
                )}
              </>
            ) : (
              <>
                <motion.span
                  whileHover={{ scale: 1.1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"
                >
                  <Upload className="h-6 w-6" aria-hidden="true" />
                </motion.span>
                <span className="text-sm font-medium text-foreground">
                  Drop your PDF here or click to browse
                </span>
                <span className="text-xs text-muted-foreground">Supports PDF · Max 10MB</span>
              </>
            )}
          </div>

          {fileError && (
            <p id="pitch-deck-error" role="alert" className="text-sm text-destructive">
              {fileError}
            </p>
          )}

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
            <div className="space-y-2 pt-1" role="status" aria-live="polite">
              <Progress value={Math.round(progress)} aria-label="Analyzing your pitch deck" />
              <div className="flex items-center justify-between text-xs">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={statusText}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="text-muted-foreground"
                  >
                    {statusText}
                  </motion.span>
                </AnimatePresence>
                <span className="tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              onClick={handleAnalyze}
              disabled={!file}
              className="w-full"
              size="lg"
            >
              Analyze My Deck
            </Button>
          )}
        </CardContent>
      </Card>
    </PageWrapper>
  );
}

export default function UploadPage() {
  return (
    <AuthGuard requiredRole="startup">
      <UploadPageContent />
    </AuthGuard>
  );
}
