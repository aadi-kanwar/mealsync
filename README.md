# MealSync

MealSync lets PG residents say, before a cutoff time, which of tomorrow's meals
they will eat, so the kitchen cooks the right amount and wastes less food.

The full plan is in [MASTER_PROMPT.md](MASTER_PROMPT.md). The app is being
built in phases. **Phase 1 (foundation) is done.** Choosing meals arrives in
Phase 2.

---

## For the PG owner (no technical knowledge needed)

### What works today (Phase 1)

- **Create an account / sign in** with a mobile number and a password.
- **New residents wait for approval.** After signing up, a person enters their
  name and room number and then sees "Waiting for approval". They can't choose
  meals and aren't counted until a Warden or Admin approves them.
- **Staff screens** (`/staff`):
  - *Overview*: how many sign-ups are waiting.
  - *New sign-ups* (Admin, Warden): approve (confirm room and start date) or
    reject each person.
  - *Staff* (Admin only): give someone the Admin, Warden or Kitchen role, or
    take it away. There must always be at least one Admin.
- **Design system** (`/design`): a reference page of every colour, text size
  and building block the app uses.
- Every approval, rejection and role change is written to a permanent
  **audit log** that nobody can edit or delete.

### Roles

| Role | Can do (so far) |
|---|---|
| Admin | Everything, including managing staff. |
| Warden | Approve or reject new sign-ups. |
| Kitchen | See how many sign-ups are waiting (no names or phone numbers). |
| Resident | Sign up, sign in, see their approval status. |

### First-time setup (one time only)

You do the clicks; Claude does the technical parts.

1. **Create a Convex account** at <https://dashboard.convex.dev> (sign in with
   Google or GitHub) and create a project called `mealsync`.
2. **Hand Claude a development deploy key**, through the environment settings
   (never by pasting it into the chat). The exact steps are in the latest
   phase report.
3. Claude sets up the database, the login keys and the PG record.
4. **Make yourself the first Admin:**
   1. Open MealSync, tap **Create account**, and sign up with your own mobile
      number. Enter your name and `OFFICE` as the room.
   2. In the Convex dashboard, open your project, click **Functions** in the
      left menu, choose **setup → makeFirstAdmin**, click **Run function**,
      type `{"phone": "+91XXXXXXXXXX"}` with your number, and click **Run**.
   3. Go back to MealSync and refresh. You'll see the staff screens.

   This step only works once. After that, Admins add other staff from the
   **Staff** screen. (Each person must create their own account first.)

### Forgotten passwords

There's no SMS, so residents can't reset their own password yet. A
staff-side "reset password" tool is planned for Phase 4 (resident management).

---

## Technical section

### Stack

- Next.js 16 (App Router, TypeScript strict), Tailwind CSS 4, shadcn-style
  components on Radix (`src/components/ui`), Lucide icons, React Hook Form + Zod.
- Convex for database, functions and real-time updates; Convex Auth with a
  custom phone + password credentials provider (`convex/auth.ts`).
- `libphonenumber-js` (E.164, default India), `date-fns-tz` (IANA timezones).
- Tests: Vitest + `convex-test` (backend), Playwright (end-to-end).

### Security model

Convex has no row-level security, so all access control is in backend
functions:

- `convex/lib/functions.ts` is the **only** file allowed to use Convex's raw
  `query` / `mutation` / `action` builders. Everything else uses its wrappers:
  `viewerQuery`, `signedInQuery/Mutation`, `staffQuery/Mutation({ roles })`
  (Admin always passes), `residentQuery/Mutation` (approved residents only),
  and `internalQuery/Mutation/Action` (never callable from a browser).
  This is enforced by ESLint (`no-restricted-imports`) and by
  `convex/tests/enforcement.test.ts`.
- The user is always derived from the session. IDs from the browser are
  re-checked against the caller's property.
- Mutation wrappers make `mealActivityLog` and `auditLogs` append-only
  (patch / replace / delete throw).
- Login abuse protection (`convex/authLimits.ts`): 5 failed attempts per phone
  number per 15 minutes (counted for unregistered numbers too, so the lockout
  doesn't reveal who has an account), and at most 30 new sign-ups per hour.
  All credential failures return one generic message.
- Passwords are hashed with Scrypt by Convex Auth; never logged or audited.

### Layout

```
convex/
  schema.ts            all tables (organizationId + propertyId everywhere)
  auth.ts              phone + password provider
  authLimits.ts        sign-in rate limits (internal)
  users.ts             me, completeProfile
  residents.ts         listPending, pendingCount, approve, reject
  staff.ts             list, grantRole, revokeRole (Admin)
  setup.ts             createProperty, makeFirstAdmin (internal, one-time)
  seed.ts              development-only test data (internal, env-guarded)
  lib/                 permission wrappers, validators, input rules, audit
  tests/               backend tests (*.test.ts)
src/
  app/                 pages: /signin /onboarding /pending /home /staff /design
  components/ui/       design-system components
  proxy.ts             redirects signed-out visitors to /signin
e2e/                   Playwright tests
```

### Environment variables

See [.env.example](.env.example). On the **Convex deployment** set
`SITE_URL`, `JWT_PRIVATE_KEY` and `JWKS` (for login), and on development
deployments only, `MEALSYNC_ALLOW_DEV_SEED=true` and `DEV_SEED_PASSWORD`.

### Commands

```bash
npm install
npx convex dev              # connect/push to your dev deployment, keeps _generated/ fresh
npm run dev                 # website on http://localhost:3000
npm run lint
npm run typecheck           # website + backend
npm test                    # backend tests (no deployment needed)
npm run test:e2e            # Playwright; full flow needs E2E_SEED_PASSWORD (see playwright.config.ts)
npm run codegen:offline     # regenerate convex/_generated without a deployment
npx convex run setup:createProperty '{"organizationName":"…","propertyName":"…"}'
npx convex run seed:dev     # dev only: TEST accounts +919000000001…6
```

Development TEST accounts created by `seed:dev` (password = `DEV_SEED_PASSWORD`):
Admin `9000000001`, Warden `9000000002`, Kitchen `9000000003`, active
residents `9000000004` and `9000000005`, pending resident `9000000006`.
