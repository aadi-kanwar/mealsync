# Dine (by Livoza)

Dine lets PG residents say, before a cutoff time, which of tomorrow's meals
they will eat, so the PG knows the headcount for every meal.

The original plan is in [MASTER_PROMPT.md](MASTER_PROMPT.md). By the owner's
decision the tool is kept simple: **three kinds of users (Admin, Warden,
Resident) and the meal headcount only.** There is no kitchen role and no
cooking targets, buffers, actuals or kitchen reports.

---

## For the PG owner (no technical knowledge needed)

### What works today

- **Create an account** with full name, room number, mobile number and a
  password, all on one form. Name and room are asked only once. After that,
  **sign in** needs just the mobile number and password.
- **New residents wait for approval.** After signing up a person sees
  "Waiting for approval". They can't choose meals and aren't counted until a
  Warden or Admin approves them.
- **Choosing meals** (approved residents):
  - *Home*: the next day that can still be chosen: **Today** before 6 AM,
    **Tomorrow** after. It shows "Choose by 6:00 AM" with the time left, and an "x of 4 answered" bar. Each meal is one row
    with Yes / No buttons; **Yes to all** / **No to all** do the whole day in
    one tap. Then **Save** ("Saved at 8:14 PM"). Close to the cutoff the box
    turns amber if something is still unanswered.
  - *This week*: a row of day tabs for the next 7 days. Each tab shows how
    many meals are still unanswered (or a ✓ when done, a lock when closed).
    Tap a day, choose, and one **Save** saves every day you changed.
  - *Profile*: their name, room and number, **Change password**, a short
    **History** (one line per past day: B L S D with ✓ Yes, ✕ No or – not
    answered), and **Log out**.
  - Each meal shows its time window and, once the Admin has filled in the
    menu, what's being served.
  - A meal nobody answered stays **Not answered**; it is never treated as No.
  - After the cutoff a meal is locked. The server checks the time with its
    own clock, so changing the phone's clock doesn't help.
  - Every real change is written to a permanent **activity log** (who, what,
    before → after, when). Pressing Save without changing anything adds nothing.
  - Meals are prepared for the coming week automatically every night (and on
    demand if someone opens the app first).
  - Meal timings: Breakfast 7:30–9:30 AM, Lunch 12:00–2:00 PM, Snacks
    5:00–6:00 PM, Dinner 8:00–9:30 PM, each to be chosen by **6:00 AM on
    the same day**.
- **Staff screens** (`/staff`, Admin and Warden):
  - *Dashboard* (the headcount): pick a day (Yesterday / Today / Tomorrow or
    any date). For each meal it shows how many residents said **Yes**, said
    **No**, and have **Not answered**, plus whether choices are still open.
    Numbers update live. Also shows sign-ups waiting.
  - *Responses*: every resident counted that day, one line each: name, room,
    when they last saved, and B L S D boxes (✓ Yes, ✕ No, – not answered),
    so the Warden can see who to remind. Phone numbers are never shown here.
  - *Residents*: everyone approved, with search and "Current" / "Moved out"
    tabs.
    - **Moved out**: enter their last day. They're counted up to and
      including that day, not after. Their history is kept. Entered by
      mistake? **Undo move-out**. The day after the last day they're moved to
      "Moved out" automatically.
    - **Reset password**: for a resident who forgot theirs. You get a
      temporary password (like `kq7m-p3rx`) to tell them in person; it's
      shown once. Their phone is signed out, and when they sign in with it
      they must choose their own new password. Staff passwords can't be
      reset here.
  - *New sign-ups*: approve (confirm room and start date) or reject.
  - *Staff* (Admin only): make someone an Admin or Warden, or take it away.
    There must always be at least one Admin.
  - *Menu* (Admin only): fill in the two weekly menus (Menu A and Menu B:
    Monday–Sunday, four meals a day) and choose which one runs **this
    week**. After that they alternate by themselves every Monday, and
    residents see each meal's dishes. On a phone, Menu and Staff are linked
    from the top of the Dashboard.
- **Design system** (`/design`): a reference page of every colour, text size
  and building block the app uses.
- Every approval, rejection and role change is written to a permanent
  **audit log** that nobody can edit or delete.

- **Look:** styled after livoza.org: cream background, deep teal, serif
  headings with italic accents, pill-shaped buttons.
- **Question of the day and food-waste message:** above their meals,
  residents see one of three questions (they take turns, one per day), and
  below them a message about why answering matters. The Admin edits both in
  **Settings → What residents see above their meals**.

### Roles

| Role | Can do |
|---|---|
| Admin | Everything the Warden can, plus managing staff and the menus. |
| Warden | Approve or reject new sign-ups; see the headcount and every resident's responses; mark residents as moved out; reset a resident's forgotten password. |
| Resident | Sign up (name and room once), sign in, see their approval status; once approved, choose meals before the cutoff, see their own history, change their password. |

### First-time setup (one time only)

You do the clicks; Claude does the technical parts.

1. **Create a Convex account** at <https://dashboard.convex.dev> (sign in with
   Google or GitHub) and create a project called `mealsync`.
2. **Hand Claude a development deploy key**, through the environment settings
   (never by pasting it into the chat). The exact steps are in the latest
   phase report.
3. Claude sets up the database, the login keys and the PG record.
4. **Make yourself the first Admin:**
   1. Open Dine, tap **Create account**, and sign up with your own mobile
      number. Enter your name and `OFFICE` as the room.
   2. In the Convex dashboard, open your project, click **Functions** in the
      left menu, choose **setup → makeFirstAdmin**, click **Run function**,
      type `{"phone": "+91XXXXXXXXXX"}` with your number, and click **Run**.
   3. Go back to Dine and refresh. You'll see the staff screens.

   This step only works once. After that, Admins add other staff from the
   **Staff** screen. (Each person must create their own account first.)

### Going live (production)

The live app uses its own **production** database, separate from the test
one. Vercel hosts the website and, on every deploy, `scripts/vercel-build.mjs`
prepares the production database automatically (login keys, latest backend
code, the PG record). Steps (one time):

1. **Convex:** <https://dashboard.convex.dev> → project **mealsync** → switch
   to **Production** (top of the page) → **Settings** → **URL & Deploy Key**
   → **Generate Production Deploy Key** → copy it.
2. **Vercel:** <https://vercel.com> → sign up with GitHub → **Add New… →
   Project** → import **mealsync** → open **Environment Variables** and add
   `CONVEX_DEPLOY_KEY` = the key from step 1 (Production only). Optionally
   add `MEALSYNC_PG_NAME` and `MEALSYNC_ORGANIZATION_NAME` (they can also be
   changed later in Settings). Click **Deploy**.
3. **First Admin:** open the live address, **Residents and wardens → Create
   account** with your own number (room `OFFICE`). Then in the Convex
   dashboard (still on **Production**): **Functions → setup →
   makeFirstAdmin** → `{"phone": "+91XXXXXXXXXX"}` → **Run**. Refresh the
   app: you're the Admin. Fill in **Menu** and **Settings**.

Never set `MEALSYNC_ALLOW_DEV_SEED` on production (the build refuses to run
if it is). A custom domain is added later in Vercel → Settings → Domains;
the next deploy updates the login settings to match.

### Forgotten passwords

There's no SMS, so residents can't reset their own password. A Warden or Admin
opens **Residents**, finds the person and taps **Reset password** (see above).
Residents who remember their password can change it under **Profile → Change
password**.

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
- A session must still exist for its login token to be accepted
  (`getViewer`), so a password reset or change signs other devices out at
  once, not when their token expires. Staff resets never touch staff accounts.

### Layout

```
convex/
  schema.ts            all tables (organizationId + propertyId everywhere)
  auth.ts              phone + password provider
  authLimits.ts        sign-in rate limits (internal)
  users.ts             me, completeProfile (fallback), changePassword
  access.ts            permission checks used by actions (internal)
  meals.ts             myDays, saveChoices, ensureUpcoming, generateUpcoming (daily)
  crons.ts             daily job creating the next 7 days of meal services
  dashboard.ts         day (headcount per meal), responses (each resident's choices)
  menus.ts             get, save, setThisWeek (Admin)
  residents.ts         listPending, pendingCount, approve, reject, list,
                       moveOut, cancelMoveOut, resetPassword, endStays (daily)
  staff.ts             list, grantRole, revokeRole (Admin)
  setup.ts             createProperty, makeFirstAdmin (internal, one-time)
  seed.ts              development-only test data (internal, env-guarded)
  lib/                 permission wrappers, validators, input rules, audit,
                       meals.ts (service generation, eligibility), time.ts (cutoffs),
                       headcount.ts (who is counted; Yes / No / Not answered),
                       menus.ts (which menu runs which week)
  tests/               backend tests (*.test.ts)
src/
  app/                 pages: /signin /onboarding (fallback) /pending /home /upcoming
                       /profile /change-password /design
                       /staff (dashboard) /staff/responses /staff/residents
                       /staff/signups /staff/team /staff/menu
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
npm run test:e2e            # Playwright against a production build; full flow needs E2E_SEED_PASSWORD (see playwright.config.ts)
npm run codegen:offline     # regenerate convex/_generated without a deployment
npx convex run setup:createProperty '{"organizationName":"…","propertyName":"…"}'
npx convex run seed:dev     # dev only: TEST accounts +919000000001…6
npx convex run seed:removeTestSignups   # dev only: delete the "E2E Person" accounts the browser tests create
```

Development TEST accounts created by `seed:dev` (password = `DEV_SEED_PASSWORD`):
Admin `9000000001`, Warden `9000000002`, active
residents `9000000004` and `9000000005`, pending resident `9000000006`.
