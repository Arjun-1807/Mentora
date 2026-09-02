"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { PageShell, PageHeader } from "@/components/PageShell";
import { InlineError } from "@/components/StateCard";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FileText, Loader2, UploadCloud, X } from "lucide-react";
import { extractPitchDeck } from "@/lib/api";
import { setStoredMatches, setStoredProfile } from "@/lib/storage";

/** Matches the backend's own upload limit — reject early, before the request. */
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_LABEL = "10 MB";

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns an error message for a rejected file, or `null` when it's fine. */
function validateFile(file) {
  const isPdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (!isPdf) {
    return "That file isn't a PDF. Pitch decks must be uploaded as a PDF.";
  }
  if (file.size === 0) {
    return "That file is empty. Pick a PDF with content in it.";
  }
  if (file.size > MAX_BYTES) {
    return `That file is ${formatBytes(file.size)}. The limit is ${MAX_LABEL} — try exporting a lighter PDF.`;
  }
  return null;
}

function UploadPageContent() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  function acceptFile(candidate) {
    if (!candidate) return;
    const problem = validateFile(candidate);
    if (problem) {
      setFile(null);
      setFileError(problem);
      return;
    }
    setFileError("");
    setUploadError("");
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

  function clearFile() {
    setFile(null);
    setFileError("");
    setUploadError("");
  }

  function handleDragOver(e) {
    e.preventDefault();
    if (!loading) setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    if (loading) return;
    acceptFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  }

  async function handleAnalyze() {
    if (loading) return;
    if (!file) {
      setFileError("Choose a PDF pitch deck first.");
      return;
    }

    setLoading(true);
    setUploadError("");
    try {
      const data = await extractPitchDeck(file);
      setStoredProfile(data);
      // The old matches belong to the previous deck.
      setStoredMatches([]);
      toast.success("Pitch deck analyzed.");
      router.push("/profile");
    } catch (err) {
      setUploadError(err.message || "Something went wrong analyzing your deck.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell width="lg">
      <PageHeader
        align="center"
        title="Upload your pitch deck"
        description="We'll analyze your deck and extract a structured startup profile to find your best-fit mentors."
      />

      <Card>
        <CardHeader>
          <CardTitle>Pitch deck</CardTitle>
          <CardDescription>PDF only, up to {MAX_LABEL}.</CardDescription>
        </CardHeader>
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
          />

          <div
            role="button"
            tabIndex={loading ? -1 : 0}
            aria-controls="pitch-deck-input"
            aria-describedby="pitch-deck-hint"
            aria-label={
              file
                ? `Selected ${file.name}. Choose a different PDF pitch deck.`
                : `Choose a PDF pitch deck, up to ${MAX_LABEL}`
            }
            onClick={handleChooseFile}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                handleChooseFile();
              }
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`w-full flex flex-col items-center justify-center gap-3 border-2 border-dashed px-6 py-12 text-center outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${
              loading
                ? "cursor-not-allowed opacity-60 border-border"
                : "cursor-pointer"
            } ${
              isDragging
                ? "border-primary bg-primary/5"
                : fileError
                  ? "border-destructive/60"
                  : "border-border hover:border-primary/50 hover:bg-muted/40"
            }`}
          >
            <span className="inline-flex h-12 w-12 items-center justify-center bg-primary/10 text-primary">
              {file ? (
                <FileText className="h-6 w-6" aria-hidden="true" />
              ) : (
                <UploadCloud className="h-6 w-6" aria-hidden="true" />
              )}
            </span>
            <span className="text-sm font-medium text-foreground">
              {file ? "Change PDF file" : "Drag & drop a PDF, or press Enter to browse"}
            </span>
            <span id="pitch-deck-hint" className="text-xs text-muted-foreground">
              {file
                ? `${file.name} · ${formatBytes(file.size)}`
                : `PDF only, up to ${MAX_LABEL}`}
            </span>
          </div>

          {file && !loading && (
            <div className="flex justify-center">
              <Button type="button" variant="ghost" size="sm" onClick={clearFile}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Remove file
              </Button>
            </div>
          )}

          {fileError && <InlineError message={fileError} />}

          {uploadError && (
            <InlineError message={uploadError}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAnalyze}
                disabled={loading}
              >
                Try again
              </Button>
            </InlineError>
          )}

          <Button
            type="button"
            onClick={handleAnalyze}
            disabled={loading || !file}
            className="w-full"
            size="lg"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loading ? "Analyzing…" : "Analyze Pitch Deck"}
          </Button>
          <p aria-live="polite" className="sr-only">
            {loading ? "Analyzing your pitch deck" : ""}
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default function UploadPage() {
  return (
    <AuthGuard>
      <UploadPageContent />
    </AuthGuard>
  );
}
