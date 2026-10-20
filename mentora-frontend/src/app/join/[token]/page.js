"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2Off, Loader2 } from "lucide-react";
import AuthSplitLayout from "@/components/layout/AuthSplitLayout";
import RegisterForm, { ROLE_META } from "@/components/auth/RegisterForm";
import { StateCard } from "@/components/StateCard";
import { Button } from "@/components/ui/button";
import { getInvitePreview } from "@/lib/api";

const ROLE_ARTICLE = { startup: "a startup", mentor: "a mentor", coordinator: "a coordinator" };

function inviteDescription(invite) {
  const where = `${invite.cohort_name} at ${invite.org_name}`;
  if (invite.mentor_name) {
    return `You've been invited to claim the mentor profile of ${invite.mentor_name} for ${where}.`;
  }
  return `You've been invited to join ${where} as ${ROLE_ARTICLE[invite.role] || invite.role}.`;
}

export default function JoinPage({ params }) {
  const token = params?.token ? decodeURIComponent(params.token) : "";
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setInvite(null);
    setError(null);
    getInvitePreview(token)
      .then((data) => {
        if (!cancelled) setInvite(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError({
          status: err.status,
          message:
            err.status === 404
              ? "This invite link isn't valid. Check that you copied the whole link."
              : err.message || "Could not load the invite.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthSplitLayout>
      {error ? (
        <StateCard
          icon={Link2Off}
          tone="error"
          title={error.status === 410 ? "This invite can't be used" : "Invite not found"}
          description={`${error.message} Ask your incubator coordinator for a new link.`}
          actions={
            <>
              <Button render={<Link href="/login" />} variant="outline">
                Sign in
              </Button>
              <Button render={<Link href="/" />} variant="ghost">
                Home
              </Button>
            </>
          }
        />
      ) : !invite ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking your invite…
        </div>
      ) : (
        <RegisterForm
          roles={[invite.role]}
          initialRole={invite.role}
          inviteToken={token}
          lockedEmail={invite.email || null}
          claimMentorName={invite.mentor_name || null}
          title={`Join ${invite.org_name} as ${ROLE_META[invite.role]?.label || invite.role}`}
          description={inviteDescription(invite)}
        />
      )}
    </AuthSplitLayout>
  );
}
