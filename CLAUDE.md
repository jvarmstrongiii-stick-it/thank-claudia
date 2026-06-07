@AGENTS.md

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

Schema is inferred from `lib/queries.ts`, `lib/types.ts`, Supabase dashboard screenshots, and `PROJECT_SPEC.md`. No migration files are committed — Supabase was configured via the dashboard.

**Full table list:** `chores`, `components`, `customers`, `equipment`, `job_components`, `job_equipment`, `job_notes`, `job_photos`, `job_status_history`, `jobs`, `line_items`, `notifications`, `photos`, `receipts`, `sync_queue`, `users`

### `customers`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | |
| address | text | nullable |
| phone | text | nullable |

### `jobs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| customer_id | uuid FK → customers | |
| job_type | text | enum: `Service Call`, `New Install`, `Maintenance`, `Estimate`, `Emergency`, `Custom` |
| status | text | 13-value enum — see `lib/types.ts` and `lib/status.ts` |
| scheduled_time | timestamptz | nullable |
| address | text | nullable — job-site address, may differ from customer address |
| value | numeric | nullable — job revenue |
| original_ask | text | nullable — what the customer originally asked for, captured separately from notes |
| notes | text | nullable — additional comments/notes, distinct from original_ask |
| priority | int4 | sort order |
| assigned_to | text | nullable — free-text technician name, not validated against users table |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Job status values** (from `lib/types.ts` — use these exact strings):

| Status | Display label | Color |
|--------|--------------|-------|
| `Estimate Scheduled` | NEXT UP | #8fba3c (accent green) |
| `Estimate Given` | NEXT UP | #8fba3c |
| `Approved` | NEXT UP | #8fba3c |
| `Parts Ordered` | STANDING BY | #2a2b22 (border) |
| `Scheduled` | NEXT UP | #8fba3c |
| `In Route` | IN FIELD | #e8a020 (orange) |
| `In Progress` | IN FIELD | #c8b97a (gold) |
| `Complete` | COMPLETE | #2a2b22 |
| `Needs Billing` | STANDING BY | #2a2b22 |
| `Invoiced` | STANDING BY | #2a2b22 |
| `Paid` | COMPLETE | #2a2b22 |
| `On Hold` | ON HOLD | #555 |
| `Cancelled` | ON HOLD | #555 |

**Valid statuses by job type** (from `lib/status.ts`):
- **Estimate:** `Estimate Scheduled`, `Estimate Given`, `Approved`, `On Hold`, `Cancelled`
- **New Install:** all 13 statuses
- **Service Call, Maintenance, Emergency, Custom:** `Scheduled`, `In Route`, `In Progress`, `Complete`, `Needs Billing`, `Invoiced`, `Paid`, `On Hold`, `Cancelled`

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
| created_at | timestamptz | |
| *(schema needs verification)* | | |

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
Status filter tabs: ALL + all 13 individual statuses. `CLOSED_STATUSES` (`Complete`, `Paid`, `Cancelled`) are hidden from the default ALL view. Dashboard-level display labels override status labels (e.g., `In Progress` tab shows as "ON SITE").

### `app/job/[id].tsx` (Job Detail)
- Status modal: shows only `statusesForJobType(job.job_type)` as options
- Reschedule modal: Android uses native date/time pickers; iOS/web uses text inputs
- Address chip: tappable — iOS opens `maps://`, other platforms open Google Maps URL
- Phone chip: tappable → `tel:` link
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

### Active target: browser (HTML/web)
The EAS native build was paused mid-build. **The current working deployment is the HTML browser version**, which is fully functional. React Native Web handles rendering; Expo Router's web output is what's in active use.

When making changes, prioritize web compatibility. Test in the browser. Native-only APIs (e.g. `expo-speech-recognition`, native camera dialogs) will not work in the web build — see Gotchas below.

### Build config notes
- **`babel.config.js`:** Uses `babel-preset-expo` with a custom plugin that polyfills `import.meta` to `{}` for web compatibility.
- **`metro.config.js`:** Stubs native-only modules for web (e.g., speech recognition).
- **`tsconfig.json`:** Extends `expo/tsconfig.base`, strict mode enabled.

### EAS build profiles (`eas.json`) — paused
| Profile | Distribution | Notes |
|---------|-------------|-------|
| development | internal | Dev client enabled, for Expo Go replacement |
| preview | internal | Pre-production testing |
| production | store | Auto-increment version |

EAS mobile builds are on hold. Do not assume a native build is current or runnable.

### CI/CD
- **No automated CI/CD.** No GitHub Actions workflows exist.
- EAS builds are triggered manually when resumed: `eas build --platform android --profile development`
- OTA updates via `eas update` for field testing without a full build.

### Known deploy lag (web)
The live web build can be **behind the working repo revision** if the web output has not been rebuilt and redeployed after recent commits. If behavior on the deployed site differs from the source, rebuild and redeploy before diagnosing.

---

## Recurring Gotchas

| Issue | Severity | Detail |
|-------|---------|--------|
| **Speech recognition lag** | High | `expo-speech-recognition` has an ~8-second processing lag. Threading issue, not yet resolved. Voice intake feels slow. |
| **Voice input on web uses browser SpeechRecognition** | Low | `expo-speech-recognition` is native-only. On web, VoiceBar uses the browser's `SpeechRecognition` API (`WEB_SPEECH` flag, `VoiceBar.tsx`). Chrome and Edge support this; Firefox and Safari fall back to a text input field. |
| **Network flakiness on cellular** | Medium | Backend API calls fail intermittently when device is on mobile data in tunnel mode. Stable on WiFi. |
| **backendUrl hardcoded to LAN IP** | Medium | `app.json` extra.backendUrl is `http://10.0.0.120:3001`. Must be updated for any device not on the same LAN, or replaced with a public URL for production. |
| **No migration files committed** | Medium | Schema exists only in the Supabase dashboard. If the project is rebuilt from scratch, schema must be manually recreated from the types/queries. |
| **No .env.example** | Low | New contributors won't know what env vars are needed. |
| **iOS not yet built** | Low | Android was built first. No iOS EAS build has been run. |
| **Expo SDK version mismatch in AGENTS.md** | Critical | **SDK 54 is installed. AGENTS.md says to read v56 docs — always verify with `cat package.json \| grep expo` before coding. Use v54 behavior, not v56.** |
| **Backend code not in repo** | Medium | The Node.js server (port 3001, `/api/voice`, `/api/ocr`) is not committed. No server code is present in this repository. |
| **No `App.tsx` usage** | Low | `App.tsx` exists at root but is not used — Expo Router takes over via `index.ts` → `registerRootComponent`. |

---

## Key Architecture Decisions

- **Voice-first:** VoiceBar floats over every screen; speech → `/api/voice` → Claude → structured JSON → ConfirmJobModal → Supabase.
- **OCR flow:** Photo → base64 → `/api/ocr` → Claude → structured JSON → OCRResultCard (editable) → upsert.
- **Equipment deduplication:** Upserted by `(customer_id, serial)` — same serial on same customer overwrites, preventing duplicates.
- **Status machine:** Job type gates which statuses are available, hardcoded in `lib/status.ts` via `statusesForJobType()`. Do not allow invalid status transitions.
- **Platform scaling:** Web renders at 1.4× font scale, native at 1.3×, via `fs()` in `lib/platform.ts`. Always use `fs()` — never hardcode font sizes.
- **Realtime:** Supabase Realtime is available but not wired to live-push updates. Dashboard uses pull-to-refresh and refetch-on-focus only.
- **No auth:** All operations use the public anon key. RLS policies on the database side control access, not application-level auth.
- **Dark olive theme:** Not a generic blue SaaS palette. Colors are defined in `lib/platform.ts`. Do not introduce off-palette colors without updating that file.
