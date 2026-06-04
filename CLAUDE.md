@AGENTS.md

# thank-claudia — Session Context

**thank-claudia** is a voice-first HVAC field service management app (React Native/Expo) for TMC Mechanical in Philadelphia. Techs use it to log jobs, track status, scan equipment, and take photos from the field.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile/Web UI | React Native 0.81.5, React 19.1.0, React Native Web 0.21.0 |
| Framework | Expo SDK 54.0.9, Expo Router v6.0.22 (file-based routing) |
| Language | TypeScript 5.9.2 |
| Database | Supabase (PostgreSQL + Storage + Realtime) |
| AI | Claude API (`claude-sonnet-4-20250514`) via Node.js backend |
| Backend | Node.js on port 3001 — handles `/api/voice` and `/api/ocr` |
| Builds | EAS (Expo Application Services), project ID `aba42329-1d35-4f9e-8b56-03f5654b0859`, owner `jacksteriii` |
| Fonts | Russo One (headers), Barlow 400/600 (body), Share Tech Mono (data) |

**Key libraries:** expo-camera, expo-image-picker, expo-speech-recognition, react-native-gesture-handler 2.28, reanimated 4.1.1, react-native-datetimepicker 8.4.4.

---

## Database Schema

Schema is inferred from `lib/queries.ts`, `lib/types.ts`, and `PROJECT_SPEC.md`. No migration files are committed — Supabase was configured via the dashboard.

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
| status | text | 12-value enum — see `lib/status.ts` |
| scheduled_time | timestamptz | nullable |
| address | text | nullable — job-site address, may differ from customer address |
| value | numeric | nullable — job revenue |
| notes | text | nullable |
| priority | int4 | sort order |
| assigned_to | text | nullable — free-text technician name, not validated |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Job status values** (from `lib/status.ts`): `Scheduled`, `In Progress`, `Complete`, `Invoiced`, `Paid`, `Parts Ordered`, `Equipment Ordered`, `On Hold`, `Cancelled`, `No Show`, `Estimate Sent`, `Estimate Approved`. Available statuses depend on `job_type`.

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
| serial | text | nullable — used as upsert key (per customer_id) |
| tonnage | text | nullable |
| refrigerant | text | nullable |
| fuel_type | text | nullable — enum: `gas`, `electric`, `oil`, `other` |
| manufacture_year | int4 | nullable |
| install_date | date | nullable |
| condition | text | nullable — enum: `Good`, `Fair`, `Poor`, `Condemned` |
| notes | text | nullable |
| updated_at | timestamptz | |

### `job_equipment` (junction)
| Column | Type | Notes |
|--------|------|-------|
| job_id | uuid FK → jobs | |
| equipment_id | uuid FK → equipment | |

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
- `assigned_to` on jobs is a free-text string — no validated user table
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
  _layout.tsx          # Root layout: loads fonts, status bar
  index.tsx            # Dashboard — job list with revenue pipeline
  job/[id].tsx         # Job detail view
components/
  JobCard.tsx          # Job list card
  VoiceBar.tsx         # Floating voice input (dev build only)
  ConfirmJobModal.tsx  # Confirm/edit voice-extracted job before saving
  PhotoCapture.tsx     # Camera/gallery picker + Supabase upload
  PhotoStrip.tsx       # Horizontal scrollable photo gallery
  EquipmentCard.tsx    # Equipment details
  OCRResultCard.tsx    # Editable OCR results
lib/
  supabase.ts          # Supabase client init
  types.ts             # TypeScript interfaces (Job, Customer, Equipment, JobPhoto, etc.)
  api.ts               # Backend API calls (voice, OCR)
  queries.ts           # All Supabase queries
  status.ts            # Job status enums, labels, colors, valid transitions
  platform.ts          # Platform-aware scaling and colors
```

---

## Build & Deploy

### Active target: browser (HTML/web)
The EAS native build was paused mid-build. **The current working deployment is the HTML browser version**, which is fully functional. React Native Web handles rendering; Expo Router's web output is what's in active use.

When making changes, prioritize web compatibility. Test in the browser. Native-only APIs (e.g. `expo-speech-recognition`, native camera dialogs) will not work in the web build — see Gotchas below.

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
| **Voice input on web uses browser SpeechRecognition** | Low | `expo-speech-recognition` is native-only. On web, VoiceBar uses the browser's `SpeechRecognition` API (`WEB_SPEECH` flag, `VoiceBar.tsx`). Chrome and Edge support this; Firefox and Safari do not — those browsers fall back to a text input field in the VoiceBar. |
| **Network flakiness on cellular** | Medium | Backend API calls fail intermittently when device is on mobile data in tunnel mode. Stable on WiFi. |
| **backendUrl hardcoded to LAN IP** | Medium | `app.json` extra.backendUrl is `http://10.0.0.120:3001`. Must be updated for any device not on the same LAN, or replaced with a public URL for production. |
| **No migration files committed** | Medium | Schema exists only in the Supabase dashboard. If the project is rebuilt from scratch, schema must be manually recreated from the types/queries. |
| **No .env.example** | Low | New contributors won't know what env vars are needed. |
| **iOS not yet built** | Low | Android was built first. No iOS EAS build has been run. |
| **Expo SDK version** | Critical | **SDK 54 is what's installed. AGENTS.md says to read v56 docs — check which is actually installed before coding. Run `cat package.json | grep expo` to confirm.** |

---

## Key Architecture Decisions

- **Voice-first:** VoiceBar floats over every screen; speech → backend → Claude → structured JSON → ConfirmJobModal → Supabase.
- **OCR flow:** Photo → base64 → backend → Claude → structured JSON → OCRResultCard (editable) → upsert.
- **Equipment deduplication:** Upserted by `(customer_id, serial)` — same serial on same customer overwrites.
- **Status machine:** Job type gates which statuses are available (hardcoded in `lib/status.ts`).
- **Platform scaling:** Web renders at 1.4× font scale, native at 1.3×, handled in `lib/platform.ts`.
- **Realtime:** Supabase Realtime is available but not yet wired to live-push updates. Dashboard uses pull-to-refresh + refetch on focus.
