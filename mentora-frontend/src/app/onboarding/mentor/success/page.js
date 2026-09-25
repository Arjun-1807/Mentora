"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import AuthGuard from "@/components/AuthGuard";
import { PageShell } from "@/components/PageShell";
import { FadeIn, HoverCard } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export default function MentorOnboardingSuccessPage() {
  return (
    <AuthGuard>
      <PageShell width="md" center>
        <HoverCard>
          <Card>
            <CardContent className="flex flex-col items-center gap-5 py-10 text-center">
              <motion.span
                className="inline-flex h-14 w-14 items-center justify-center bg-primary/10 text-primary"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.15 }}
              >
                <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
              </motion.span>
              <div className="space-y-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                  You&apos;re live on Mentora.
                </h1>
                <p className="text-sm sm:text-base text-muted-foreground">
                  Startups can now find you.
                </p>
              </div>
              <FadeIn>
                <Button size="lg" render={<Link href="/dashboard" />}>
                  Go to Dashboard
                </Button>
              </FadeIn>
            </CardContent>
          </Card>
        </HoverCard>
      </PageShell>
    </AuthGuard>
  );
}
