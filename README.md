# Mentora

Find the right mentor, automatically. Mentora reads a startup's pitch deck,
extracts a structured profile from it, matches the startup to the best-fit
mentors using vector similarity search, drafts the introduction email, and
learns from how each introduction actually went.

## How it works

1. **Sign up** as a startup or a mentor. Mentors are embedded and indexed on
   registration, so a new mentor is immediately discoverable.
2. **Upload** a pitch deck PDF. Text is extracted with PyMuPDF and structured
   by an LLM into `domain`, `stage`, `challenges`, `team_gaps`, `geography`.
3. **Review** the extracted profile, then ask for matches.
4. **Match** — the profile is embedded with `BAAI/bge-base-en-v1.5` and run
   through MongoDB Atlas `$vectorSearch`, then re-ranked by a weighted score
   combining semantic similarity with stage, domain, and geography fit plus
   each mentor's track record:

   ```
   final_score = cosine       × 0.50
               + stage_match  × 0.20
               + domain_match × 0.15
               + geo_match    × 0.05
               + effectiveness× 0.10
   ```

5. **Reach out** — an LLM drafts a short intro email from the startup to the
   mentor, referencing the startup's actual challenges and the mentor's
   expertise. The founder edits it, and the backend sends it to the mentor
   (the match becomes a *request*).
6. **Mentor answers** — the mentor sees the request (company name and
   profile summary, no contact details) and accepts or declines. On accept
   the startup's email is shared and it can book a Google Meet; a decline
   (or a request left unanswered for 7 days) brings in a replacement mentor.
7. **Close the loop** — log whether the meeting happened and rate it 1–5.
   That rating rolls into the mentor's `effectiveness_score`, which feeds
   straight back into step 4's ranking for everyone.

The feedback loop in steps 5–7 is the point: matches get better as the system
accumulates evidence about which mentors actually help.

The whole journey lives on the server: the startup's company name and
versioned profiles (one per deck, plus manual corrections) and its matches
are loaded from the API on every page, so it works across browsers and a
new deck never strands a match the mentor already accepted.

## Match lifecycle

```
suggested ─▶ requested ─▶ accepted ─▶ meeting_scheduled ─▶ met ─▶ completed
   │             ├─▶ declined   ┐
   │             ├─▶ withdrawn  ├─ each adds a replacement suggestion
   ▼             └─▶ expired    ┘  (7 days without an answer)
superseded  (a new deck dropped it from the top 5 before any request)
```

| Status | Who | What it means |
|---|---|---|
| Suggested | Mentora (`/match`) | In the startup's top 5. Private: the mentor doesn't see it. |
| Requested | Startup sends the intro | The mentor is emailed and sees the request. |
| Accepted / Declined | Mentor | Accepted shares the startup's email and unlocks booking. |
| Withdrawn | Startup | Took an unanswered request back. |
| Expired | Mentora | No answer within 7 days (checked when matches are loaded). |
| Meeting scheduled | Startup books | A Google Meet event is on both calendars. |
| Met / Completed | Outcome logs / rating | First outcome log = met; the startup's rating completes it. |
| Superseded | Mentora | Replaced by a newer deck's suggestions. |

Matches are unique per (startup, mentor); every change is checked against
a transition table and recorded in the match's `history`. Details:
[`mentora-backend/README.md`](./mentora-backend/README.md#match-status-lifecycle).

## Email

Email is sent by the **backend** through Gmail SMTP with an App Password.
Set these in `mentora-backend/.env`:

```
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD=<16-character Google App Password>
EMAIL_DELIVERY=          # optional: smtp | log
```

Without them the backend runs in `log` mode: nothing is sent and each
message is stored in the `outbox` collection, which is handy for staging.
The recipient is always looked up on the server, and the frontend no longer
has a send-email route or any email keys.

## Structure

- [`mentora-backend/`](./mentora-backend) — FastAPI service. PDF extraction
  (PyMuPDF), profile + email generation via Groq, mentor matching via
  `BAAI/bge-base-en-v1.5` embeddings and MongoDB Atlas Vector Search, JWT
  auth (bcrypt + PyJWT), and the feedback/effectiveness loop.
- [`mentora-frontend/`](./mentora-frontend) — Next.js 14 App Router app
  (JavaScript), shadcn/ui on Tailwind v4, dark-first with a teal accent and
  square corners.

Each subproject's README has the detailed setup, API reference, and notes.

## Quick start

The backend needs a Groq API key, a MongoDB Atlas connection string, and a
JWT signing secret. It also needs an Atlas Vector Search index on the
`mentors` collection — see
[`mentora-backend/README.md`](./mentora-backend/README.md) for the exact index
definition, which cannot be created from application code.

```bash
# Backend → http://localhost:8000 (docs at /docs)
cd mentora-backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # fill in GROQ_API_KEY, MONGODB_URI, JWT_SECRET
python seed_mentors.py     # seeds 15 sample mentors (clears the collection)
uvicorn app.main:app --reload --port 8000
```

```bash
# Frontend → http://localhost:3000
cd mentora-frontend
npm install
npm run dev
```

## Tenancy: organizations, cohorts and invites

Mentora is invite-only per incubator. An **organization** (the incubator)
has **cohorts**; startups, mentors and coordinators join a cohort through an
**invite link** (`/join/<token>`):

| Invite | Uses | Bound to an email | Who creates it |
|---|---|---|---|
| Startup cohort link | many (default 100), revocable | no | a coordinator of the cohort |
| Mentor invite | one | yes (optionally claims an existing seeded mentor profile) | a coordinator |
| Coordinator invite | one | yes | `scripts/create_org.py` or a coordinator |

- **Coordinators are invite-only.** `POST /register` with `role: "coordinator"`
  and no valid coordinator invite answers `403`.
- A coordinator only sees the startups in their own cohorts
  (`/health/cohort`, `/health/{id}`).
- Startups and mentors can still sign up without an invite at `/register`;
  they land in the built-in `legacy` org's `default` cohort.
- Mentors remain one shared, global pool. Each mentor document has
  `visibility {scope: "global" | "orgs", org_ids}`, plus `listed` and
  `active` flags.

**Bootstrap an org** (from `mentora-backend/`, with the venv active):

```bash
python scripts/create_org.py --slug acme-labs --name "Acme Labs" \
    --cohort "Spring 2027" --coordinator-email lead@acmelabs.org
# -> Invite URL:  http://localhost:3000/join/<token>
```

The coordinator opens that link and registers (the email is fixed by the
invite). They then go to **Cohort Overview → Invites** to create the
startup link and the mentor and coordinator invites, copy them, and revoke
them. Each link is shown only once, because the database stores only a
sha256 of the token.

**Upgrading an existing database.** `scripts/migrate_v2.py` is idempotent.
It backfills the `legacy` org and `default` cohort on existing users, demotes
self-registered coordinators to `startup` (except those listed in
`--keep-coordinators` — pass the same list on every run, or previously kept
coordinators are demoted), and sets the mentor visibility defaults. It also
moves matches onto the new lifecycle: legacy statuses are renamed
(pending/emailed → suggested, email_sent → requested), each startup user
gets a `startups` record with a first profile version from their latest
match, duplicate (startup, mentor) matches are collapsed onto the most
advanced one, and the old per-profile unique index is dropped before the
new pair index is built. Take a `mongodump` first and preview with `--dry-run`:

```bash
python scripts/migrate_v2.py --db mentora --dry-run
python scripts/migrate_v2.py --db mentora --confirm mentora --keep-coordinators lead@acmelabs.org
```

Sample pitch decks for trying the flow end to end live in
[`mentora-backend/test_decks/`](./mentora-backend/test_decks).

> Note: `seed_mentors.py` clears the `mentors` collection before inserting,
> so re-running it will remove mentors created through registration.
