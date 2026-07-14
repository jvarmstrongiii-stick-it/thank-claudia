@AGENTS.md

# CRITICAL — Read Before Writing Any Code

## Commit & Deploy Rules (non-negotiable)

1. **ALWAYS push to `main`** — Jack keeps a numbered r-commit history on main for rollback. Never leave work only on a feature branch. Use `git push origin HEAD:main` or push directly to main.
2. **ALWAYS bump `APP_REV`** on every single commit — it's `const APP_REV = NNN;` near the top of `claudia.html` (currently **230**). This is the visible version badge on the dashboard. Forgetting it means Jack sees a stale revision number and thinks deploys aren't working.
3. **Set git identity before first commit** in each session: `git config user.email "noreply@anthropic.com" && git config user.name "Claude"`
4. **Deploy takes ~1 minute** after push to main — GitHub Actions copies `claudia.html` → `dist/index.html` → `gh-pages` branch. If Jack says the version number is wrong, check `APP_REV` first before assuming a deploy issue.
5. **r-number in commit message** — prefix every commit message with `rNNN:` matching the new APP_REV value.

## CLAUDE.md Self-Update Protocol

**Before every commit**, scan the changes you just made and ask: would a brand-new session be confused or make a wrong assumption because of something introduced here? If yes, update CLAUDE.md in the same commit — not a follow-up.

Things that qualify for documentation:
- A new App-level state variable that interacts with render paths (e.g. `fieldTimeConfirm`, `pendingMapsJob`)
- A new helper function whose name doesn't make its contract obvious (e.g. `handleClockIn` vs `clockIn`)
- A new architectural pattern (new Sheet render path, new interceptor pattern, new data flow)
- A new Supabase column, table, or constraint
- A new gotcha discovered the hard way (e.g. missing Sheet in a return path, APP_REV not bumped)
- A change to `APP_REV` — always update the "currently NNN" references in the Gotchas and Commit Rules sections above

Things that do NOT need documenting: UI copy changes, style tweaks, bug fixes that don't change the architectural model.

**Format:** add to the Recurring Gotchas table if it's a trap, add to Key Architecture Decisions if it's a pattern, add to the render path table below if it's a Sheet. Update the APP_REV number in the Critical section above.

---

## claudia.html Render Architecture — Sheet Placement Rule

`claudia.html` has **multiple independent early-return paths** in the App component. Any Sheet (modal overlay) that can be triggered from more than one path must be added to ALL paths where it could appear. Current paths:

| Path | Condition | Has fieldTimeConfirm? | Has pendingMapsJob? |
|------|-----------|----------------------|---------------------|
| ClockGate | `!clockSession && !browseMode` | ✓ (r148) | ✓ (r180) |
| showClockIn | `showClockIn` (early return) | — | — |
| JobDetail (selected) | `selected` | ✓ | ✓ |
| Browse/dashboard | default | ✓ | ✓ |

When adding a new App-level Sheet, check all four paths. `StaleClockSheet` (r162) is rendered in the **JobDetail (selected)** and **Browse/dashboard** paths only — it can only appear when `clockSession` is truthy (a session left open from a prior day), which by definition excludes the ClockGate path.

**ClockGate can follow you mid clock-out (r180 fix):** `clockOut()`/`moveToInRoute()` leave `selectedId` untouched, but the App render order checks `!clockSession && !browseMode` *before* `selected`, so the instant `clockSession` goes null (e.g. right after clocking out) the app falls through to ClockGate regardless of which job was open. Until r180, ClockGate only rendered `fieldTimeConfirm` — so `lastLeaveJob`, `leavingCrewCheck`, `joiningOnSiteCheck`, and `pendingShopActivity`/`pendingMapsJob` (none of which require `clockSession`) were silently dropped and only appeared once the user tapped BROWSE and landed on the Browse/dashboard path. ClockGate now renders all five, matching the other paths. `staleClock` still can't appear there — it requires `clockSession` truthy by construction.

**ClockGate has its own `adding`/JobForm branch (r189):** the top-level `if (adding) return <JobForm .../>` (used by the normal `+ ADD JOB` button and by `MoveJobSheet`'s `+ NEW JOB`) lives *after* the ClockGate block, so setting `adding=true` while `!clockSession && !browseMode` used to just fall through to ClockGate's own default return — JobForm never appeared. `ClockInSheet` now has its own `+ NEW JOB` button (mirroring `MoveJobSheet`'s), wired through a second, ClockGate-local `if (adding) return <JobForm .../>` right after the `showClockIn` check. New App state `clockInAfterAdd` (`'In Route' | 'On Site' | null`) carries the status chosen in `ClockInSheet` across the JobForm round-trip; `addJob` checks it first (before the existing `routeAfterAdd` check) and calls `handleClockIn(data.id, st)` instead of `setSelectedId`, routing through the normal `fieldTimeConfirm` confirm-time sheet like any other clock-in. Both `JobForm` `onCancel` handlers (ClockGate's and the general one) reset `clockInAfterAdd` defensively so a cancelled add never leaves a stale flag armed for the next job save.

**`fieldTimeConfirm.type` now has four values (r197): `'clockIn' | 'moveJob' | 'clockOut' | flipOnSite (implicit else)`.** Clocking out previously called `clockOut(jobStatus)` directly from `ClockOutSheet` with no time-rewind step — every other clock transition (clock-in, moving jobs, flipping to On Site) already went through the `fieldTimeConfirm` "CONFIRM TIME" sheet first, clock-out was the one gap. `handleClockOut(jobStatus)` now mirrors `handleClockIn`/`handleMoveToInRoute`: it closes `ClockOutSheet` and opens `fieldTimeConfirm` with `{ type: 'clockOut', jobStatus }` instead; the three `fieldTimeConfirm` Sheet copies' CONFIRM button now call `clockOut(fc.jobStatus, at)` alongside the existing `clockIn`/`moveToInRoute` branches. `clockOut(jobStatus, at = now)` takes the rewound time and uses it both for the `Status → Cleared` note's timestamp and for `addTodayMs` banking (`new Date(at).getTime() - legStartedAt`, not `Date.now()`) — rewinding the clock-out time now correctly reduces today's banked total too, not just the note shown in the log.

**The confirmed time also stamps `job_crew.status_at` (r206):** `upsertJobCrewStatus(jobId, userId, status, statusAt = now)` takes an optional fourth arg; `clockIn`/`flipToOnSite`/`moveToInRoute` pass their rewound `at` through, so CREW STATUS shows the confirmed transition time instead of the moment the button was tapped (previously a 10:55 rewind still displayed "On Site · 2:25 PM" to everyone while the Time Log said 10:55). `saveCrewEdit` passes its picked `statusAt` directly (its old upsert-then-overwrite second query is gone). `keepStaleClock` deliberately omits the arg — it re-stamps to now so `reconcileClockFromCrew` won't re-flag the session as prior-day. Note `reconcileClockFromCrew` judges staleness by `status_at`, so a clock-in rewound past midnight into yesterday could re-prompt as stale — the rewind UI only allows same-day times, so this is theoretical.

---

# User Identity

The user operating this session (jvarmstrongiii@gmail.com) is **Jack**, one of the techs/users in the `users` table. When personalizing app behavior "for me" or "I/me/my", treat that as referring to Jack.

**Interaction preference:** Jack follows my reasoning live. When a real question or load-bearing assumption comes up mid-task — in auto mode or plan mode — ask him right then (via `AskUserQuestion`) instead of guessing and proceeding. He'd rather redirect early than discover a wrong assumption after the work is done. This applies to "if Jack does X / if Brett does Y" behavior guesses especially. Still bias toward action on reversible, low-stakes calls — this is about surfacing the decisions that actually change the outcome.

# thank-claudia — Session Context

**thank-claudia** is a voice-first HVAC field service management app (React Native/Expo) for TMC Mechanical in Philadelphia. Techs use it to log jobs, track status, scan equipment, and take photos from the field.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile/Web UI | React Native 0.81.5, React 19.1.0, React Native Web 0.21.0 |
| Framework | Expo SDK 54.0.9, Expo Router v6.0.22 (file-based routing) |
| Language | TypeScript 5.9.2 (strict mode) |
| Database | Supabase (PostgreSQL + Storage + Realtime) |
| AI | Claude API (`claude-sonnet-4-20250514`) via Node.js backend |
| Backend | Node.js on port 3001 — handles `/api/voice` and `/api/ocr` |
| Builds | EAS (Expo Application Services), project ID `aba42329-1d35-4f9e-8b56-03f5654b0859`, owner `jacksteriii` |
| Fonts | Russo One (headers), Barlow 400/600 (body), Share Tech Mono (data) |

**Key libraries:** expo-camera, expo-image-picker, expo-speech-recognition, react-native-gesture-handler 2.28, reanimated 4.1.1, react-native-datetimepicker 8.4.4.

---

## Database Schema

Schema verified against live Supabase instance (column list queried June 2026). No migration files are committed — Supabase was configured via the dashboard. **claudia.html is the source of truth for column names** — they differ from the Expo app's `lib/types.ts` in several cases (see Gotchas).

**Full table list:** `chores`, `components`, `customers`, `equipment`, `job_components`, `job_equipment`, `job_notes`, `job_photos`, `job_status_history`, `jobs`, `line_items`, `notifications`, `photos`, `receipts`, `sync_queue`, `users`

### `customers`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | |
| address | text | nullable — billing/main address |
| phone | text | nullable |
| email | text | nullable |

### `jobs`
Verified column list (June 2026). **claudia.html column names differ from Expo app** — use these exact names when writing queries for claudia.html.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| customer_id | uuid FK → customers | |
| flow_type | text | job type — `Service Call`, `New Install`, `Maintenance`, `Replacement`, `Warranty`, `Estimate` |
| current_status | text | job status — see status values below |
| assigned_to | uuid FK → users | nullable |
| value | numeric | nullable — job revenue |
| scheduled_at | timestamptz | nullable |
| site_address | text | nullable — where the job is; may differ from customer address. **Must be added if missing:** `ALTER TABLE jobs ADD COLUMN site_address text;` |
| original_ask | text | nullable — what the customer originally requested |
| notes | text | nullable — tech/office notes, separate from original_ask |
| recommendations | text | nullable — tech recommendations (column exists, no UI yet) |
| recommendation_acknowledged | boolean | nullable — customer ack of tech recommendations (no UI yet) |
| equipment_type | text | nullable — denormalized from OCR scan on job |
| brand | text | nullable — denormalized from OCR scan |
| model_number | text | nullable — denormalized from OCR scan |
| serial_number | text | nullable — denormalized from OCR scan |
| tonnage | text | nullable — denormalized from OCR scan |
| refrigerant | text | nullable — denormalized from OCR scan |
| voltage | text | nullable — denormalized from OCR scan |
| seer | text | nullable — denormalized from OCR scan |
| mca | text | nullable — denormalized from OCR scan |
| mop | text | nullable — denormalized from OCR scan |
| year_manufactured | text | nullable — denormalized from OCR scan |
| deposit_amount | numeric | nullable — customer deposit collected against this job |
| deposit_method | text | nullable — `cash` or `check` |
| deposit_check_number | text | nullable — only meaningful when `deposit_method='check'` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Note:** `address`, `job_type`, `status`, `scheduled_time`, `priority` do NOT exist on the live jobs table — these are Expo app names only. The live columns are `site_address`, `flow_type`, `current_status`, `scheduled_at` (no priority column).

**Job status values** — two separate arrays in claudia.html:

`STATUSES` (dashboard filter tab order): `On Site`, `In Route`, `Scheduled`, `Ready to Schedule`, `New`, `Evaluation Needed`, `Write Estimate`, `Waiting on Approval`, `In Progress`, `On Hold`, `Completed/Needs Billing`, `Billed/Waiting for Payment`, `Completed/Paid`, `Closed`

`WORKFLOW_STATUSES` (status picker order — natural job lifecycle): `New` → `Evaluation Needed` → `Write Estimate` → `Waiting on Approval` → `Ready to Schedule` → `Scheduled` → `In Route` → `On Site` → `In Progress` → `On Hold` → `Completed/Needs Billing` → `Billed/Waiting for Payment` → `Completed/Paid` → `Closed`

**Status pill colors on job tiles** (claudia.html `StatusPill` component):
- All pills are **neutral/muted** by default — no per-status colors
- **Green** (`#5d8a3a`) pill + left border — status is `Scheduled` and date is today or future
- **Red** (`#b5432f`) pill + left border — status is `Scheduled` and date has already passed (overdue)

**Job types** (claudia.html `JOB_TYPES`): `Service Call`, `New Install`, `Maintenance`, `Replacement`, `Warranty`, `Estimate`

### `job_photos`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| job_id | uuid FK → jobs | |
| storage_path | text | path in Supabase Storage bucket `job-photos` |
| photo_type | text | enum: `equipment`, `estimate`, `invoice`, `other` |
| ocr_data | jsonb | nullable — Claude OCR extraction results |
| created_at | timestamptz | |

### `equipment`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| customer_id | uuid FK → customers | |
| brand | text | nullable |
| model | text | nullable |
| serial | text | nullable — used as upsert key per customer_id |
| tonnage | text | nullable |
| refrigerant | text | nullable |
| fuel_type | text | nullable — enum: `gas`, `electric`, `oil`, `other` |
| manufacture_year | int4 | nullable |
| install_date | date | nullable |
| condition | text | nullable — enum: `Good`, `Fair`, `Poor`, `Condemned` |
| notes | text | nullable |
| updated_at | timestamptz | |

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | e.g. Tyler, Jack, Brett, Admin |
| role | text | `office`, `hnic`, `technician`, `laborer` |

### `chores`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| description | text | |
| assigned_to | uuid FK → users | nullable |
| job_id | uuid FK → jobs | nullable — chores can be free-floating or job-linked |
| customer_id | uuid FK → customers | nullable |
| due_date | date | nullable |
| priority | text | `normal`, `billing` |
| status | text | `open` or `done` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `components`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | part/component name |
| description | text | nullable |
| part_number | text | nullable |
| cost | numeric | nullable — unit cost |
| *(schema needs verification)* | | |

### `job_components` (junction)
| Column | Type | Notes |
|--------|------|-------|
| job_id | uuid FK → jobs | |
| component_id | uuid FK → components | |
| *(may have quantity or other fields — needs verification)* | | |

### `job_equipment` (junction)
| Column | Type | Notes |
|--------|------|-------|
| job_id | uuid FK → jobs | |
| equipment_id | uuid FK → equipment | |

### `job_notes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| job_id | uuid FK → jobs | |
| user_id | uuid FK → users | nullable — who wrote the note |
| content | text | |
| source | text | CHECK constraint: `('voice', 'text', 'system', 'user')` — use one of these exact strings |
| created_at | timestamptz | |

### `job_status_history`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| job_id | uuid FK → jobs | |
| old_status | text | nullable |
| new_status | text | |
| changed_by | uuid FK → users | nullable |
| changed_at | timestamptz | |
| *(schema needs verification)* | | |

### `line_items`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| job_id | uuid FK → jobs | |
| description | text | |
| quantity | numeric | nullable |
| unit_price | numeric | nullable |
| total | numeric | nullable |
| created_at | timestamptz | |
| *(schema needs verification)* | | |

### `notifications`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → users | nullable |
| message | text | |
| read | boolean | |
| created_at | timestamptz | |
| *(schema needs verification)* | | |

### `photos`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| storage_path | text | |
| job_id | uuid FK → jobs | nullable |
| customer_id | uuid FK → customers | nullable |
| created_at | timestamptz | |
| *(schema needs verification — may overlap with job_photos)* | | |

### `receipts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| job_id | uuid FK → jobs | nullable |
| amount | numeric | |
| vendor | text | nullable |
| date | date | nullable |
| storage_path | text | nullable — photo of receipt |
| created_at | timestamptz | |
| *(schema needs verification)* | | |

### `sync_queue`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| operation | text | `insert`, `update`, `delete` |
| table_name | text | target table |
| payload | jsonb | |
| status | text | `pending`, `synced`, `failed` |
| created_at | timestamptz | |
| *(schema needs verification — used for offline support)* | | |

### Supabase Storage
- Bucket: `job-photos` (public)
- Path pattern: `job-photos/{jobId}/{timestamp}.jpg`
- Access via `supabase.storage.from('job-photos').getPublicUrl(path)`

---

## RLS Policies

**RLS is ON.** Row Level Security is enabled on the Supabase database. The specific policies are configured in the Supabase dashboard (no policy SQL is committed to the repo). Before writing queries that add or modify data, account for the fact that RLS policies will gate what the anon key can read and write.

---

## Tenant Scoping

**Not implemented.** There is no multi-tenancy:
- No authentication system
- `assigned_to` on jobs is a free-text string — no validated user reference
- All data is globally visible to anyone with the anon key
- Single Supabase project = single implicit tenant

Future plan (from PROJECT_SPEC.md): role-based access (service tech vs. admin), but nothing is built yet.

---

## Environment Variables

There is no `.env.example` — this is a known gap. Required vars:

| Variable | Where used | Notes |
|----------|-----------|-------|
| `EXPO_PUBLIC_SUPABASE_URL` | `lib/supabase.ts` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase.ts` | Supabase public anon key |
| `extra.backendUrl` in `app.json` | `lib/api.ts` via `Constants.expoConfig?.extra?.backendUrl` | Backend API endpoint; currently hardcoded as `http://10.0.0.120:3001` (LAN dev) |

---

## Project Structure

```
app/
  _layout.tsx          # Root layout: loads 4 Google Fonts, configures StatusBar, wraps Stack navigator
  index.tsx            # Dashboard — job list, pipeline value, status filter tabs
  job/[id].tsx         # Job detail: status/reschedule/chores/photos/equipment
components/
  JobCard.tsx          # Job list card — customer, type, address, status chip, time, value
  VoiceBar.tsx         # Floating voice input — native speech or browser SpeechRecognition or text fallback
  ConfirmJobModal.tsx  # Confirm/edit voice-extracted job data before saving to Supabase
  PhotoCapture.tsx     # Camera/gallery picker + Supabase Storage upload + OCR
  PhotoStrip.tsx       # Horizontal scrollable photo thumbnail gallery
  EquipmentCard.tsx    # Equipment detail chips (brand, model, serial, tonnage, refrigerant, etc.)
  OCRResultCard.tsx    # Editable form for Claude OCR-extracted equipment or document data
lib/
  supabase.ts          # Supabase client singleton (EXPO_PUBLIC_* env vars)
  types.ts             # TypeScript interfaces: Job, Customer, Equipment, JobPhoto, User, Chore + enums
  api.ts               # Backend API calls: submitVoice(), submitOCR() — VoiceResult and OCRResult types
  queries.ts           # All Supabase queries (16 functions covering all data operations)
  status.ts            # Status enum helpers: STATUS_LABELS, STATUS_COLORS, statusesForJobType(), formatTime(), formatDate()
  platform.ts          # Platform-aware font scaling (fs()) and color palette (colors object)
```

---

## Component Details

### `VoiceBar.tsx`
States: `idle` → `input` → `listening` → `processing` → `confirming` → `error`. Three speech modes determined at runtime:
- **Native:** `expo-speech-recognition` (Android/iOS dev build) — has ~8s processing lag
- **Web speech:** browser `SpeechRecognition` API (Chrome/Edge) — `WEB_SPEECH` flag path
- **Text fallback:** shown in Firefox/Safari or when speech unavailable

Color-coded: green (#8fba3c) = ready, red = listening, gold (#c8b97a) = accent. On success, opens `ConfirmJobModal`.

### `PhotoCapture.tsx`
States: `idle` → `uploading` → `reading` → `extracted` → `error`. Flow:
1. Pick from camera or gallery via `expo-image-picker`
2. Upload to Supabase Storage at `job-photos/{jobId}/{timestamp}.jpg`
3. Send base64 to `/api/ocr` → Claude extracts structured data
4. Render `OCRResultCard` with editable result
5. On save: if `photo_type === 'equipment'` → `upsertEquipment()` by `(customer_id, serial)`

### `OCRResultCard.tsx`
Two field sets depending on `photo_type`:
- **equipment:** brand, model, serial, tonnage, refrigerant, fuel_type, year
- **document (estimate/invoice/other):** customer_name, address, description, amount, date

### `app/index.tsx` (Dashboard)
Status filter tabs show only statuses that have at least one job. On load, the **first occupied status tab is auto-selected** (not "All") — so if there are On Site jobs the dashboard opens to that view. "All" and "Closed" tabs are always available. Job tiles show the original_ask inline after the job type, truncated with ellipsis.

### Job Detail (claudia.html `JobDetail` component)
- **CURRENT STATUS** label + color pill displayed above the UPDATE STATUS button
- Status picker uses `WORKFLOW_STATUSES` order (lifecycle order, not dashboard tab order)
- Any status change immediately closes detail and returns to dashboard
- Back `‹` arrows are 36px with extra tap padding for finger use
- Bottom of screen: UPDATE STATUS → | DELETE JOB | ‹ BACK (three full-width buttons)
- Customer name display: shortens "Last, First Middle" format to "First Last-initial"

---

## Design System

All colors and font scaling live in `lib/platform.ts`:

```ts
colors = {
  bg:      '#0b0c08',   // near-black olive
  surface: '#0e0f0a',
  surface2:'#111114',
  border:  '#2a2b22',
  accent:  '#8fba3c',   // green
  gold:    '#c8b97a',
  text:    '#d4d0b8',   // warm off-white
  muted:   '#6b7252',
}
```

Font scale: `fs(size)` → `size * 1.4` on web, `size * 1.3` on native. Always use `fs()` for font sizes; never hardcode.

Fonts (loaded in `app/_layout.tsx`):
- **Russo One** — section headers, labels
- **Share Tech Mono** — data values, status chips, numeric readouts
- **Barlow 400** — body text
- **Barlow 600** — emphasized body

---

## Lib: `queries.ts` — Query Reference

| Function | Description |
|----------|-------------|
| `fetchAllJobs()` | All open jobs ordered by `scheduled_time` |
| `fetchTodaysJobs()` | Jobs scheduled for today (time-filtered) |
| `fetchJob(id)` | Single job by id |
| `fetchCustomerHistory(customerId, excludeJobId)` | Last 10 jobs for a customer |
| `fetchJobPhotos(jobId)` | All photos for a job |
| `fetchEquipmentForJob(jobId)` | Equipment via `job_equipment` junction |
| `fetchChores(jobId)` | Chores with assignee name via relationship |
| `updateJobStatus(id, status)` | Updates `status` + `updated_at` |
| `updateJobTime(id, scheduled_time)` | Updates `scheduled_time` + `updated_at` |
| `findCustomerByName(name)` | Case-insensitive customer search |
| `insertCustomer(fields)` | Creates customer, returns id |
| `insertJob(fields)` | Creates job, returns full Job object |
| `insertJobPhoto(fields)` | Saves photo metadata + ocr_data |
| `insertChore(jobId, description, customerId)` | Creates chore |
| `toggleChore(id, status)` | Updates chore status |
| `upsertEquipment(customerId, jobId, fields)` | Creates/updates equipment by `(customer_id, serial)`, links to `job_equipment` |

---

## Build & Deploy

### Active deployment: `claudia.html` → GitHub Pages
**`claudia.html` is the only deployed app.** It is a single-file React 18 app using Babel Standalone for in-browser JSX transpilation (no build step). It is what users actually use.

The Expo/React Native app (`app/`, `components/`, `lib/`) is **not deployed** and not the active product. Changes intended for users must go into `claudia.html`.

**Deploy trigger:** `.github/workflows/deploy.yml` fires on any push to `main` that touches `claudia.html`. It copies the file to `dist/index.html` and deploys to the `gh-pages` branch via `peaceiris/actions-gh-pages`. Deploys typically complete in ~1 minute.

**claudia.html architecture:**
- React 18 UMD + Babel Standalone loaded from unpkg/jsDelivr CDN
- `<script type="text/babel">` block contains the entire app (~3000 lines)
- Supabase JS client loaded from CDN — credentials hardcoded in the file
- `fromRow(row)` maps DB rows → app job objects; `toRow(job, customerId, userId)` maps back
- `deriveCustomers(jobs)` builds multi-property customer records client-side from job history
- Claude proxy calls go to `CLAUDE_PROXY = ${SUPABASE_URL}/functions/v1/claude-proxy?apikey=${SUPABASE_KEY}`
- CSP `eval` warnings in browser DevTools are expected and harmless — Babel Standalone requires eval; GitHub Pages sends no CSP headers

### EAS / Expo — paused
EAS mobile builds are on hold. Do not assume any native build is current or runnable.

### CI/CD
- GitHub Actions deploy (`deploy.yml`) is the only active CI/CD — triggers on `claudia.html` changes to `main`.
- EAS builds triggered manually if/when resumed: `eas build --platform android --profile development`

---

## Recurring Gotchas

| Issue | Severity | Detail |
|-------|---------|--------|
| **Bump APP_REV every commit** | Critical | `const APP_REV = NNN;` near top of claudia.html. Currently **230**. Forgetting this makes Jack think the deploy failed — he sees the old revision number on the dashboard. Increment by 1 every commit, no exceptions. |
| **A period's end timestamp must compare against its own START day, not the literal today (r225)** | Medium | `fmtTimestamp(iso)` (claudia.html:288-297) omits the date only when `iso`'s calendar day equals `todayLocalISO()` — the real, literal current day. Used directly on `p.end` in both `JobDetail`'s Time Log and `HoursReport`'s BY DAY per-period lines (r224), this silently dropped the date whenever a period's end happened to land on today while its start didn't — a period that was actually open for ~48 hours read as e.g. "6:36 PM – 7:06 PM (48h 30m)" with no visual sign of the gap. Fixed via a new `fmtPeriodEnd(startIso, endIso)` (next to `fmtTimestamp`) that compares the end's day to the **start's** day instead — `fmtTimestamp` itself is untouched since it's still used elsewhere for genuine "is this today" display. **Any new per-period timestamp range display must use `fmtPeriodEnd` for the end side, not bare `fmtTimestamp`**, or this same misleading-date bug will resurface. |
| **`jobs.deposit_amount`/`deposit_method`/`deposit_check_number` need SQL migration (r226)** | Medium | New columns for tracking a customer deposit against a job — one per job (not a list like Receipts), edited via a DEPOSIT panel in `JobDetail` right under JOB VALUE (`!isShop`, view-only when `isClosed`, same gating as JOB VALUE). Added via Supabase dashboard SQL (no migration files). Deliberately NOT in `toRow` (same reasoning as `materials_needed`/`site_name`) — written only via guarded `updateJobDeposit(id, fields)`, which shows a "Deposit needs one-time DB setup — ask Jack" toast on `PGRST204` instead of failing silently. If deposits don't persist, run `ALTER TABLE jobs ADD COLUMN deposit_amount numeric; ALTER TABLE jobs ADD COLUMN deposit_method text; ALTER TABLE jobs ADD COLUMN deposit_check_number text; NOTIFY pgrst, 'reload schema';`. New helper `jobBalance(j)` (next to `money()`, ~line 266) is `Math.max(0, value - deposit_amount)` — used wherever "outstanding" money is summed (dashboard header total, `BalancesScreen`'s four status buckets) so a deposit reduces those figures. Deliberately **not** touched: `BalancesScreen`'s COLLECTED section (already-fully-collected `Completed/Paid` jobs — the deposit is part of that total, not separate from it), `JobCard` dashboard tiles (still show the full job value), and `CloseJobSheet` (out of scope — deposits are usually taken well before a job closes). |
| **`deleteJob` now purges every job_id-linked table (r221)** | Critical | Previously `deleteJob(id)` (claudia.html:3458) did exactly one thing — `sb.from('jobs').delete().eq('id', id)` — leaving `job_notes`, `job_crew`, `job_photos` (+ their Storage files), `receipts` (+ their Storage files), and `chores` all orphaned, still pointing at a `job_id` that no longer existed. Confirmed live: 11 previously-deleted jobs had left 53 orphaned `job_notes` rows and 3 orphaned `job_photos` rows (with real Storage files) sitting in the DB — this is what surfaced as an unremovable "Unknown"-labeled entry in `HoursReport` (`label = job ? job.customer : 'Unknown'`, claudia.html:2251, with no filtering of notes whose job no longer exists). `deleteJob` now purges `job_photos` (Storage files first, mirroring `deletePhoto`), `receipts` (via `receiptPages`, mirroring `deleteJobReceipt`), `job_notes`, `job_crew`, and `chores` — in that order, checking `error` at every step and bailing before touching the `jobs` row if any purge step fails. This is a deliberate departure from the file's usual "fire and forget" delete style (`deletePhoto`/`deleteChore`/`deleteJobReceipt` don't check `error`) — it exists specifically so a partial failure can never create a new orphan the same way the original bug did. **Any new `job_id`-referencing table added in the future must be added to this purge list too**, or the same class of bug reappears. The 53/3 pre-existing orphaned rows from before this fix are a one-time data cleanup, handled separately from this code change (not via app code — a direct, supervised delete against the tables above). |
| **`job.closed_at` is derived, not a DB column (r223)** | Medium | The dashboard's Closed tab sorts by most-recently-closed first, but there's no `closed_at`/`job_status_history` data actually being written (see the "Job-status changes write `Job status →` notes" gotcha below and "`job_status_history` needs verification" in the schema — that table is never queried or inserted into anywhere in claudia.html). `fromRow` derives `closed_at` client-side instead: it scans the job's already-fetched `job_notes` for the last `source==='system'` note matching `/^Job status → Closed\b/` (notes arrive created_at-ascending from `fetchJobs`, so the last match is the most recent close) and uses that note's `created_at`. Falls back to `row.updated_at` (also newly surfaced on the job object by this same change) for jobs closed before this note format existed. These `Job status → …` notes are `source:'system'`, so they're filtered out of both `history` (which shows `source !== 'system'`) and `crewLog` (which only matches the differently-worded `/^Status → /` crew-clock format) — there's no UI anywhere that displays or lets you delete them, so once written they're permanent for the life of the job. |
| **`job.scheduled_date`/`scheduled_time` can now be `null` (r218)** | High | `fromRow` previously masked a null `scheduled_at` by defaulting `scheduled_date` to `todayLocalISO()` and `scheduled_time` to `'09:00'` — this made a never-scheduled job indistinguishable from one genuinely scheduled for today, which the new Calendar View's job-scope filter needed to tell apart. `fromRow` now leaves both `null` when `row.scheduled_at` is null, and adds `has_schedule: !!row.scheduled_at` as the canonical boolean for "does this job actually have a date." Every existing read site was audited: `JobCard`'s overdue/scheduled logic and `fmtDate`/`fmtTime` (both already guard on falsy/`null`) are safe and now show "— · —" instead of a fabricated today's date for an unscheduled job. **Two spots needed a fix** to keep controlled `<input>`s from receiving `null`: `JobDetail`'s RESCHEDULE sheet's `date`/`time` state init, and `JobForm`'s edit-mode initial-state spread — both now fall back to `todayISO()`/`nowTimeRounded15()` when the job has no real schedule, so the picker still opens pre-filled. **Any new code reading `job.scheduled_date` must not assume it's always a string** — check `has_schedule` (or the existing falsy-guard pattern) instead of relying on the old always-a-date behavior. |
| **Equipment scan `tonnage` used to trust the vision model's mental arithmetic (r216, confirmed live)** | High | A Goodman GSX130181ED nameplate scan (verified against the physical label — model #, serial #, refrigerant, voltage, and MCA all OCR'd correctly) came back with `tonnage: "3 ton"` instead of the correct 1.5 ton — Goodman's "018" capacity code unambiguously means 1.5T per the scan prompt's own decode table, and no "036"/"36" substring exists anywhere in that model number, so this wasn't an OCR misread, it was `claude-haiku-4-5` doing the digit-group-to-tonnage lookup wrong in its head (likely pattern-matching to the far more common 3-ton GSX13036 instead of actually decoding the digits) — nothing client-side ever double-checked it, `EQUIP_KEYS.forEach` at the scan-merge site just copied whatever Claude returned. Fix: `deriveTonnageFromModel(modelNumber)` + `CAPACITY_MODEL_PREFIX_RE`/`CAPACITY_CODE_TO_TON` (next to `readFileForScan`, ~line 715) deterministically decode capacity from the model number in JS for known Goodman/Amana/Daikin condenser prefixes (GSX/SSX/GSZ/SSZ/DSZC/DSXC/ASX/ASZ/GSXC/SSXC + 2-digit SEER + 3-digit capacity code), and `finalizeScanResult(result)` overrides `result.tonnage` with the deterministic decode whenever the model number matches — called from both `scanNameplateFromB64` and `scanNameplateFromUrl` right after `JSON.parse`. Only fires for recognized prefixes; anything else (furnaces, motors, other brands, unrecognized formats) falls through unchanged and still relies on Claude's answer as before. If a wrong tonnage recurs on a *different* brand, extend the prefix regex/table rather than reintroducing blind trust in the model's arithmetic. |
| **`job_crew.status` CHECK constraint blocked Pause/Resume 100% of the time (r212, migration confirmed applied)** | Critical | r208/r209 added three new `job_crew.status` values (`Paused`, `Materials Run`, `Shop Run`, see `PAUSE_STATUS_MAP`/`ON_BREAK_STATUSES` near line 306) but never widened the DB's `job_crew_status_check` CHECK constraint to allow them — confirmed live: every pause attempt from r208 onward failed with Postgres error `23514 violates check constraint "job_crew_status_check"`, and `upsertJobCrewStatus` silently swallowed it into a generic "check connection" toast (zero `job_crew` rows or `job_notes` ever recorded any of the three values before r212). The `ALTER TABLE job_crew DROP CONSTRAINT job_crew_status_check; ALTER TABLE job_crew ADD CONSTRAINT job_crew_status_check CHECK (status IN ('In Route','On Site','Paused','Materials Run','Shop Run')); NOTIFY pgrst, 'reload schema';` migration has been run in Supabase — Jack confirmed PAUSE works in production. r212 also made the failure self-diagnosing: `upsertJobCrewStatus` now stashes the real Postgres error in module-level `lastJobCrewError`, and the four callers that show a "check connection"-style toast on failure (`pauseClock`, `resumeClock`, `clockIn`, `moveToInRoute`) now append `lastJobCrewError?.message` instead of a fixed generic string — so the *next* DB-side rejection like this shows the real reason instead of masquerading as a network issue. Deliberately did not touch `upsertJobCrewStatus`'s return contract (still `data \| null`) since ~14 other call sites treat a truthy return as the crew row itself. |
| **`JobDetail`'s `isClosed` gate must be extended to any new edit surface (r213); dangling Time Log periods are a deliberate exception (r222)** | High | `const isClosed = job.status === 'Closed';` (~line 6149) locks every field-editing control in `JobDetail` once a job is Closed — EDIT button (hidden, mirroring how DUPLICATE only shows *when* Closed), the new inline JOB VALUE tap-to-edit, SCHEDULED (rendered as a plain non-clickable div instead of a button), ORIGINAL ASK/NOTES (`readOnly`), MATERIALS NEEDED's add row/checkbox/remove, RECEIPTS' add/edit/delete, the daily log/service record's add box and per-entry ✎, and the TIME LOG's per-period ✎/🗑 and "+ ADD ENTRY". Deliberately **not** gated: UPDATE STATUS and DELETE JOB (both stay available on Closed jobs so a mis-closed job can be reopened or removed), CREW STATUS editing, PHOTOS, and the equipment scan sheet. **Any new editable field/button added to `JobDetail` must be checked against `isClosed` and wrapped the same way** — the existing gates don't automatically cover new UI. **r222:** the TIME LOG's per-period ✎/🗑 (claudia.html:7666) is now `{(!isClosed || p.dangling) && (...)}` instead of plain `{!isClosed && (...)}` — a dangling period (⚠️ NO CLOCK-OUT, r204) is a data-quality bug, not a field edit, and was otherwise an unfixable dead end once a job closed (the HoursReport ⚠️ flag tells Jack to "open the TIME LOG to add the missing end time," which used to be impossible on a Closed job without a full reopen/re-close round-trip). `saveLogEdit`/`deleteLogPeriod` needed no changes — both already handle a missing `endId`/non-ongoing period correctly (r190). Every non-dangling period on a Closed job stays fully locked; "+ ADD ENTRY" stays gated by `isClosed` alone since it creates a new period rather than repairing an existing one. |
| **Clock transitions guarded against double-fire (r211)** | High | `clockIn`/`clockOut`/`flipToOnSite`/`moveToInRoute`/`pauseClock`/`resumeClock` all closed over `clockSession` via React state, with no protection against two overlapping calls (e.g. a double-tap on a CONFIRM button before it unmounts). Verified against live Supabase data: `moveToInRoute` fired twice 272ms apart on 2026-07-07, and the second call raced the first's stale `clockSession` closure, clearing the same old job a second time instead of the job the first call had just entered — leaving a `Status → In Route` note with no clock-out (a dangling period, r204's `dangling` tracking is what surfaced it as Brett's 10h40m drive-time anomaly). Fix: a single shared `clockActionInFlight` ref (declared next to `clockSessionRef`, ~line 2410) — each of the six functions checks-and-sets it as its first line and resets it in a `finally` wrapping the whole function body, so a second overlapping call to *any* of the six is a silent no-op instead of a race. One ref guards all six (confirmed safe: none of the six calls another of the six internally, so it can't self-deadlock). `clockIn`/`moveToInRoute` nest the new `try/finally` around their pre-existing inner `try/catch` rather than merging the two. |
| **The CREW CHECK "YES" handler was missed by the r211 double-fire guard (r228)** | High | r211 guarded the six core clock functions but missed the "Is {name} coming with you?" CREW CHECK sheet's YES button — confirmed live: two identical `Status → In Route (Brett) — with Jack` notes landed on the same job at the exact same instant, producing a bogus 1-minute phantom period in the Time Log (mechanically identical to the bug r211 fixed elsewhere, just a different call site). This YES button's `onClick` is duplicated **three times** in the file (once per App-level render path, matching the Sheet Placement Rule) — all three now reuse the same `clockActionInFlight` ref (safe: the handler calls `clearCrewWithNote`/`upsertJobCrewStatus` directly, never any of the six already-guarded functions, so no deadlock risk). `answerTravelCheck` (`JobDetail`'s own "is X coming with you" flow, a different UI entry point doing the identical write) got its own local `travelCheckInFlight` ref instead, since it's defined inside `JobDetail` where the App-level `clockActionInFlight` ref isn't in scope. **Any future new crew-check-style prompt that writes a field-status note must be guarded the same way** — this bug's whole signature is "a note-writing handler with no in-flight guard," and it keeps resurfacing at new call sites one at a time. Note: a *second*, harder-to-guard variant of this same symptom also exists — two different people's phones independently recording the same real-world event ~seconds apart (one via their own `clockIn()`, one via someone else's CREW CHECK confirmation) produces the identical-looking duplicate but isn't a single handler double-firing, so this guard doesn't (and can't) prevent it. |
| **`job_photos.ocr_data` now written (r202)** | Medium | Previously documented in the schema but never read/written anywhere. `updatePhotoOcrData(photoId, data)` (guarded, degrades on `PGRST204` like `site_name`/`filter_size`) now persists a scan attempt's result after `Lightbox`'s `doScan` completes (success or "no data found"), so the same photo won't re-offer scanning after being closed and reopened. If scan state stops persisting across sessions, the column may need `ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS ocr_data jsonb; NOTIFY pgrst, 'reload schema';`. |
| **Deleting a Time Log entry can now clear a live crew status** | Medium | `deleteLogPeriod(period, name)` (r199) — previously the 🗑 button was hidden entirely for `ongoing` periods (no `endId` yet, person still actively marked on this job). It's now shown for those too; if `period.ongoing`, deleting also calls `clearJobCrewStatus(job.id, userId)` and prunes `crew` state, in addition to deleting the `job_notes` row — otherwise the log entry would vanish while the person still showed as live "In Route"/"On Site" everywhere else (CREW STATUS section, other users' views). Confirm dialog text changes for the ongoing case to warn about this side effect. Does not touch the other device's local `clockSession` — same as the existing CREW STATUS "clear" path (`saveCrewEdit`), that device's `reconcileClockFromCrew` picks up the cleared `job_crew` row on its own next check. |
| **`clockOut` no longer fires CREW CHECK (r215, was a real live bug)** | High | Previously `clockOut` fired `LeavingCrewCheck` ("is [teammate] coming with you?") whenever a teammate was still on site, defaulting their destination to the shop if answered YES — the entry used to say Jack reported this "never fires in practice," but it was confirmed live 2026-07-10: clocking out of a New Falls Road job with Brett still on site fired the prompt, and it left Brett marked In Route to the shop for real (job_notes `Status → In Route (Brett) — with Jack` on the shop job, `job_crew` row still showing it 11 minutes later) even though Jack said he never meant Brett to go anywhere — he was clocking out, not heading somewhere with a passenger. Root cause: clocking out isn't "going somewhere" the way `moveToInRoute` is, so "coming with you" never made sense as a clock-out question in the first place. Fix: `clockOut` (~line 2865) no longer computes `stillOnSite`/`othersOnSite`/`shopJob` or calls `setLeavingCrewCheck` at all — a teammate still on site when you clock out is left exactly as they are; only `moveToInRoute` (actually heading to a new job) still asks this. `pendingShopActivity` (the separate "what were you doing at the shop" prompt) now fires whenever `wasShop` regardless of who else is on site, instead of only when nobody else was there. |
| **Every crew-status clear MUST go through `clearCrewWithNote`** | Critical | Root cause of the unreliable time data, fixed r203. `buildCrewTimeline` derives a period's end from the *next* `Status →` note on the same job — so any code path that cleared a `job_crew` row without also writing a `Status → Cleared` note left a period that never closes (and reports counted it as "worked until now" before r204). **Eight** call sites had this gap: the CREW CHECK YES handler (×3 copies), `answerTravelCheck`, both `routeCrewMember` branches, `saveCrewEdit`'s move-to-another-job branch, and the orphan-session "I ALREADY CLOCKED OUT" button. All clears now go through `clearCrewWithNote(jobId, userId, personName, at, suffix, actorId)` (defined next to `clearJobCrewStatus`, ~line 835), which clears the row AND writes the Cleared note atomically, returning `{ note }` for local `crewLog` state appends or `{ error }` if the clear failed. Only two raw `clearJobCrewStatus` calls remain, both intentional: `undoClockAction` (undo reverts a transition, doesn't end a real period) and `deleteLogPeriod` (deletes the period's start note, so nothing is left open). **Never add a new raw `clearJobCrewStatus` call site.** (Historical context: before r190 dangling periods couldn't even be closed manually; r190's `saveLogEdit` END input inserts a `Status → Cleared (...) (edited)` note when `endId` is missing.) |
| **Job-status changes write `Job status →` notes, NOT `Status →`** | Critical | r205. `updateJob`'s status-change note is now `Job status → X (Name)`. The plain `Status → X (Name)` format is reserved for crew clock events — `parseCrewLogEntry` and `fromRow`'s `crewLog` filter (`/^Status → /`) read that format as clocked time, so before r205 picking "In Route"/"On Site" from the UPDATE STATUS picker created a **phantom clock-in period** for whoever tapped it (plus the picker's auto-`assigned_to` reassignment, which is intentional and kept). Historical picker notes in the old format are indistinguishable from real clock-ins and stay in the data (surfaced by r204's ⚠ flags, deletable via the Time Log 🗑). `BalancesScreen`'s COLLECTED section parses **both** formats (`/^(?:Job status\|Status) → /`) since historical Completed/Paid transitions predate the change — any new consumer of status-change notes must do the same. Never write a `Status → …` job_note for anything that isn't a person's clock transition. |
| **`clockUndo.noteIds` — UNDO deletes the notes it reverses** | Medium | r205. `clockIn`/`flipToOnSite`/`moveToInRoute`/`clockOut` collect their inserted job_note ids into `clockUndo.noteIds`; `undoClockAction` deletes those rows before restoring crew rows/session. Without this, an undone clock-in left its `Status → …` note behind as a phantom period start. Any new clock transition that writes notes and offers undo must add its note ids to the undo object. |
| **Dangling periods count as ZERO everywhere — never "until now"** | Critical | r204. `buildCrewTimeline` periods now carry `dangling: !end && !current` (no closing note AND no live `job_crew` row = the clock-out was never recorded), distinct from `ongoing` (no closing note but a live crew row = genuinely still working, counts to now). Before r204, `HoursReport` and `CloseJobSheet` counted every unclosed period as "worked until now/week-end" — this was the silent totals inflation that destroyed trust in the numbers. Now: dangling periods contribute **0 ms** to all totals (HoursReport all three tabs, CloseJobSheet labor, JobDetail Time Log day sums) and are ⚠-flagged in red (HoursReport shows a banner with the count; Time Log rows read "⚠️ NO CLOCK-OUT"), pointing at the Time Log editor to add the real end time. For `dangling` to be accurate the caller MUST pass real `job_crew` rows as the second arg — `HoursReport` and `CloseJobSheet` now fetch them; passing `[]` makes every open period look dangling (fine for `findOverlappingActivity`, which ignores the flag deliberately — open-ended periods stay conservative for overlap warnings). |
| **Every `buildCrewTimeline` call is per-job, never cross-job** | Medium | All three call sites (`JobDetail`'s Time Log, `CloseJobSheet`'s labor summary, `HoursReport`) group `job_notes` by `job_id` first, then build each job's timeline independently — a person's periods on Job A have no awareness of their periods on Job B. Manually-entered/edited end times (`saveLogEdit`, `saveAddLog`) can therefore overlap with time already logged elsewhere for the same person, which double-counts hours in both jobs' totals with no error. r191 adds `findOverlappingActivity(personName, excludeJobId, startIso, endIso, users)` (~line 333) — queries `job_notes` globally (excluding the job being edited, padded ±3 days) and warns via `confirm()` before saving if the new window overlaps another job's logged (or still-open) time for that person. It's a warn-and-allow guard, not a hard block — Jack can still save through it if the overlap is expected (e.g. backfilling messy historical data). |
| **`jobs.site_name` needs SQL migration** | Medium | r185 adds `jobs.site_name text` (business name / unit # for multi-site customers, distinct from the street address). Added via Supabase dashboard SQL (no migration files). Deliberately NOT in `toRow` (same reasoning as `materials_needed`) — written only via guarded `updateJobSiteName(id, name)`, called as a follow-up after `addJob`/`saveEdit` succeed, so a missing column never breaks a job save. Confirmed live (r187): the migration had NOT been run, so site names were silently not persisting on save — `updateJobSiteName` now shows a toast ("Site name needs one-time DB setup — ask Jack") on `PGRST204` instead of failing silently, so this is self-diagnosing if it recurs on a fresh environment. If site names still don't persist, run `ALTER TABLE jobs ADD COLUMN site_name text; NOTIFY pgrst, 'reload schema';`. |
| **Shop job never prompts a status update / never auto-flips to In Progress** | Medium | `ClockOutSheet` (r180) excludes `job.customer===TMC_SHOP_NAME` from `needsStatusUpdate` — clocking out of the shop never shows "UPDATE JOB STATUS". `flipToOnSite` (r180) now also guards `job.customer?.toUpperCase() !== TMC_SHOP_NAME` before auto-setting status to `In Progress`, matching the guard already present in `clockIn`/`moveToInRoute`. The shop sentinel is created with `current_status:'In Progress'` in `ensureShopSentinel` and is meant to stay there — no code path should change it. |
| **Shop JobDetail is a stripped variant** | Low | `const isShop` (JobDetail, `job.customer===TMC_SHOP_NAME`) hides JOB VALUE, SCHEDULED, ORIGINAL ASK, NOTES, and the contact/SITE ADDRESS block (r179), and lifts the shared `materialsSection` up under TODAY'S TIME (r177). The materials block is a single `materialsSection` const rendered `{isShop && …}` at top or `{!isShop && …}` in the normal spot — edit it once, not twice. Section collapsibles default **closed** every load (r179; `useState(false)`, persist writes kept but not read at init). **Checked-off materials behave differently by design (r219, undo made inline r220):** on a normal job they stay visible/struck-through in the list indefinitely (even through Closed) — that's the record of what was needed. On the TMC SHOP job specifically, checking one off shows it struck-through for 4s with an inline UNDO button right on that same row (`shopAcquiredPending` Set of indices still shown despite `acquired:true`; `shopHideTimers` ref holds the per-index timeout) — r220 moved the UNDO affordance from a fixed-position bottom toast into the row itself after Jack found the toast too far from the checkbox to notice. `acquired:true` still persists via `updateJobMaterials` either way, only the *shop's* rendered list filters it out once its grace window lapses. `toggleMaterial(idx)` is shared by both paths; the shop-only behavior is gated on `isShop` inside it, so don't move this logic into a separate function per variant. |
| **clockSession is per-device; reconcile against `job_crew`** | High | `clockSession` lives in per-device localStorage; `job_crew` (job_id,user_id,status,status_at) is the SHARED truth (what CREW STATUS shows). They drift: a teammate marking you On Site updates the DB row but not your device's session; clocking out on one phone leaves a dead session copy on another. `reconcileClockFromCrew` (r175, runs on mount/switch + 60s refresh + window focus) is the authority — it syncs `clockSession.status/jobId` from your active crew row, clears the local session if you have NO active crew row (clocked out elsewhere — no stale prompt), and judges "stale prior-day session" by the crew row's `status_at` (NOT the old local `startedAt`). Has a network guard: never act on a failed fetch. Don't reintroduce `startedAt`-based stale detection. |
| **`receipts.paid_by` needs SQL migration** | Medium | r172 adds `receipts.paid_by text` (who fronted the money, for reimbursement). Added via Supabase dashboard SQL (no migration files). `insertReceiptRow`/`updateReceiptRow` retry without `paid_by` on `PGRST204` so receipts still save/edit before the column exists. If "paid by" silently doesn't persist, run `ALTER TABLE receipts ADD COLUMN paid_by text; NOTIFY pgrst, 'reload schema';`. |
| **Multi-page receipts: `storage_path` is newline-joined paths, not a single path** | Medium | r207. A receipt's page photos live newline-joined in the existing `receipts.storage_path` text column (page 1 first) — deliberately no schema change. **Every consumer must read it via `receiptPages(r)`** (defined next to `updateReceiptRow`, with `receiptPhotoUrl(path)` and `appendReceiptPage(receipt, jobId, file)`); never treat `storage_path` as one path (delete must `remove(receiptPages(r))` or extra pages orphan in storage). After each snap, both receipt cameras (JobDetail + `CloseJobSheet`) set `receiptPagePrompt` — a "more pages?" YES/NO box; YES stores the target receipt in a **ref** (`receiptPageTargetRef`/`pageTargetRef`, not state — same tap must open the camera) and clicks a third hidden input whose handler `appendReceiptPage`s and keeps the prompt up for another page. Only page 1 is OCR'd — multi-page totals may need manual amount edit. JobDetail's receipt ✎ panel has 📷 ADD PAGE as the recovery path if the camera round-trip drops the prompt (r170 lesson: the row is already saved, so nothing is lost). Typed-only saves (`saveJobReceipt`/`saveReceipt`) never prompt. |
| **Receipt photo auto-saves the row in the handler** | Medium | r171: the receipt camera (`handleJobReceiptFile`/`handleReceiptFile`, two copies — JobDetail + `CloseJobSheet`) uploads to `job-photos`, runs `scanReceiptFromB64` (Claude proxy → `{vendor,amount,date}`), and **inserts the `receipts` row immediately within the single `onChange`** (photo + OCR'd vendor/amount), then closes the form. Review/delete in the receipts list (it shows a thumbnail). Do NOT switch back to a deferred "pre-fill then separate SAVE tap" — on mobile the camera round-trip resets the form, so the SAVE never fires and the photo orphans (r170's vanishing-receipt bug). Manual SAVE (`saveJobReceipt`/`saveReceipt`) is for typed-only entries and resets `rSaving` on its empty-guard. |
| **Filter/materials columns need SQL migration** | High | r168 uses `equipment.filter_size text` + `equipment.filter_last_replaced date`; r169 uses `jobs.materials_needed jsonb`. These were added via Supabase dashboard SQL (no migration files in repo). `updateEquipment` retries without filter fields on `PGRST204` so it degrades gracefully if the migration hasn't run. If filters/materials silently don't save, the columns are missing — run the ALTER TABLE + `NOTIFY pgrst, 'reload schema';`. |
| **Navigation prompt fires LAST in the In Route flow** | Medium | When selecting In Route, the leaving prompts chain: CREW CHECK → (LAST ONE OUT *or* SHOP ACTIVITY) → NAVIGATION. The "want directions?" prompt (`pendingMapsJob`) must always be last, so it is **carried** through the preceding prompts and only fired on their resolution — `pendingShopActivity.mapsJobId` and `lastLeaveJob.mapsJobId` (r166). Never `setPendingMapsJob` in the same pass as `setLastLeaveJob`/`setPendingShopActivity`, or the navigation sheet stacks on top instead of firing last. |
| **All times are app-TZ (Philly), never device/UTC** | High | The whole app renders and constructs times in the configurable app timezone via `getAppTZ()` (localStorage `tmc_timezone`, default `America/New_York`, set in Settings). **Display:** `tzClock`/`fmtTimestamp` (h:mm AM/PM), `tzTimeHHMM` (24h), `dateISOInTZ`/`todayLocalISO` (date). **Construct from a picked wall time:** `zonedWallToISO(date, 'HH:MM')` and `zonedLocalInputToISO('YYYY-MM-DDTHH:MM')` (both interpret the input AS app-TZ → UTC instant). `todayISO()` is now an **alias for `todayLocalISO()`** (app-TZ), so every "today" is Philly. Never use `new Date(...).getHours()`/`setHours()`/`.toISOString().slice(0,10)`/`new Date(\`${d}T${t}\`)` for user-facing time/date — that reintroduces device/UTC drift (clock-out showing the wrong hour, scheduled times shifted, 8 PM day-rollover). Stored instants remain UTC ISO; only display/entry is zoned. (Coarse non-clock date math like the 60-day warranty countdown and HoursReport week range stay device-local intentionally.) |
| **Push to main, always** | Critical | Jack's rollback strategy depends on numbered r-commits on `main`. Never leave work only on a feature branch. Use `git push origin HEAD:main` if the branch name differs. |
| **claudia.html IS the app** | Critical | All user-facing changes must go in `claudia.html`. The Expo/RN app (`app/`, `components/`, `lib/`) is not deployed and not in active use. |
| **Bank a clock leg before resetting `legStartedAt`** | High | The daily total relies on `addTodayMs` being called for the finished leg at every transition that resets `legStartedAt` (`moveToInRoute`, `clockOut`). Reset the leg without banking and that time vanishes from TODAY'S TIME. In Route → On Site is the *same* leg — `flipToOnSite` must NOT reset `legStartedAt`. Never use the persisted `startedAt` for elapsed math (it survives across days → multi-day durations); use `legStartedAt`. |
| **DB column names differ from Expo types** | Critical | Live DB uses `flow_type`, `current_status`, `scheduled_at`, `site_address` — NOT `job_type`, `status`, `scheduled_time`, `address`. Never use Expo app column names when writing queries for claudia.html. |
| **PostgREST schema cache staleness** | High | After `ALTER TABLE`, PostgREST caches the old schema and returns `PGRST204 "Could not find the X column"` until refreshed. Fix: run `NOTIFY pgrst, 'reload schema';` in Supabase SQL Editor. May take 5-10 min to propagate across all replicas. |
| **`site_address` column may be missing** | High | Run `ALTER TABLE jobs ADD COLUMN site_address text; NOTIFY pgrst, 'reload schema';` if multi-property site picker or job saves fail with PGRST204 for `site_address`. |
| **job_notes source constraint** | Medium | `job_notes.source` has CHECK constraint: allowed values are `'voice'`, `'text'`, `'system'`, `'user'`. Server-side triggers that write `source='system'` will fail the whole job insert if this constraint has been tightened. Verified expanded to include all four values. |
| **Claude proxy CORS** | Medium | `claude-proxy` edge function CORS only allows `Authorization` and `Content-Type` headers. Pass `apikey` as a URL query param (`?apikey=...`) not a header — browser preflight rejects unknown headers. |
| **Sheet z-index must exceed ClockGate** | High | `ClockGate` uses `zIndex:200` (full-screen fixed overlay). The `Sheet` component backdrop must be `zIndex:300` or higher or sheets will render invisibly behind ClockGate. Currently set to 300. |
| **CSP eval warnings** | Low | Babel Standalone triggers browser CSP eval warnings. These are informational only — GitHub Pages sends no CSP headers, nothing is blocked. |
| **Speech recognition lag** | High | `expo-speech-recognition` has an ~8-second processing lag. Threading issue, not yet resolved. (Expo app only — not relevant to claudia.html.) |
| **backendUrl hardcoded to LAN IP** | Medium | `app.json` extra.backendUrl is `http://10.0.0.120:3001`. (Expo app only.) |
| **No migration files committed** | Medium | Schema exists only in the Supabase dashboard. If the project is rebuilt from scratch, schema must be manually recreated. |
| **Expo SDK version mismatch in AGENTS.md** | Medium | SDK 54 is installed. AGENTS.md references v56 docs — verify with `cat package.json \| grep expo` before coding against Expo APIs. |
| **Backend code not in repo** | Medium | The Node.js server (port 3001, `/api/voice`, `/api/ocr`) is not committed. (Expo app only.) |

---

## Key Architecture Decisions (claudia.html)

- **Single-file deployment:** The entire app lives in `claudia.html` — no build step, no bundler, no node_modules needed. Babel Standalone transpiles JSX in the browser at page load.
- **Voice-first:** Mic button → browser SpeechRecognition API → `CLAUDE_PROXY` edge function → Claude → structured intent JSON → job create/update.
- **OCR flow:** Photo → base64 → `CLAUDE_PROXY` → Claude → structured equipment data → written to `jobs` row (denormalized) and optionally to `equipment` table.
- **Multi-property customers:** No separate sites table. `deriveCustomers(jobs)` groups jobs by customer name and collects distinct `site_address` values client-side — a customer's site list is their job history. Each site can optionally carry a `site_name` (r185) — a business name or unit # distinct from the street address (e.g. a landlord's pizza shop vs. bar vs. their own house). Wherever a site name is set, it displays **prominently** (bold, primary line) with the street address shown smaller underneath — job tiles, `JobDetail`, the "SAVED SITES FOR THIS CUSTOMER" picker, and the `ClockInSheet`/`MoveJobSheet` job pickers all follow this convention; the clock status bar (Browse/dashboard and JobDetail copies), the dashboard's recently-viewed chip strip (r186), and `ChoresView`'s job-link `<select>` options and linked-job badge (r188) also show `site_name` over `customer` when set, same fallback chain. Maps navigation always targets the plain `siteAddr(job)` string, never the name, so geocoding stays reliable.
- **`fromRow` carries `created_at` (r188):** raw ISO string, sort-only (not zoned/formatted for display). Added so `ChoresView`'s "link to a job" pickers sort newest-created job first, instead of the global `jobs` array's default order (`scheduled_at` ascending, from `fetchJobs`).
- **Status update closes detail:** Updating a job's status from the detail screen always navigates back to the dashboard.
- **Job notes sourcing:** Auto-generated notes (status changes, job creation) use `source='system'`; voice-created notes use `source='voice'`; typed daily-log entries use `source='text'`; imported history uses `source='user'`.
- **Deposits (r226):** One deposit per job, not a list like Receipts — `jobs.deposit_amount`/`deposit_method`/`deposit_check_number`, written ONLY via App-level `updateJobDeposit(id, fields)` (guarded for `PGRST204`, mirroring `updateJobMaterials`) — deliberately NOT in `toRow`. `JobDetail` shows a DEPOSIT panel directly under JOB VALUE (`!isShop`, gated by `isClosed` same as every other editable field there): tap to expand an inline CASH/CHECK toggle + amount + (when CHECK) check-number form, SAVE/REMOVE/CANCEL. `jobBalance(j)` (next to `money()`) is `Math.max(0, value - deposit_amount)` and is the figure used everywhere "outstanding" money is summed — the dashboard header total and `BalancesScreen`'s four status buckets — instead of raw `job.value`. `BalancesScreen`'s COLLECTED section, `JobRow`'s default display, `JobCard` dashboard tiles, and `CloseJobSheet` all intentionally keep showing/summing raw `job.value` — deposits only affect the *outstanding* figures, not money already fully collected or labor/parts summaries at close-out.
- **Materials needed (r169):** `jobs.materials_needed` (jsonb, array of `{text, acquired}`). Written ONLY via App-level `updateJobMaterials(id, materials)` (guarded for `PGRST204`) — deliberately NOT in `toRow`, so a missing column never breaks job inserts/edits. `fromRow` reads it (absent → `[]`). JobDetail has a MATERIALS NEEDED section (add/toggle/remove); a shop-wide **MATERIALS** menu screen (`showMaterials` early-return, `MaterialsScreen`) aggregates every job's unacquired items grouped by job — checking acquired there drops it from the list but it stays on the job. The MATERIALS screen also has an add-item input (r176) whose items attach to the **TMC SHOP** sentinel job's `materials_needed`.
- **Per-job log/record (r167):** The non-system `job_notes` stream is the job's running log, shown in JobDetail under a heading set by job type via `logTitleForType()` — Estimate→NOTES, Service Call/Warranty→SERVICE RECORD, Maintenance→MAINTENANCE RECORD, New Install/Replacement→DAILY LOG. A "What did you do today?" box (`addLogEntry`) and voice `add_note` both merge into **one shared entry per job per app-TZ day** (no author): they look up an existing `source in ('text','voice')` note within the Philly-day window (`zonedWallToISO(todayLocalISO(),'00:00')` ≤ created_at < next day) and append with `\n`, else insert `source='text'`. Entries render newest-day-first; edit/delete via the existing `editingNote`/`saveNoteEdit`/`deleteNote`.
- **Chore ordering + voice reminders (r181, dashboard strip added r182):** `sortChoresForUser(list, userId)` is the single sort applied everywhere open chores are listed — the ⚑ CHORES screen, the post-clock-in gate, and the dashboard's collapsible chores strip: your voice reminders (`kind==='reminder' && assigned_to===userId`) → your other assigned chores → unassigned → everyone else's (shown last, never hidden). `kind` reads the existing `chores.priority` free-text column (already used for `'billing'`) — `'reminder'` is a new convention value, no schema change. Voice: saying "remind me/myself to…" (regex on the raw transcript, not the LLM's paraphrase) auto-assigns the chore to the speaker and tags it `kind:'reminder'`; naming someone else ("remind Brett to…") still assigns to them normally, not tagged as a reminder. `addChore`/`deleteChore` are App-level functions (matching `toggleChore`/`editChore`) shared by all `ChoresView` call sites — don't reintroduce inline closures at a new call site. The dashboard strip (r182) also shows the same `🔔 REMINDER`/`👤 name` badges as `ChoreRow`, and its ✎ button deep-links into `ChoresView` via `initialEditId` (App state `choresEditTarget`) — `ChoresView` calls `startEdit` for that chore on mount. Editing has never required a `job_id`; the gap was purely that the dashboard strip had no edit affordance at all.
- **Post-clock-in chores gate (r181, extended r182 to Browse):** `showChoresGate` App state — `clockIn()` sets it when `chores.some(c => !c.done)` (skipped if there are zero open chores); the `ClockGate` `onBrowse` handler now sets it the same way when entering Browse mode. Rendered as an early-return alongside `showHours`/`showMaterials`, reusing `ChoresView` itself (optional `title`/`ctaLabel` props add a header title override and a sticky bottom CONTINUE button) rather than a second chores UI. `clockIn()` still sets `selectedId` as before, so dismissing the gate lands on the job just clocked into; from Browse there's no job, so dismissing falls through to the normal dashboard. `moveToInRoute`/`flipToOnSite` (mid-shift transitions) do not trigger it.
- **Chore→job navigation is a plain `setSelectedId` (r182):** Every "open this chore's linked job" action (dashboard strip, both `ChoresView` call sites) now just calls `setSelectedId(jobId)`, landing at the top of that job's detail — same as every other job-open action in the app. Previously they called a since-removed `openJobPhotos(jobId)` helper that also set a `focusPhotos` flag, which scrolled `JobDetail` down to the Photos section instead. That helper had no other use anywhere (not tied to any notification flow) — it was simply the wrong function reused for chores, so it was deleted along with its `focusPhotos` state/prop and the `photoRef` scroll-target it drove, rather than left as dead code. Don't reintroduce a "jump to photos" side effect on chore navigation.
- **No auth:** All operations use the public anon key. RLS policies on the database side control access.
- **Dark olive theme:** CSS variables in `<style>` block — `--bg`, `--panel`, `--line`, `--olive-bright`, `--text`, `--muted`, `--danger`. Do not introduce off-palette colors without updating that block.
- **Hours report:** `showHours` App state (boolean) triggers an early-return that renders `HoursReport` instead of the dashboard. `HoursReport` fetches `job_notes` with `source='system'` for a week range, then uses `buildCrewTimeline` to compute per-tech, per-job, and per-day time totals (`byUser`/`byJob`/`byDay`, r192) — three parallel accumulators built off the same per-job period loop, each keyed differently (day key via `dateISOInTZ(new Date(p.start), getAppTZ())`, matching every other app-TZ day-bucketing). Data source is the existing system notes (e.g. `Status → In Route (Name)`) — no schema changes needed. Week is Monday-based; `weekOffset` (0 = current week, -1 = last week, etc.) drives navigation. The BY DAY tab sorts chronologically (not by hours, unlike the other two tabs) since day order is what's useful there. Expanding a day (r193) shows both a BY TECH and a BY JOB sub-breakdown (`byDay[dayKey].users` and `.jobs`, same shape as the top-level `byUser`/`byJob` entries) — lets Jack spot which specific job's log is inflating a day's total, then go fix it via that job's Time Log editor (r190/r191). `IMPLAUSIBLE_DAY_MS` (r194, 16h) flags any day total or BY TECH/BY JOB sub-row within the BY DAY tab that exceeds it — ⚠️ icon + `--danger` color via `SubBreakdown`'s new `flagged` prop — as a visual tell for the dangling-session bug (a never-closed period can inflate a single day to an impossible total). Display-only; doesn't affect the weekly BY TECH/BY JOB tabs' own totals, and doesn't touch the underlying data — Jack still has to go fix the flagged job's Time Log entry himself. **The day-level flag must never compare against `data.totalMs` directly (r210 fix)** — that's the SUM across every tech that day, and two or three people each having an ordinary day easily passes 16h combined with nothing wrong. `dayImplausible(data)` (defined next to `IMPLAUSIBLE_DAY_MS`) is the one correct check: `data.dangling` OR **any single person's** day total (`Object.values(data.users).some(u => u.dangling || u.totalMs > IMPLAUSIBLE_DAY_MS)`) — the BY TECH/BY JOB sub-row flags were already correctly per-person/per-job and are unchanged. Clicking a job row in the BY DAY tab's BY JOB sub-breakdown (r198) now deep-links straight there: App state `focusTimeLog` (`{ jobId, date, nonce } | null`, `nonce` so the same job/day can be re-clicked and still re-trigger) is set alongside `setSelectedId(jobId)`, and `JobDetail` consumes it in a `useEffect` keyed on `[focusTimeLog]` — sets `crewLogDate` to the clicked day, force-opens the TIME LOG section via `setTimeLogOpen(true)`, and scrolls a `timeLogRef` into view. Only reachable via `showHours`, which fully unmounts/remounts `JobDetail` on the way in, so there's no stale-prop risk from `JobDetail` not having a `key` on `job.id`. Row expansion is multi-select (r200): `expandedKeys` is a `Set`, not a single value — `toggleExpanded(key)` adds/removes from it, so opening one tech/job/day row no longer collapses whichever other row was already open, letting Jack compare two rows side by side. Reset to an empty `Set` on tab switch and on week change (same spots that used to reset the old single `expandedKey` to `null`). **BY TECH's per-job sub-rows are also clickable now (r210):** `onOpenJob(jobId)` (distinct from `onOpenJobDay(jobId, dayKey)` — this breakdown is a weekly total, not tied to one day, so there's no date to force the Time Log open to) closes Hours and opens the job. Before r210 these were plain `<div>`s with no handler — dead end, notably including the one tap path a Jack would reach for after seeing a ⚠ dangling flag on that tab. BY JOB's user sub-rows and BY DAY's BY TECH sub-rows stay non-clickable on purpose (people, not jobs — no job to open). **BY DAY's BY TECH rows show actual per-period timestamps now (r224):** each person's row in `byDay[dayKey].users[name]` gained a `periods: []` array — pushed alongside the existing `driveMs`/`onSiteMs`/`runMs` `+=` accumulation in the same aggregation loop (the raw period was already in scope there, just previously discarded after being summed) — each entry tagged with `jobLabel` (the same shop-billing-aware label already used for `byDay[dayKey].jobs`) since one tech's day can span multiple jobs. Rendered sorted chronologically under each BY TECH row using the exact same line format as `JobDetail`'s own Time Log (`fmtTimestamp`/`fmtElapsed`, `⚠️ NO CLOCK-OUT` for dangling, `— billed to shop/this job`) so the two views read identically. Deliberately BY TECH only — `byDay[dayKey].jobs` (the BY JOB sub-breakdown) was NOT given a `periods` array, so a new consumer wanting per-timestamp detail under BY JOB would need to add that separately.
- **Balances breakdown (r201):** `showBalances` App state triggers an early-return that renders `BalancesScreen`, opened either by tapping the dashboard header's OUTSTANDING figure directly or via the hamburger menu's BALANCES entry. Splits the same `outstanding` total (`isActive = s => s !== "Completed/Paid" && s !== "Closed"`, `claudia.html` App component) into four client-side buckets by status — `Waiting on Approval`, `Completed/Needs Billing`, `Billed/Waiting for Payment`, and a catch-all `SCHEDULED / ACTIVE WORK` for every other active status — computed straight off the in-memory `jobs` array, no query needed. These four always sum to exactly the header's OUTSTANDING number by construction (same `isActive` filter, mutually exclusive categorization). Each category expands (same multi-select `expandedKeys` Set pattern as `HoursReport`) to list its jobs sorted by value, tap → `onOpenJob(id)` closes the screen and opens that job. A separate COLLECTED section (money already received — explicitly *not* part of outstanding) has its own FROM/TO date inputs (default: first-of-month → today, app-TZ) and queries `job_notes` for `source='system'` rows in that range, filtering client-side via `parseCrewLogEntry` for `status === 'Completed/Paid'`, deduped by `job_id` (a job could flicker through the status more than once) — sums each matched job's *current* `value`, not a historical snapshot at the time it was marked paid, since no `job_status_history` table or value-history exists.
- **Calendar View (r218):** `showCalendar` App state triggers an early-return (right after `showMaterials`, before `showChoresGate`) that renders `CalendarView` — Agenda/Month/Week toggle for scheduled jobs, opened via the hamburger's CALENDAR entry or the dashboard's UPCOMING chip strip's "VIEW ALL" chip. `getCalendarJobs(jobs)` (`CALENDAR_STATUSES = ['In Progress','Scheduled','Ready to Schedule']` filtered to `has_schedule` truthy) is the single shared scope helper — used by both `CalendarView` and the dashboard widget so they never drift. `viewMode` persists to `localStorage` (`tmc_calendar_view_mode`, default `'agenda'`); the current period (`periodAnchor`) always resets to today on mount, never persisted — same pattern as `HoursReport`'s `weekOffset`. Month/Week grids are built by `buildMonthGrid`/`buildWeekDates` (next to `shiftDateISO`) — these only ever walk already-resolved `'YYYY-MM-DD'` day keys via local Date arithmetic, never re-derive a day from a raw instant (that stays `dateISOInTZ`'s job, done once in `fromRow`). Chips in Month/Week are draggable via Pointer Events (`CalendarChip`, not HTML5 `draggable` — that barely supports touch) to reschedule a job onto a different day; dropping shows a plain `confirm()` (matching the rest of the file's existing confirm-dialog convention, no custom floating popover) and calls the shared `onReschedule` prop, wired at the App level straight to the existing `updateJob(id, patch)` — no new persistence path. Dragging only ever changes the date, never the time-of-day. The day-detail Sheet (`expandedDay`, opened by "+N more" or a bare day tap) is scoped entirely inside `CalendarView` and is **not** a cross-cutting Sheet — `CalendarView` is only reachable from its own single early return, so it's deliberately not added to the Sheet Placement Rule table above.
- **`Lightbox` is photo-aware, not just a bare-URL viewer (r202):** takes a `photo` object (`{ url, id?, photo_type?, ocr_data?, kind? }`) instead of a plain URL string — one shared component opened from three places in `JobDetail` (general photo gallery, receipts list, an equipment card's "view source photo" link), each passing different context. The `🔍 SCAN FOR EQUIPMENT` button only shows when `photo.kind !== 'receipt'`, `photo.kind !== 'scanned'`, `photo.photo_type !== 'equipment'`, and `!photo.ocr_data` — i.e. never for receipts (already auto-OCR'd on capture via `handleReceiptFile`/`handleJobReceiptFile`, so always "already scanned" by the time they're viewable), never for an equipment card's own source photo (`kind:'scanned'` — redundant, the equipment record already exists), never for photos uploaded through the dedicated nameplate-scan camera (`_launchScan`/`runScan`, tagged `photo_type:'equipment'` and auto-scanned in the background already), and never for a photo that's already been manually scanned once via this same button. `doScan` fires a new `onScanned(photo.id, result)` callback the instant a scan attempt finishes — regardless of whether the user then taps IMPORT TO JOB or DISMISS — which `JobDetail` uses to persist the result via `updatePhotoOcrData` and update local `photos` state, so the button stays gone on future opens of that same photo. The pre-existing `onScanResult` callback is unrelated and still only fires on IMPORT TO JOB, to apply the data to the job/equipment record.
- **Clock session shape:** `clockSession` (localStorage per user) = `{ jobId, status, startedAt, legStartedAt }`. `startedAt` = original clock-in anchor for the whole shift; `legStartedAt` (r162) = start of the **current leg** (this job/visit). A "leg" is one continuous stretch of presence that ends when you **leave** (move to another job, or clock out). In Route → On Site on the *same* job is the *same* leg — `flipToOnSite` must NOT reset `legStartedAt`.
- **Daily time accounting (leg-banking):** `addTodayMs(userId, ms)` accumulates completed legs into a per-day localStorage bucket (`getTodayMs` returns 0 once its stored `date !== todayISO()`, so it self-resets at midnight; both have a 16h sanity cap). The live `ClockTimer` shows `getTodayMs() + (now - legStartedAt)` = **total worked today**. **Invariant:** every transition that ends a leg must call `addTodayMs` for the finished leg *before* resetting `legStartedAt`, or that time silently vanishes from the daily total. Current bank points: `moveToInRoute` (banks old leg, r162) and `clockOut`. The shop-activity note elapsed is computed from `legStartedAt` so it reflects the shop visit, not the whole shift.
- **Pause/resume (r208), paid Materials/Shop Run pauses (r209):** `'Paused'` is a third `job_crew.status` value (alongside In Route/On Site) and a third `clockSession.status`. Pausing (⏸ PAUSE in both clock-bar copies, shown only when On Site; reason picked in `PauseSheet`) goes through the normal `fieldTimeConfirm` rewind (`type:'pause'`/`'resume'`, all 3 sheet copies). Module-level consts (~line 306) govern all of this: `PAUSE_STATUS_MAP` maps the two **paid** reasons — `'getting materials'`/`'shop run'` — to their own `job_crew.status` values, `'Materials Run'`/`'Shop Run'`; every other reason (lunch, washy washy, typed Other) maps to plain `'Paused'`. `CREW_FIELD_STATUSES` includes `'Materials Run'`/`'Shop Run'` (real, counted periods) but deliberately excludes `'Paused'` (closes the period, contributes zero — the whole point of a real break). `ON_BREAK_STATUSES = ['Paused','Materials Run','Shop Run']` is the "any kind of break" set used everywhere the UI shows RESUME / hides ON SITE + PAUSE — **do not** narrow these checks back to the literal `'Paused'` string, or Materials/Shop Run pauses lose their RESUME button. Two things stay narrowly `=== 'Paused'` on purpose: `ClockTimer`'s `paused` prop (only plain Paused freezes the timer — Materials/Shop Run keep ticking, they're paid) and the `addTodayMs` banking-skip in `clockOut`/`moveToInRoute`/`resumeClock` (only plain Paused skips banking — its leg was never banked to begin with; Materials/Shop Run legs bank normally like any other transition, since that time counts).
  Paid reasons get a **second PauseSheet step** — "BILL THIS TIME TO: 🔧 THIS JOB / 🏬 THE SHOP" — before the CONFIRM TIME rewind; the choice rides along as `billTo:'job'|'shop'` on `fieldTimeConfirm` and `clockSession`, and gets baked into the pause note as a suffix tag: `Status → Materials Run (Name) — getting materials · bill:shop`. **Deliberately no job-hop**: the crew row and session stay on the origin job throughout — pausing does NOT call `moveToInRoute` or touch `assigned_to`, so nothing can dangle across two jobs if someone forgets to resume. `billTo` only steers *reporting*: `parseCrewLogEntry` extracts it from the note (regex on `· bill:(job|shop)`, `null` for every other status) and `buildCrewTimeline` copies it onto the period. In `HoursReport`'s aggregation, a period with `billTo:'shop'` is bucketed under the shop job's id/label (`jobs.find(j => j.customer?.toUpperCase() === TMC_SHOP_NAME && j.status !== 'Closed')`) instead of the origin job's, in `byJob`/`byUser[name].jobs`/`byDay.jobs` — `byUser`/`byDay.users` totals (payroll) are untouched, worked time counts for the person regardless of who pays for it. `CloseJobSheet`'s per-job labor summary goes further and **excludes** `billTo:'shop'` periods from that job entirely (it only ever queries one job's notes, so it can't credit them to the shop job's own numbers) — shown instead as a small "+Xh billed to shop — see Hours Report" note. `JobDetail`'s Time Log (the raw per-job chronological view) **always** shows the period in place regardless of `billTo` — it's an audit trail, not a cost report — labeled `— billed to shop`/`— billed to this job`. Both `HoursReport` and `CloseJobSheet` need a third `runMs` bucket alongside the existing `driveMs`/`onSiteMs` (dangling-period object literals must initialize all three or a later non-dangling period on the same key will `NaN` on `undefined += ms`).
  Crew-check prompts (`stillOnSite`) filter `=== 'On Site'` so anyone on a break (paid or not) is never auto-marked In Route by someone leaving. `staleClock` App state `{ session, sinceDate }` shows `StaleClockSheet`. As of r175 it is set by `reconcileClockFromCrew` (mount/switch + 60s + focus), which judges staleness by the user's `job_crew` row `status_at` (NOT the local `startedAt`, which is preserved across job moves and drifts). If there's no active crew row the local session is cleared silently (clocked out elsewhere) — no prompt. `clockOutStale(atISO)` closes the session and writes the `Status → Cleared` note at the chosen time (for HoursReport accuracy) but does **not** touch `addTodayMs` (that bucket is today's; the prior day's hours live in `job_notes`). `keepStaleClock()` re-anchors `startedAt`/`legStartedAt` to now so the day starts clean and the prompt won't re-fire.
