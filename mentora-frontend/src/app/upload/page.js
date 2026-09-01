"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, UploadCloud } from "lucide-react";
import { extractPitchDeck } from "@/lib/api";

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  function handleFileChange(e) {
    const selected = e.target.files && e.target.files[0];
    if (selected) setFile(selected);
  }

  function handleChooseFile() {
    fileInputRef.current?.click();
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files && e.dataTransfer.files[0];
    if (dropped) {
      if (dropped.type !== "application/pdf") {
        toast.error("Please drop a PDF file.");
        return;
      }
      setFile(dropped);
    }
  }

  async function handleAnalyze() {
    if (!file) {
      toast.error("Please select a PDF pitch deck first.");
      return;
    }

    setLoading(true);
    try {
      const data = await extractPitchDeck(file);
      window.localStorage.setItem("startupProfile", JSON.stringify(data));
      toast.success("Pitch deck analyzed successfully.");
      router.push("/profile");
    } catch (err) {
      toast.error(err.message || "Something went wrong analyzing your deck.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-xl w-full">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold text-foreground mb-3">
              Upload your pitch deck
            </h1>
            <p className="text-muted-foreground">
              We&apos;ll analyze your deck and extract a structured startup
              profile to find your best-fit mentors.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pitch deck</CardTitle>
              <CardDescription>PDF only, up to a few MB.</CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />

              <div
                role="button"
                tabIndex={0}
                onClick={handleChooseFile}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleChooseFile();
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`w-full flex flex-col items-center justify-center gap-3 border-2 border-dashed px-6 py-14 text-center transition-colors cursor-pointer ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/40"
                }`}
              >
                <span className="inline-flex h-12 w-12 items-center justify-center bg-primary/10 text-primary">
                  {file ? (
                    <FileText className="h-6 w-6" />
                  ) : (
                    <UploadCloud className="h-6 w-6" />
                  )}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {file ? "Change PDF file" : "Drag & drop a PDF, or click to choose"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {file ? file.name : "PDF only, up to a few MB"}
                </span>
              </div>

              <Button
                type="button"
                onClick={handleAnalyze}
                disabled={loading}
                className="mt-6 w-full"
                size="lg"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "Analyzing..." : "Analyze Pitch Deck"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
