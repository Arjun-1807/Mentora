"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthSplitLayout from "@/components/layout/AuthSplitLayout";
import RegisterForm from "@/components/auth/RegisterForm";

// Self-service sign-up is for startups and mentors only. Coordinators are
// invite-only: they register through a /join/<token> link from their
// incubator (or scripts/create_org.py for the first one).
const SELF_SERVICE_ROLES = ["startup", "mentor"];

export default function RegisterPage() {
  const router = useRouter();
  const [initialRole, setInitialRole] = useState("startup");

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      // "/register?invite=<token>" is passed through to the invite page.
      const invite = params.get("invite");
      if (invite) {
        router.replace(`/join/${encodeURIComponent(invite)}`);
        return;
      }
      // "/register?role=mentor" (the landing page's "For Mentors" button) preselects the tab.
      const requested = params.get("role");
      if (SELF_SERVICE_ROLES.includes(requested)) setInitialRole(requested);
    } catch {
      // ignore
    }
  }, [router]);

  return (
    <AuthSplitLayout>
      <RegisterForm
        key={initialRole}
        roles={SELF_SERVICE_ROLES}
        initialRole={initialRole}
        footer={
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Incubator coordinator? Coordinator accounts are invite-only. Use the invite link
            your organization sent you.
          </p>
        }
      />
    </AuthSplitLayout>
  );
}
