"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, Check, Copy, GraduationCap, Link2, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { InlineError } from "@/components/StateCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SelectField } from "@/app/onboarding/mentor/_components/fields";
import { dateLabel } from "@/components/dashboard/helpers";
import {
  createCohortInvite,
  getMyOrg,
  joinUrl,
  listCohortInvites,
  listMentors,
  revokeInvite,
} from "@/lib/api";
import { isValidEmail } from "@/lib/validation";
import { cn } from "@/lib/utils";

const ROLE_LABEL = { startup: "Startup link", mentor: "Mentor", coordinator: "Coordinator" };

const STATUS_CLASS = {
  active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  used: "border-transparent bg-muted text-muted-foreground",
  expired: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  revoked: "border-red-500/40 bg-red-500/15 text-red-300",
};

const NEW_MENTOR = "__new__";

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Link copied.");
    return true;
  } catch {
    toast.error("Could not copy. Select the link and copy it manually.");
    return false;
  }
}

/** The freshly created link: shown once, since only its hash is stored. */
function NewLink({ invite, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const url = joinUrl(invite.token);
  const who =
    invite.role === "startup"
      ? `any startup (up to ${invite.max_uses} sign-ups)`
      : `${invite.email} only (single use)`;
  return (
    <div className="space-y-2 border border-primary/40 bg-primary/5 p-3" role="status">
      <p className="text-sm font-medium">
        {ROLE_LABEL[invite.role]} invite created for {who}. Copy it now: it won&apos;t be shown again.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          readOnly
          value={url}
          aria-label="Invite link"
          className="h-9 font-mono text-xs"
          onFocus={(e) => e.target.select()}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className="h-9"
            onClick={async () => setCopied(await copyText(url))}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-9" onClick={onDismiss}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmailInviteForm({ id, label, icon: Icon, hint, busy, onCreate, children }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    if (await onCreate(trimmed)) setEmail("");
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        {label}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-email`}>Email</Label>
        <Input
          id={`${id}-email`}
          type="email"
          className="h-9"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-email-error` : undefined}
          disabled={busy}
        />
        {error && (
          <p id={`${id}-email-error`} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      {children}
      <Button type="submit" size="sm" className="mt-auto" disabled={busy}>
        {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
        Create invite
      </Button>
    </form>
  );
}

/**
 * Coordinator invite management for one cohort: create a multi-use startup
 * link, a single-use mentor invite (optionally claiming a seeded mentor
 * profile) or a single-use coordinator invite; list and revoke invites.
 */
export default function InvitePanel() {
  const [org, setOrg] = useState(null);
  const [cohorts, setCohorts] = useState([]);
  const [cohortId, setCohortId] = useState("");
  const [invites, setInvites] = useState([]);
  const [mentors, setMentors] = useState([]);
  const [claimMentorId, setClaimMentorId] = useState(NEW_MENTOR);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [created, setCreated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getMyOrg()
      .then((data) => {
        if (cancelled) return;
        setOrg(data?.org || null);
        const list = Array.isArray(data?.cohorts) ? data.cohorts : [];
        setCohorts(list);
        setCohortId((current) => current || list[0]?.cohort_id || "");
        if (list.length === 0) setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Could not load your organization.");
        setLoading(false);
      });
    // Unclaimed mentor profiles a mentor invite can hand over (optional).
    listMentors({ limit: 200 })
      .then((data) => {
        if (!cancelled) setMentors((data?.mentors || []).filter((m) => !m.claimed));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const loadInvites = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await listCohortInvites(id);
      setInvites(Array.isArray(data?.invites) ? data.invites : []);
    } catch (err) {
      setError(err.message || "Could not load invites.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvites(cohortId);
  }, [cohortId, loadInvites]);

  async function create(kind, payload) {
    if (!cohortId || busy) return false;
    setBusy(kind);
    try {
      const invite = await createCohortInvite(cohortId, payload);
      setCreated(invite);
      if (payload.mentor_id) {
        setMentors((list) => list.filter((m) => m.mentor_id !== payload.mentor_id));
        setClaimMentorId(NEW_MENTOR);
      }
      await loadInvites(cohortId);
      return true;
    } catch (err) {
      toast.error(err.message || "Could not create the invite.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function revoke(invite) {
    if (busy) return;
    setBusy(`revoke-${invite.invite_id}`);
    try {
      const updated = await revokeInvite(invite.invite_id);
      setInvites((list) => list.map((i) => (i.invite_id === updated.invite_id ? updated : i)));
      if (created?.invite_id === invite.invite_id) setCreated(null);
      toast.success("Invite revoked.");
    } catch (err) {
      toast.error(err.message || "Could not revoke the invite.");
    } finally {
      setBusy("");
    }
  }

  const cohortName = cohorts.find((c) => c.cohort_id === cohortId)?.name;
  const mentorOptions = [
    { value: NEW_MENTOR, label: "No, they'll create a new profile" },
    ...mentors.map((m) => ({ value: m.mentor_id, label: `${m.name}${m.domain ? ` (${m.domain})` : ""}` })),
  ];

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Invites</CardTitle>
        <CardDescription>
          {org && cohortName
            ? `People who join through these links land in ${cohortName} at ${org.name}.`
            : "Invite startups, mentors and coordinators to your cohort."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {cohorts.length > 1 && (
          <div className="max-w-xs">
            <SelectField
              id="invite-cohort"
              label="Cohort"
              value={cohortId}
              onChange={(v) => {
                setCohortId(v);
                setCreated(null);
              }}
              options={cohorts.map((c) => ({ value: c.cohort_id, label: c.name }))}
              placeholder="Select cohort"
            />
          </div>
        )}

        {!loading && !error && cohorts.length === 0 ? (
          <p className="text-sm text-muted-foreground">You are not a coordinator of any cohort yet.</p>
        ) : (
          <>
            {created && <NewLink invite={created} onDismiss={() => setCreated(null)} />}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="flex flex-col gap-3 border border-border p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Rocket className="h-4 w-4 text-primary" aria-hidden="true" />
                  Startup link
                </div>
                <p className="text-xs text-muted-foreground">
                  One link for the whole cohort. Any founder who opens it can sign up, until you
                  revoke it or it expires.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-auto"
                  disabled={Boolean(busy) || !cohortId}
                  onClick={() => create("startup", { role: "startup" })}
                >
                  {busy === "startup" ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Link2 aria-hidden="true" />
                  )}
                  Create startup link
                </Button>
              </div>

              <EmailInviteForm
                id="invite-mentor"
                label="Mentor invite"
                icon={GraduationCap}
                hint="Single use, only for this email address."
                busy={busy === "mentor"}
                onCreate={(email) =>
                  create("mentor", {
                    role: "mentor",
                    email,
                    ...(claimMentorId && claimMentorId !== NEW_MENTOR ? { mentor_id: claimMentorId } : {}),
                  })
                }
              >
                {mentors.length > 0 && (
                  <SelectField
                    id="invite-mentor-claim"
                    label="Hand over an existing mentor profile?"
                    value={claimMentorId}
                    onChange={(v) => setClaimMentorId(v || NEW_MENTOR)}
                    options={mentorOptions}
                    optional
                    disabled={busy === "mentor"}
                  />
                )}
              </EmailInviteForm>

              <EmailInviteForm
                id="invite-coordinator"
                label="Coordinator invite"
                icon={ShieldCheck}
                hint="Single use, only for this email address. Coordinators see every startup in this cohort."
                busy={busy === "coordinator"}
                onCreate={(email) => create("coordinator", { role: "coordinator", email })}
              />
            </div>

            {error ? (
              <InlineError message={error}>
                <Button type="button" size="sm" variant="outline" onClick={() => loadInvites(cohortId)}>
                  Try again
                </Button>
              </InlineError>
            ) : loading && invites.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invites yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>For</TableHead>
                    <TableHead className="text-right">Uses</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-24">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((invite) => (
                    <TableRow key={invite.invite_id}>
                      <TableCell className="whitespace-nowrap">{ROLE_LABEL[invite.role] || invite.role}</TableCell>
                      <TableCell className="max-w-[16rem] truncate">
                        {invite.email || <span className="text-muted-foreground">Anyone with the link</span>}
                        {invite.mentor_id && (
                          <span className="block text-xs text-muted-foreground">Claims an existing profile</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {invite.uses}/{invite.max_uses}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("capitalize", STATUS_CLASS[invite.status])}>
                          {invite.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateLabel(invite.expires_at)}
                      </TableCell>
                      <TableCell>
                        {invite.status === "active" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => revoke(invite)}
                            disabled={Boolean(busy)}
                            aria-label={`Revoke ${ROLE_LABEL[invite.role] || invite.role} invite${invite.email ? ` for ${invite.email}` : ""}`}
                          >
                            {busy === `revoke-${invite.invite_id}` ? (
                              <Loader2 className="animate-spin" aria-hidden="true" />
                            ) : (
                              <Ban aria-hidden="true" />
                            )}
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
