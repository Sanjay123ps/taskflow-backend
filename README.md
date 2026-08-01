# TaskFlow Backend

Express + TypeScript + Prisma API for the TaskFlow task management system.
Talks to Supabase (PostgreSQL, Auth, Storage) and serves the separately
deployed Admin and Staff React frontends.

## Stack

- Node.js, Express, TypeScript
- Prisma ORM → Supabase PostgreSQL
- Supabase Auth (credential verification + account lifecycle) — this
  backend issues its own short-lived JWT access tokens and rotating
  opaque refresh tokens on top of it (see **Auth architecture** below)
- Supabase Storage (task attachments, profile images)
- Zod (validation), Helmet + CORS + express-rate-limit (security),
  pino (structured logs), ExcelJS (xlsx reports)

## Project layout

```
backend/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── config/        # env, supabase clients, prisma client, logger
│   ├── middleware/     # auth, role, validation, rate limiting, upload, errors
│   ├── modules/        # one folder per domain (controller/service/routes/validation)
│   ├── routes/index.ts # mounts every module under /api/v1
│   ├── utils/          # response/error helpers, DTO mappers, tokens, exporters...
│   ├── app.ts
│   └── server.ts
└── tests/
```

## Setup

### 1. Supabase project

1. Create a Supabase project. Copy the **Project URL**, **anon key**, and
   **service_role key** into your `.env` (see `.env.example`).
2. Create two Storage buckets: `task-attachments` and `profile-images`
   (names configurable via env). Public read is fine for a first pass;
   tighten to signed URLs + bucket policies before shipping anything
   sensitive.
3. In Authentication settings, email/password sign-up is enabled by
   default — that's all this backend needs (it never uses Supabase's own
   hosted sign-up UI; all account creation goes through this API).

### 2. Install & migrate

```bash
npm install
npx prisma migrate dev --name init   # creates tables in Supabase Postgres
npx prisma db seed                   # initializes the employee-ID counter row
```

### 3. Environment

Copy `.env.example` to `.env` and fill in every value — the app refuses to
boot if any required variable is missing or malformed (see
`src/config/env.ts`).

### 4. Run

```bash
npm run dev      # tsx watch, local dev
npm run build && npm start   # production
```

### 5. Create the first Admin

There is no public admin sign-up. Once, after deploying with
`INITIAL_ADMIN_SETUP_TOKEN` set:

```bash
curl -X POST https://your-backend/api/v1/auth/setup-initial-admin \
  -H "Content-Type: application/json" \
  -d '{"setupToken":"<INITIAL_ADMIN_SETUP_TOKEN>","fullName":"Jane Admin","email":"jane@example.com","password":"a-strong-password"}'
```

This only succeeds while zero Admin accounts exist. After that, further
Admins are created via the in-app Admin Creation Request + approval flow
(see below).

## Auth architecture

Supabase Auth is used only for two things: **verifying email+password** at
login (`signInWithPassword`) and **managing the account lifecycle**
(creating users, inviting-by-email, password resets). It is *not* what the
frontend talks to directly, and its own session tokens are never returned
to the client.

Instead, after verifying credentials this backend issues:
- a short-lived **JWT access token** (`Authorization: Bearer ...`), and
- an opaque, rotating **refresh token** as an httpOnly cookie, hashed
  (SHA-256) before being stored in the `Session` table.

This is what makes the Settings → "Active Sessions" list/revoke feature
possible (Supabase's own tokens aren't something we can enumerate or
revoke individually per-device). Every login/refresh writes or rotates a
`Session` row; logout, password change, and staff deactivation all revoke
sessions server-side.

`requireAuth` middleware re-loads the Profile on every request (not just
at login) and checks `status === 'ACTIVE'` — so deactivating a staff
member or a pending signup takes effect immediately, not just at their
next login.

## Password handling by workflow

| Flow | Who sets the password | Mechanism |
|---|---|---|
| Staff self-signup | The applicant, at signup time | `supabaseAdmin.auth.admin.createUser` — password goes straight to Supabase Auth, never touches our DB. Profile starts `PENDING`; login stays blocked until an Admin approves. |
| Admin-initiated staff creation | The staff member, via email | `supabaseAdmin.auth.admin.inviteUserByEmail` — no password collected by us at all. |
| New Admin (via Admin Creation Request) | The new admin, via email | Same invite-by-email flow, once approved by a *different* existing Admin. |
| Password reset (admin-triggered) | N/A — temporary password | Backend generates a random temporary password and returns it once in the API response for the admin to relay; all of that staff member's sessions are revoked. |
| Password change (self-service) | The user | Verifies the current password via Supabase, then updates it; all *other* sessions are revoked. |

## Key business rules & where they're enforced

- **Max 2 active Admins**, **no self-approval**: `adminRequest.service.ts`
  re-checks the active-admin count *inside* the approval transaction (not
  just at request-submission time), and rejects if `requestedById ===
  reviewedById`.
- **Staff can't log in before approval**: gated by `Profile.status`, not
  by Supabase's own email-confirmation state.
- **Race-safe Employee IDs**: `utils/employeeId.ts` uses a single atomic
  `UPDATE ... RETURNING` against a one-row counter table, so two
  concurrent approvals can never collide.
- **Staff can only see/act on their own tasks**: enforced in
  `tasks.service.ts` at the query-scoping and per-record-check level, not
  just hidden in the UI. Staff updates are further restricted to the
  `status` field, with an explicit allowed-transition table (no jumping
  straight to `COMPLETED` from a state that doesn't logically allow it,
  etc.)
- **OVERDUE is computed lazily**: a cheap conditional `UPDATE` runs at the
  top of every task/dashboard read to flip past-due `PENDING`/`IN_PROGRESS`
  tasks to `OVERDUE`, instead of a cron job.
- **Completion percentage is always computed live** from `Task` rows
  (`task-stats.util.ts`), never stored.
- **Messaging is Admin↔Staff only** (not staff-to-staff or admin-to-admin),
  per the spec's framing.

## Known simplifications (documented, not hidden)

- **Dashboard analytics time series**: `created`/`completed` counts per
  bucket are exact (based on timestamps). `pending`/`overdue` counts per
  bucket reflect each task's *current* status, not a true historical
  snapshot — the schema doesn't track status-change history, which true
  point-in-time accuracy would require. See the comment in
  `dashboard.service.ts`.
- **CAPTCHA**: implemented against hCaptcha's `siteverify` endpoint
  (Supabase's own CAPTCHA integration defaults to hCaptcha too). Swap the
  URL in `utils/captcha.ts` if the frontend ends up using reCAPTCHA
  instead — the request/response shape is nearly identical.
- **`ActivityAction` enum is a superset** of what the already-built Admin
  frontend's TypeScript types currently know about (e.g. it doesn't yet
  have `ADMIN_REQUEST_*` values) — the spec explicitly requires tracking
  those events, so the backend logs them; the frontend's activity-log
  filter dropdown just won't have a friendly label for them until its own
  types are updated.
- **CORS** allows exactly `FRONTEND_ADMIN_URL` and `FRONTEND_STAFF_URL` —
  no wildcard, per the spec. Add a third origin explicitly if you stand up
  a third frontend (e.g. a staging URL).

## API map

All routes are mounted under `/api/v1`. Full request/response shapes are
in each module's `*.validation.ts` and `utils/dto.ts`.

```
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
POST   /auth/change-password        (auth required)
GET    /auth/me                     (auth required)
POST   /auth/setup-initial-admin    (one-time bootstrap)

GET    /staff                       (admin)
GET    /staff/:id                   (admin)
POST   /staff                       (admin)
PATCH  /staff/:id                   (admin)
POST   /staff/:id/reset-password    (admin)

GET    /tasks                       (auth — staff sees only their own)
GET    /tasks/:id                   (auth)
POST   /tasks                       (admin, multipart w/ optional attachment)
PATCH  /tasks/:id                   (auth — staff limited to `status`)
DELETE /tasks/:id                   (admin)
GET    /tasks/:id/comments          (auth)
POST   /tasks/:id/comments          (auth)

POST   /signup-requests             (public)
GET    /signup-requests             (admin)
GET    /signup-requests/:id         (admin)
PATCH  /signup-requests/:id/approve (admin)
PATCH  /signup-requests/:id/reject  (admin)

POST   /admin-requests              (admin)
GET    /admin-requests              (admin)
PATCH  /admin-requests/:id/approve  (admin, not self)
PATCH  /admin-requests/:id/reject   (admin, not self)

GET    /admin/dashboard             (admin)
GET    /dashboard                   (staff — own summary)
GET    /admin/activity              (admin)

GET    /notifications               (auth)
PATCH  /notifications/:id/read      (auth)
PATCH  /notifications/read-all      (auth)

GET    /messages/conversations      (auth)
GET    /messages/thread/:userId     (auth)
POST   /messages                    (auth, admin↔staff only)

GET    /settings/general            (admin)
PATCH  /settings/general            (admin)
PATCH  /settings/account            (auth — own profile)
GET    /settings/tasks              (admin)
PATCH  /settings/tasks              (admin)
GET    /settings/sessions           (auth)
POST   /settings/sessions/logout-all (auth)

GET    /reports/:type               (admin — type: tasks|staff|activity; ?format=csv|xlsx)

GET    /health                      (no prefix, no auth)
```

## Deployment (Render)

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check path: `/health`
- Set every variable from `.env.example` in the Render dashboard.
- Run `npx prisma migrate deploy` (e.g. as a Render one-off job, or in the
  build step) against `DIRECT_URL` before the first deploy serves traffic.

## Tests

```bash
npm test
```

Covers the highest-value business rules (2-admin cap, self-approval
rejection, staff task-access scoping, employee ID formatting, completion
percentage math) against mocked Prisma/Supabase clients — see `tests/`.
