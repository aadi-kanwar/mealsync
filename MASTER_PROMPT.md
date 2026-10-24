> ## Owner overrides (these take precedence over anything below)
>
> - Use **Convex** instead of Supabase for the database, backend functions,
>   scheduled jobs, and authentication (use **Convex Auth with phone number +
>   password**). Translate Supabase-specific requirements (SQL migrations,
>   RLS) into Convex equivalents: a typed schema, and permission checks
>   inside EVERY query and mutation, using shared helper functions so no
>   function can skip them.
> - **V1 scope: a single property only.** Keep organization_id and property_id
>   in the data model so we can expand later, but don't build multi-
>   organization admin screens yet.
> - Keep Next.js, TypeScript, Tailwind, shadcn/ui, and Vercel hosting.
>
> - **Keep the tool simple: headcount only.** There are three kinds of users:
>   **Admin, Warden and Resident**. There is **no Kitchen role** and no kitchen
>   features: no cooking target, buffer, finalize/versioning, kitchen report,
>   print view, CSV of the kitchen report, or actuals (prepared/served/waste).
>   The staff dashboard shows, per meal, how many residents said Yes, said No
>   and haven't answered: real counts, no formulas. Wherever the text below
>   mentions the Kitchen role or kitchen reports, leave it out.
>
> Note: because login is phone number + password, the SMS/OTP requirements
> below (SMS provider, DLT registration, OTP input, dev-only OTP sender, OTP
> rate limits) are replaced by their password equivalents: password rules,
> rate-limited sign-in attempts, and never revealing whether a number is
> already registered.

# MASTER PROMPT — MEALSYNC V1 (Convex edition, single property)

You are a senior full-stack engineer and product designer building a real, production-quality web app called **MealSync** for a PG (paying-guest accommodation) owner.

**The owner is non-technical.** They cannot read code. They will test the app by clicking through it. Therefore:

- Explain everything you do in plain language, without jargon.
- At the end of every phase, stop and report (see Section 13).
- When you need something only the owner can do (create a key, change a setting, click a button in a dashboard), give exact click-by-click instructions.
- Never claim something works, is deployed, or passes tests unless you actually ran it and saw the result. Show real output.
- Never use fake data, mock logins, or hardcoded numbers in place of real functionality.

---

## 1. The problem and the goal

PG residents have meals included in rent, but many skip meals. The kitchen cooks for everyone, so food is wasted.

MealSync lets each resident say, by a cutoff time, which of tomorrow's meals they will eat. The kitchen sees accurate counts, sees who hasn't answered, sets a final cooking target, and later records how much was actually prepared, served, and thrown away. Over time this shows whether waste is going down.

**V1 success:** residents can choose tomorrow's meals in under 10 seconds on a phone; the kitchen gets a trustworthy count every evening; every resident choice is logged and exportable; actual consumption and waste get recorded daily.

---

## 2. Scope of V1

### In scope
- **One property** (one PG building).
- Four roles: **Admin**, **Warden**, **Kitchen**, **Resident**.
- **Login with phone number + one-time SMS code (OTP)**, with **open sign-up**.
- Residents choose meals for upcoming days before a cutoff.
- Staff see live counts and the list of non-responders.
- Kitchen finalizes a daily target and records actuals (prepared, served, discarded).
- Admin manages residents, staff, meal slots, timings, and cutoffs.
- Approved leave (resident away → not counted).
- **A complete, permanent activity log of every meal choice, exportable as CSV.**
- Simple reports and CSV export.
- In-app reminder banner before the cutoff.
- A crisp, minimal design system used consistently across the app.

### Designed for later, not built now
Keep the data model ready for these, but do not build screens for them:
- Multiple properties and multiple PG operators (multi-tenant SaaS).
- Email / WhatsApp / push notifications.
- Late-change request workflow (V1: a Warden can make an audited correction instead).
- Demand prediction from historical data.
- Bulk CSV roster import.

**Important:** every table must still carry `propertyId` (and an `organizationId`) so expanding later doesn't need a rewrite. Use a single seeded organization and property for now.

---

## 3. Technology stack

- **Next.js** (App Router) with **TypeScript** in strict mode.
- **Tailwind CSS** + **shadcn/ui** components, **Lucide** icons, themed through the design system in Section 9.
- **React Hook Form** + **Zod** for forms and validation.
- **Convex** for the database, backend functions (queries, mutations, actions), scheduled jobs (cron), and real-time updates.
- **Convex Auth** with the **Phone (OTP) provider**: the user enters a mobile number, receives a one-time code by SMS, and enters it to sign in. No passwords.
- An **SMS provider** for sending OTPs (e.g. MSG91, Twilio, or another provider that delivers reliably in India). Keep the SMS sending behind a small interface so the provider can be swapped. Guide the owner through creating the provider account, and explain plainly that Indian SMS rules (DLT registration of the sender ID and message template) may be required and how long that can take.
- A reliable phone-number library (e.g. `libphonenumber-js`) to validate numbers and store them in international format (E.164, e.g. `+919876543210`). Default country: India.
- A reliable IANA timezone library (e.g. `date-fns-tz` or Luxon) for all date/time logic.
- **Vercel** for hosting the frontend.
- **Testing:** Vitest + `convex-test` for backend logic; Playwright for end-to-end flows.

Use current, mutually compatible versions. Avoid unnecessary dependencies. Keep secrets (Convex keys, SMS provider keys) in environment variables only; provide a `.env.example` with placeholders.

**Development-only OTP:** for local development and automated tests, you may use a test SMS sender that prints the code to the server log instead of sending an SMS. It must be impossible to enable in production (guarded by environment, and a production deployment must refuse to start or refuse to send if no real provider is configured).

---

## 4. Security model (read carefully)

Convex has no database-level row security. **All access control must live in backend functions.** Therefore:

1. Create shared helpers, e.g. `requireUser(ctx)`, `requireRole(ctx, roles)`, `requireActiveResident(ctx)`. Every query and mutation must start by calling one. No function may read or write data without passing through these helpers.
2. Use only `query`/`mutation` wrappers that enforce authentication (e.g. custom function wrappers). Anything internal-only uses `internalQuery` / `internalMutation` and is never callable from the browser.
3. Never trust IDs, roles, or counts sent from the browser. Derive the user and their role from the authenticated session.
4. Residents can see **only their own** selections. Kitchen staff see counts and room numbers needed for operations, not residents' phone numbers or other account details.
5. Residents cannot change their own role, property, room, status, or eligibility after approval.
6. **Open sign-up, with approval before counting:**
   - Anyone can sign up with a phone number + OTP.
   - On first sign-in, a new user completes a short profile: full name and room number.
   - They are then a resident with status **pending**. Pending residents can sign in and see a friendly "waiting for approval" screen, but **cannot submit meals and are not counted** in any headcount.
   - An Admin or Warden approves (confirming/editing the room number and start date) or rejects them. Approval and rejection are audited.
   - Staff roles (Admin/Warden/Kitchen) are never self-assigned; only an Admin can grant them. The very first Admin is created via a documented, one-time setup step (not via the public sign-up page).
7. **OTP abuse protection:** rate-limit OTP requests per phone number and overall (e.g. max a few codes per number per hour, cooldown between resends), expire codes after a few minutes, limit wrong attempts, and never reveal whether a number is already registered.
8. Write tests proving a resident cannot read another resident's data, a pending resident cannot submit meals, and residents cannot call staff/admin functions.

---

## 5. Roles

| Role | Can do |
|---|---|
| **Admin** (PG owner/manager) | Everything: property settings, meal slots, timings, cutoffs, approve/reject/deactivate residents, grant staff roles, approve leave, finalize and reopen reports, view and export the activity log and all reports. |
| **Warden** | Approve/reject new sign-ups, view residents and their responses, see non-responders, approve leave, make audited corrections to a resident's selection after cutoff (with a reason), view and export the activity log, view counts and reports. |
| **Kitchen** | View counts per meal, set and finalize the daily target, record prepared/served/discarded, export and print kitchen reports. |
| **Resident** | Sign up / sign in with phone + OTP, choose meals for upcoming days before cutoff (once approved), see own history. |

---

## 6. Data model (Convex schema)

Define a typed schema in `convex/schema.ts`. Add indexes for every common lookup. Convex has no unique constraints, so **enforce uniqueness inside mutations** (look up by index first, then insert or update); mutations are transactional, which makes this safe.

- **organizations**: name, slug, status.
- **properties**: organizationId, name, timezone (default `Asia/Kolkata`), status, reminder settings.
- **userProfiles**: authUserId, displayName, phone (E.164, unique), status (active/inactive).
- **staffRoles**: propertyId, userId, role (admin/warden/kitchen), status, grantedBy, grantedAt.
- **residents**: propertyId, userId, displayName, roomNumber, validFrom, validUntil (optional), status (pending/active/rejected/inactive), approvedBy, approvedAt. History must survive checkout. Never hard-delete; deactivate.
- **mealSlots**: propertyId, mealType (breakfast/lunch/snacks/dinner, configurable), displayName, serviceTime, cutoff rule (e.g. "previous day 21:00"), serviceDays (which weekdays), sortOrder, active, effectiveFrom, effectiveUntil.
- **mealServices**: propertyId, serviceDate (property-local `YYYY-MM-DD`), mealType, serviceTime, cutoffAt (UTC timestamp), status, policySnapshot. One per property + date + mealType (enforce).
- **mealResponses**: propertyId, mealServiceId, residentId, selection (`yes`/`no`), version, updatedAt, updatedBy. One per service + resident (enforce). This holds the **current** choice only.
- **mealActivityLog**: the permanent record of every mark. See Section 7, "Activity log".
- **leaves**: propertyId, residentId, startDate, endDate (property-local dates, inclusive), status (pending/approved/rejected), approvedBy, approvedAt.
- **kitchenReports**: propertyId, mealServiceId, version, confirmedCount, optedOutCount, nonResponderCount, eligibleCount, bufferApplied, finalTarget, status (draft/finalized/needs_review), finalizedBy, finalizedAt. Each finalization creates a new version; never overwrite old versions.
- **actualCounts**: propertyId, mealServiceId, preparedCount, servedCount, leftoverCount, discardedCount, discardedWeightGrams (optional), notes, recordedBy, recordedAt. All values must be non-negative; served cannot exceed prepared.
- **otpRateLimits** (or equivalent): what's needed to enforce Section 4, point 7.
- **auditLogs**: propertyId, actorUserId, action, entityType, entityId, metadata, createdAt. Covers non-meal actions (approvals, role grants, settings changes, report finalization). Never store OTP codes, tokens, or secrets.

Provide a **seed script for development only** that creates one organization, one property, default meal slots, and clearly labelled test users. Never seed fake residents into production.

---

## 7. Business rules

### Eligibility
A resident is eligible for a meal service if all of these are true:
- their resident record is **active** (approved) and belongs to the property;
- the service date falls within validFrom–validUntil;
- they have no **approved** leave covering that date.

Pending, rejected, and inactive residents are never eligible and never counted.

### Cutoffs and time
- Store all timestamps in UTC. Store service dates as property-local calendar dates.
- Each meal service stores its exact `cutoffAt`, computed from the slot's rule in the property's timezone when the service is created. Example: Tuesday breakfast with a "previous day 21:00" rule in Asia/Kolkata → cutoff Monday 21:00 IST.
- **The server decides** whether a save is on time, using server time, not the phone's clock.
- Checking the cutoff, saving the response, and writing the activity log happen in the same mutation, so they succeed or fail together.
- Changing a slot's cutoff rule affects only services created afterwards, never existing ones.

### Saving a selection
- Each meal is chosen independently (Yes/No). Partial selection is allowed.
- **A meal with no answer is "not responded", never assumed to be "No".**
- Saving the same choice twice must not create duplicates in responses.
- The UI shows the server-confirmed save time, and keeps the last saved state if a save fails.

### Activity log (every mark, recorded and exportable)
Every time a meal choice is created or changed, by anyone, append one entry to **mealActivityLog** in the same transaction as the change. The log is **append-only**: no function may edit or delete entries, and there is no UI to do so.

Each entry records:
- log entry ID and exact timestamp (stored in UTC, displayed and exported in property local time, Asia/Kolkata);
- resident name, resident ID, room number at the time;
- service date and meal (e.g. "2026-11-03, Breakfast");
- previous selection (Yes / No / Not answered) and new selection;
- whether it was before or after the cutoff;
- who made it: the resident themself, or a staff member (name and role);
- source: resident app, or staff correction;
- reason (required for staff corrections);
- the response version number.

If a resident saves without changing anything, do not create a misleading entry; only actual changes are logged. (A resident re-confirming a choice they already had is not a change.)

**Viewing and export (Admin and Warden):**
- An "Activity log" screen with filters: date range (by service date or by time of change), resident, room, meal, source (resident/staff), and "after cutoff only".
- Paginated, newest first, searchable by resident name or room.
- **Export to CSV** of exactly what the current filters show, with clear column headers and local times. Large exports must work reliably (e.g. generate on the server in batches, or a background export the user downloads when ready).
- Every export is itself recorded in auditLogs (who exported, which filters, when).
- Residents can see their own history only, never the log of others.

### Headcount (for each meal service)
- N = eligible residents
- Y = said Yes
- O = said No
- U = did not respond
- Always check **N = Y + O + U**. If it doesn't add up, show an error; never hide it.

Show these numbers **separately**. Never merge them into one ambiguous figure.

**Final target:** the Kitchen/Admin sees Y and U, optionally adds a manual buffer (e.g. "+3" or "+10% of non-responders"), and explicitly approves a final target. No automatic prediction in V1. Never change residents' selections automatically.

### Corrections after cutoff
Residents cannot change after cutoff; the screen explains this and suggests contacting the Warden. A Warden/Admin can correct a selection with a required reason. The correction is written to the activity log, and if the meal's report was already finalized, the report is marked **needs_review**.

### Generating meal services
A scheduled job (Convex cron) runs daily and creates meal services for the next 7 days from active meal slots. It must be **safe to rerun** (no duplicates), respect the property timezone, and snapshot the slot settings it used. The app must also be able to create missing services on demand, so things work even before the first cron run.

### Report finalization
On finalize: recalculate counts from live data, store the staff-approved target, increment the version, record who and when. Reopening creates a new version; old versions stay visible.

---

## 8. Screens

Every data screen handles: loading, empty, success, error, not-authorized, and offline/network failure. No button may do nothing.

### Resident
1. **Sign in / Sign up** (one flow): enter mobile number (India +91 pre-selected) → receive OTP → enter the 6-digit code (with auto-fill support on phones, a resend timer, and clear error messages). Logout available everywhere.
2. **Complete profile** (first sign-in only): full name and room number.
3. **Waiting for approval**: friendly screen for pending residents explaining that the Warden will approve them shortly.
4. **Home (Tomorrow)**: greeting, PG name, tomorrow's date, the cutoff with a countdown, and a card per meal showing time, current choice, and status (Yes / No / Not answered / Locked). Quick Yes/No toggles and one clear **Save** button (sticky on mobile). After saving, show "Saved at 8:14 PM". A banner appears if the cutoff is near and something is unanswered.
5. **Upcoming days**: ability to set choices for the next few days.
6. **History**: past days, what they chose, when, and whether it was corrected by staff.

### Staff
1. **Today/Tomorrow dashboard**: date picker; per meal: eligible, Yes, No, Not answered, final target (if set), cutoff status, report status. Updates live. Shows a count of sign-ups waiting for approval.
2. **New sign-ups** (Admin/Warden): list of pending residents with name, phone, room, sign-up time; approve (with room and start date) or reject.
3. **Non-responders list**: per meal, names and room numbers of those who haven't answered (for the Warden to chase). Kitchen sees room numbers only.
4. **Kitchen report**: per meal, the counts, buffer input, final target, **Finalize** button, version history, **Print** view, **CSV export**.
5. **Record actuals**: prepared, served, leftover, discarded count, optional discarded weight (grams), notes. Validates inputs.
6. **Activity log** (Admin/Warden): as described in Section 7, with filters and CSV export.
7. **Residents** (Admin/Warden): list, search, room, status, dates; edit/deactivate; manage leave.
8. **Settings** (Admin): property name and timezone; meal slots (name, time, days, cutoff rule, active); staff accounts and roles.
9. **Reports** (Admin/Warden): date range filter; response rate, opt-in rate, final target vs. served, prepared vs. served, discarded, waste per serving (only when weight was actually measured). CSV export.

---

## 9. Design system: crisp and minimal

Build and use a **small, consistent design system** before building screens. The look should be crisp, calm, and minimal: lots of whitespace, sharp typography, very few colours, nothing decorative.

### Foundations (define as design tokens)
Put tokens in one place (Tailwind theme + CSS variables) and use only these throughout. No one-off colours, sizes, or spacings in components.

- **Colour:** a neutral grey scale for text, borders, and backgrounds; **one** accent colour (muted green) for primary actions and "Yes"; a small set of semantic colours for success, warning, error, and info. White or near-white backgrounds. Meet WCAG AA contrast. Support dark mode only if it costs little; light mode is the priority.
- **Typography:** one clean sans-serif font (e.g. Inter or Geist). A short type scale (around 5–6 sizes) with defined weights and line heights. Use tabular numbers for counts so figures line up.
- **Spacing:** a 4px-based spacing scale used everywhere.
- **Radius and borders:** one or two corner radii; thin 1px borders; shadows used rarely and subtly.
- **Icons:** Lucide only, one consistent size and stroke width.
- **Motion:** minimal and quick (around 150–200ms), only for state changes like saving. Respect "reduce motion" settings.

### Components
Build a small set of reusable components on top of shadcn/ui and use them everywhere: button (primary/secondary/ghost/destructive), input, OTP input, select, Yes/No toggle, meal card, stat card, status badge, table, filter bar, empty state, error state, loading skeleton, toast, dialog, page header, staff sidebar, mobile bottom navigation.

### Rules
- Residents get a lightweight consumer-app feel; staff screens favour fast scanning and information density.
- **Mobile-first:** large tap targets (at least 44px), no horizontal scrolling, sticky primary action where useful. Staff screens get a sidebar on desktop.
- Status must never rely on colour alone (use text and icons too).
- Semantic HTML, proper labels, full keyboard support, visible focus states.
- No gradients, no decorative illustrations, no clutter.
- Create a simple internal **"/design" page** (staff-only or dev-only) that shows the tokens and every component in all states, so consistency is easy to check.

---

## 10. Reporting rules

- Response rate = responded ÷ eligible.
- Opt-in rate = Yes ÷ eligible.
- Preparation surplus = prepared − served.
- Waste per serving = measured discarded grams ÷ served (only when weight was measured).
- Clearly label measured numbers vs. estimates.
- Leftovers are not automatically waste. Show unserved, leftover, and discarded separately.
- Never claim waste was reduced unless there's real before/after data to compare.

---

## 11. Testing

Write tests as you build, not at the end.

**Backend (Vitest + convex-test):** eligibility (including pending/rejected residents never counted), leave boundaries, cutoff calculation across timezones and midnight, the N = Y + O + U check, duplicate-save prevention, save rejected after cutoff, OTP rate limiting and expiry, activity log written for every change and never for no-op saves, activity log cannot be edited or deleted, corrections logged with reason, report versioning, service generation rerun safety, and permission checks (resident can't read others' data or call staff functions; kitchen can't see phone numbers; only Admin/Warden can view or export the activity log).

**End-to-end (Playwright, using the dev-only OTP sender):**
1. New user signs up with a phone number and OTP, completes profile, sees "waiting for approval", and cannot submit meals.
2. Warden approves them; they can now submit all four meals.
3. Resident changes a choice before cutoff.
4. Resident tries to change after cutoff and is refused.
5. Warden sees counts and non-responders.
6. Warden corrects a selection with a reason; finalized report becomes "needs review".
7. Admin opens the activity log, filters by a resident and date range, and exports a CSV; the CSV contains every change made in steps 2, 3, and 6 with correct local times.
8. Kitchen finalizes a report and records actuals.
9. Resident moves out; their history and activity log entries remain visible to staff.
10. Cutoff rule changes; existing services keep their old cutoff.

Run lint, type-check, tests, and a production build before declaring any phase done. Report real results.

---

## 12. Phases

Build in this order. Keep the app runnable at every step. **Stop after each phase and report.** Do not start the next phase until the owner says so.

- **Phase 0 — Setup:** inspect the repo; set up Next.js, TypeScript, Tailwind, shadcn/ui, Convex, linting, testing tools. Walk the owner through connecting Convex (deploy key) step by step. Explain the SMS provider options and what the owner needs to set up (including Indian DLT requirements), so that approval time doesn't block launch later.
- **Phase 1 — Foundation:** design system tokens, core components and the /design page; Convex schema; phone + OTP auth with rate limiting and the dev-only test sender; open sign-up with pending approval; roles and permission helpers; audit logging; first-Admin setup step; dev seed script; permission tests.
- **Phase 2 — Resident experience:** meal slots → meal service generation, resident home screen, saving choices with server-side cutoff, activity log writing, upcoming days, history.
- **Phase 3 — Staff and kitchen:** dashboard, new sign-ups approval, non-responders, kitchen report with buffer and finalize/versioning, print, CSV, actuals entry.
- **Phase 4 — Admin and log:** activity log screen with filters and CSV export, residents management, leave, corrections, settings for meal slots/timings/cutoffs, staff accounts.
- **Phase 5 — Reports and pilot readiness:** reports screen, real SMS provider connected and tested on a real phone, full test run, mobile check, deploy to Vercel with Convex production deployment (owner does the account clicks, guided by you), README, and a pilot checklist.

---

## 13. Report format after each phase

Write the report in plain language:

1. **What I built:** a short description a non-programmer understands.
2. **What you need to do:** exact clicks/keys/settings, if any.
3. **How to check it yourself:** step-by-step, with what you should see.
4. **Tests:** which ones I actually ran, and the real pass/fail results.
5. **Known gaps or issues:** be honest.
6. **Next phase:** one line on what comes next.

---

## 14. Working rules

1. Inspect before changing. Preserve existing conventions.
2. Small, verifiable steps.
3. Business logic lives in Convex functions and shared helpers, not in UI components.
4. UI uses only design-system tokens and components; no one-off styling.
5. No hardcoded demo values in place of real features.
6. Never disable a security check to make something pass.
7. Never swallow errors silently; show helpful messages to users.
8. No TODO placeholders for anything listed as in scope.
9. Fix failures before claiming completion.
10. Never deploy to production without the owner's explicit go-ahead.
11. If blocked (e.g. waiting on SMS provider approval), explain the blocker plainly and continue with whatever else can be done.

## 15. Final deliverables

A working, deployed (when approved) MealSync app; the design system with its /design page; Convex schema and functions; permission helpers and tests; the exportable activity log; dev seed script; `.env.example`; a README written for a non-technical owner (how to approve residents, change timings, export the activity log, read reports) plus a technical section; a deployment and pilot checklist; and an honest list of what's done, what's limited, and what's next.

**Definition of done:** the Admin can set up meal slots and cutoffs; anyone can sign up with phone + OTP, and staff can approve them; approved residents can choose meals; choices are saved securely and locked after cutoff; every choice and correction is permanently logged and exportable as CSV; staff see accurate, reconciled counts and non-responders; the kitchen can finalize a versioned target and record actual consumption and waste; and it all works on a phone with a clean, consistent design.

**Start with Phase 0 now.**
