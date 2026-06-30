@AGENTS.md

# CRITICAL — Read Before Writing Any Code

## Commit & Deploy Rules (non-negotiable)

1. **ALWAYS push to `main`** — Jack keeps a numbered r-commit history on main for rollback. Never leave work only on a feature branch. Use `git push origin HEAD:main` or push directly to main.
2. **ALWAYS bump `APP_REV`** on every single commit — it's `const APP_REV = NNN;` near the top of `claudia.html` (currently **170**). This is the visible version badge on the dashboard. Forgetting it means Jack sees a stale revision number and thinks deploys aren't working.
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
| ClockGate | `!clockSession && !browseMode` | ✓ (r148) | — |
| showClockIn | `showClockIn` (early return) | — | — |
| JobDetail (selected) | `selected` | ✓ | ✓ |
| Browse/dashboard | default | ✓ | ✓ |

When adding a new App-level Sheet, check all four paths. `StaleClockSheet` (r162) is rendered in the **JobDetail (selected)** and **Browse/dashboard** paths only — it can only appear when `clockSession` is truthy (a session left open from a prior day), which by definition excludes the ClockGate path.

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
| **Bump APP_REV every commit** | Critical | `const APP_REV = NNN;` near top of claudia.html. Currently **170**. Forgetting this makes Jack think the deploy failed — he sees the old revision number on the dashboard. Increment by 1 every commit, no exceptions. |
| **Receipt photo OCRs + pre-fills, never auto-saves** | Medium | r170: the receipt camera (`handleJobReceiptFile`/`handleReceiptFile`, two copies — JobDetail + `CloseJobSheet`) uploads to `job-photos`, runs `scanReceiptFromB64` (Claude proxy → `{vendor,amount,date}`), and **pre-fills** the vendor/amount fields + stashes `rPhotoPath` — it does NOT auto-save. Saving is the explicit SAVE tap. The old auto-save-behind-a-`!rAmount&&!rVendor`-guard stranded `rSaving=true` (the "stuck on saving" bug). Save guard now allows photo-only and always resets `rSaving`. |
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
- **Multi-property customers:** No separate sites table. `deriveCustomers(jobs)` groups jobs by customer name and collects distinct `site_address` values client-side — a customer's site list is their job history.
- **Status update closes detail:** Updating a job's status from the detail screen always navigates back to the dashboard.
- **Job notes sourcing:** Auto-generated notes (status changes, job creation) use `source='system'`; voice-created notes use `source='voice'`; typed daily-log entries use `source='text'`; imported history uses `source='user'`.
- **Materials needed (r169):** `jobs.materials_needed` (jsonb, array of `{text, acquired}`). Written ONLY via App-level `updateJobMaterials(id, materials)` (guarded for `PGRST204`) — deliberately NOT in `toRow`, so a missing column never breaks job inserts/edits. `fromRow` reads it (absent → `[]`). JobDetail has a MATERIALS NEEDED section (add/toggle/remove); a shop-wide **MATERIALS** menu screen (`showMaterials` early-return, `MaterialsScreen`) aggregates every job's unacquired items grouped by job — checking acquired there drops it from the list but it stays on the job.
- **Per-job log/record (r167):** The non-system `job_notes` stream is the job's running log, shown in JobDetail under a heading set by job type via `logTitleForType()` — Estimate→NOTES, Service Call/Warranty→SERVICE RECORD, Maintenance→MAINTENANCE RECORD, New Install/Replacement→DAILY LOG. A "What did you do today?" box (`addLogEntry`) and voice `add_note` both merge into **one shared entry per job per app-TZ day** (no author): they look up an existing `source in ('text','voice')` note within the Philly-day window (`zonedWallToISO(todayLocalISO(),'00:00')` ≤ created_at < next day) and append with `\n`, else insert `source='text'`. Entries render newest-day-first; edit/delete via the existing `editingNote`/`saveNoteEdit`/`deleteNote`.
- **No auth:** All operations use the public anon key. RLS policies on the database side control access.
- **Dark olive theme:** CSS variables in `<style>` block — `--bg`, `--panel`, `--line`, `--olive-bright`, `--text`, `--muted`, `--danger`. Do not introduce off-palette colors without updating that block.
- **Hours report:** `showHours` App state (boolean) triggers an early-return that renders `HoursReport` instead of the dashboard. `HoursReport` fetches `job_notes` with `source='system'` for a week range, then uses `buildCrewTimeline` to compute per-tech and per-job time totals. Data source is the existing system notes (e.g. `Status → In Route (Name)`) — no schema changes needed. Week is Monday-based; `weekOffset` (0 = current week, -1 = last week, etc.) drives navigation.
- **Clock session shape:** `clockSession` (localStorage per user) = `{ jobId, status, startedAt, legStartedAt }`. `startedAt` = original clock-in anchor for the whole shift; `legStartedAt` (r162) = start of the **current leg** (this job/visit). A "leg" is one continuous stretch of presence that ends when you **leave** (move to another job, or clock out). In Route → On Site on the *same* job is the *same* leg — `flipToOnSite` must NOT reset `legStartedAt`.
- **Daily time accounting (leg-banking):** `addTodayMs(userId, ms)` accumulates completed legs into a per-day localStorage bucket (`getTodayMs` returns 0 once its stored `date !== todayISO()`, so it self-resets at midnight; both have a 16h sanity cap). The live `ClockTimer` shows `getTodayMs() + (now - legStartedAt)` = **total worked today**. **Invariant:** every transition that ends a leg must call `addTodayMs` for the finished leg *before* resetting `legStartedAt`, or that time silently vanishes from the daily total. Current bank points: `moveToInRoute` (banks old leg, r162) and `clockOut`. The shop-activity note elapsed is computed from `legStartedAt` so it reflects the shop visit, not the whole shift.
- **Stale prior-day session (r162):** `staleClock` App state `{ session, sinceDate }`. A `useEffect` keyed on `currentUser?.id` (mount / user switch) flags a `clockSession` whose `startedAt` date `!== todayISO()` and shows `StaleClockSheet`. `clockOutStale(atISO)` closes the session and writes the `Status → Cleared` note at the chosen time (for HoursReport accuracy) but does **not** touch `addTodayMs` (that bucket is today's; the prior day's hours live in `job_notes`). `keepStaleClock()` re-anchors `startedAt`/`legStartedAt` to now so the day starts clean and the prompt won't re-fire.
