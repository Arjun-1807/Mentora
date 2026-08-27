"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Card from "@/components/Card";
import Spinner from "@/components/Spinner";

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleFileChange(e) {
    const selected = e.target.files && e.target.files[0];
    setError("");
    if (selected) {
      setFile(selected);
    }
  }

  function handleChooseFile() {
    fileInputRef.current?.click();
  }

  async function handleAnalyze() {
    if (!file) {
      setError("Please select a PDF pitch deck first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("http://localhost:8000/extract", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      const data = await res.json();
      window.localStorage.setItem("mentora_profile", JSON.stringify(data));
      router.push("/profile");
    } catch (err) {
      setError(
        "Something went wrong analyzing your deck. Please try again."
      );
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
            <h1 className="text-3xl font-extrabold text-white mb-3">
              Upload your pitch deck
            </h1>
            <p className="text-navy-100/70">
              We&apos;ll analyze your deck and extract a structured startup
              profile to find your best-fit mentors.
            </p>
          </div>

          <Card>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />

            <button
              type="button"
              onClick={handleChooseFile}
              className="w-full flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/15 bg-navy-900/60 px-6 py-10 text-center hover:border-accent/50 hover:bg-navy-900 transition-colors"
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent text-xl">
                +
              </span>
              <span className="text-sm font-medium text-white">
                {file ? "Change PDF file" : "Click to choose a PDF file"}
              </span>
              <span className="text-xs text-navy-100/50">
                {file ? file.name : "PDF only, up to a few MB"}
              </span>
            </button>

            {error && (
              <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleAnalyze}
              disabled={loading}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-base font-semibold text-navy-900 shadow-soft hover:bg-accent-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading && <Spinner />}
              {loading ? "Analyzing..." : "Analyze My Pitch Deck"}
            </button>
          </Card>
        </div>
      </main>
    </>
  );
}
