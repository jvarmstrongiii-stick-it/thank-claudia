# PROJECT_SPEC.md
## TMC Mechanical — Claudia (Field Job Tracker)
**Last Updated:** 2026-06-03  
**Stack:** Single-file HTML/React (CDN + Babel) · Supabase · Claude API (live)  
**Platform:** Mobile browser (Chrome/Safari) — installable as PWA via Add to Home Screen  
**Repo:** jvarmstrongiii-stick-it/thank-claudia · branch: claude/hvac-supabase-integration-Di5df  
**Working file:** claudia.html  
**Live URL:** https://jvarmstrongiii-stick-it.github.io/thank-claudia/

---

## 1. Overview

Voice-first HVAC field service management app for TMC Mechanical (Tyler's company, Philly/Montco/Delco). Field technicians manage their full day from their phone — jobs, equipment, photos, notes, warranty — hands-free when needed. All data is live and shared across all devices in real time.

---

## 2. Users & Access

- No role restrictions at this time — all users see all jobs, all technicians
- Splash screen: tap your name to log in (reads from `users` table, falls back to Tyler/Jack)
- Jobs can be assigned to any user by any user
- Future: role-based permissions (admin vs tech)

---

## 3. Job Types & Status Flows

| Job Type | Status Flow |
|---|---|
| Service Call | New → Scheduled → En Route → On Site → In Progress → On Hold → Completed/Needs Billing → Completed/Paid → Closed |
| New Install | New → Evaluation Needed → Write Estimate → Waiting on Approval → Scheduled → En Route → On Site → In Progress → Completed/Needs Billing → Completed/Paid → Closed |
| Maintenance | New → Scheduled → En Route → On Site → In Progress → Completed/Needs Billing → Completed/Paid → Closed |
| Replacement | Same as New Install |
| Warranty | Same as Service Call |
| Estimate | New → Write Estimate → Waiting on Approval → Closed |

- Billing chore auto-created when job reaches "Completed/Needs Billing"

---

## 4. Dashboard

- Filter bar: All / by status
- Search: customer name, address, phone, notes
- Job cards show: customer, address, job type, status pill, scheduled date/time, job value
- ↺ manual refresh button + 60s auto-refresh + focus refresh
- Revenue outstanding shown in header
- ⚑ CHORES button → full chores management view

---

## 5. Voice System ✅ LIVE

- **🎙 floating mic button** — fixed position overlay on every screen
- Draggable — user repositions it, position persists to localStorage
- Tap → Web Speech API activates (built into Chrome/Safari, no external service)
- Button pulses red while listening, turns amber while Claude parses intent
- Transcript sent to Claude Haiku via `claude-proxy` edge function
- **Supported intents:**
  - `add_job` — "add a service call for Smith" → opens form pre-filled
  - `navigate` — "go to Robert" → opens that job
  - `search` — "show me scheduled jobs" → filters dashboard
  - `update_status` — "mark Smith as on site" → updates immediately
  - `add_note` — "add note to Smith: no dogs" → writes to job_notes

---

## 6. Job Detail View

Full-page view containing:
- Customer name, job type, status pill
- Job value · Scheduled date/time (tappable → reschedule modal)
- Phone number (tappable → dialer)
- Site address (tappable → Google Maps)
- Customer address (if different from site)
- Notes textarea — saves to Supabase on blur
- **Photos strip** — CAMERA (live capture) + GALLERY (from library)
  - Pinch-to-zoom lightbox with pan; ✕ always visible
  - 🔍 SCAN FOR EQUIPMENT button in lightbox → runs OCR on any photo
- **Equipment — THIS JOB** — gear installed/serviced on this job
  - 📷 SCAN (camera) + 🖼 UPLOAD (gallery) → OCR + photo saved to gallery simultaneously
- **Equipment — OTHER AT THIS ADDRESS** — pre-existing gear captured for reference
  - Same scan flow, saves to customer record only (no job association)
- Service history (status change log)
- UPDATE STATUS → sheet showing valid next statuses
- DELETE JOB

---

## 7. Equipment System ✅ LIVE

Equipment is linked to **customers** (not jobs) — appears on every job for that address.

### Per-equipment card shows:
- User-defined label (e.g. "Living Room", "Outdoor Unit", "Furnace")
- Brand · Model # · Serial #
- Warranty status badge (see below)
- Expandable: Type, Year, Tonnage, Refrigerant, Voltage, SEER, MCA, MOP

### OCR scanning:
- Photo of nameplate or box/shipping label → Claude vision extracts all fields
- Claude infers `equipment_type` and `brand` from model number prefix when not printed
  (DR96TC → 96% two-stage gas furnace, GSX → AC condenser, FTX → Mitsubishi mini-split, etc.)
- Scan photo also saved to job photo gallery automatically
- Label prompt with suggestion chips → user assigns a room/location label
- Saves to `equipment` table

### Warranty tracking:
- `install_date` auto-set from job's scheduled date on scan
- 60-day countdown to Daikin enhanced warranty registration deadline
- Badge states: pending (N days left) · urgent (≤14 days, amber) · lapsed · registered ✓
- Tap badge → **WarrantySheet**: pre-filled data block, 📋 COPY ALL to clipboard,
  🌐 opens my.daikincomfort.com/product-registration, ✓ MARK AS REGISTERED

---

## 8. Chores

- Internal tasks separate from jobs (pick up parts, call supplier, etc.)
- Assignable to users, linkable to jobs
- Billing chore auto-created when job hits "Completed/Needs Billing"
- Full chores view via ⚑ CHORES button on dashboard

---

## 9. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single-file HTML · React 18 CDN · Babel standalone (no build step) |
| Backend | Supabase (PostgreSQL + REST API + Storage) |
| Auth | Splash-page user picker → localStorage (anon key, no Supabase Auth) |
| AI / OCR | Claude Haiku via Supabase Edge Function `claude-proxy` (CORS proxy) |
| Voice | Web Speech API (browser-native STT) + Claude Haiku intent parsing |
| Fonts | Oswald (headers) · Barlow Semi Condensed (body) · Share Tech Mono (data) |
| Maps | Tappable address links → Google Maps |
| Deploy | GitHub Actions → GitHub Pages on push to feature branch |
| PWA | Manifest + Apple meta tags — Add to Home Screen installable |

**Why single-file HTML:** Zero build step. Tyler and Jack open it in Chrome, add to home screen, done. Native app is the long-term target once workflow is validated in the field.

---

## 10. Current Build State — r39 (2026-06-03)

### ✅ Done
- Supabase-wired React app, live on GitHub Pages, auto-deployed on push
- Splash screen user picker (from DB, fallback Tyler/Jack)
- Full job CRUD with Supabase field mapping layer
- `resolveCustomer` — case-insensitive lookup, auto-insert on new
- Status changes log to `job_notes` as system entries
- Chores: full sync, assignment, auto-billing chore
- 60s auto-refresh + focus refresh + manual ↺
- localStorage write-through cache (instant render before fetch)
- sessionStorage selected job persistence (page reload returns to same job)
- Toast notifications throughout
- Photo upload: camera + gallery → Supabase Storage → `job_photos` table
- Pinch-to-zoom lightbox (6× max, pan, ✕ button)
- OCR nameplate scanning (Claude vision via claude-proxy)
  - Infers equipment type from model number when not printed
  - Scan photos auto-saved to job gallery
  - Scan-from-lightbox (URL-based image source)
- Equipment table: per-customer, labeled, expandable cards
  - Split in job detail: THIS JOB vs OTHER AT THIS ADDRESS
- Warranty registration flow: countdown, clipboard copy, Daikin link, mark-registered
- Voice button: floating, draggable, Web Speech API + Claude intent parsing
- Font sizes bumped for field readability (gloves-friendly)

### Supabase Project
- **URL:** https://asiviwwstglniuhsryze.supabase.co
- **Project ID:** asiviwwstglniuhsryze
- **Compute:** NANO
- **Edge Function:** `claude-proxy` — proxies Anthropic API; `ANTHROPIC_KEY` as secret

### Storage
- **Bucket:** `job-photos` (public)
- **Table:** `job_photos` (id, job_id, url, storage_path, created_at)

### Equipment Table
```sql
equipment (
  id uuid PK,
  customer_id uuid → customers.id CASCADE,
  job_id uuid → jobs.id ON DELETE SET NULL,   -- null = customer-only, not job-specific
  label text NOT NULL,
  equipment_type, brand, model_number, serial_number,
  tonnage, refrigerant, voltage, seer, mca, mop, year_manufactured,
  install_date date,
  warranty_registered boolean DEFAULT false,
  warranty_registered_date date,
  notes text,
  created_at, updated_at timestamptz
)
```
RLS: `anon_all` policy (FOR ALL TO anon USING (true) WITH CHECK (true))

### RLS Policies in place (anon key)
- SELECT: `jobs`, `customers`, `job_notes`, `chores`, `users`, `job_status_history`, `job_photos`, `equipment`
- INSERT: `jobs`, `customers`, `job_notes`, `chores`, `job_status_history`, `job_photos`, `equipment`
- UPDATE: `jobs`, `customers`, `chores`, `equipment`
- DELETE: `jobs`, `job_photos`, `equipment`

### Pending DB migrations (run in Supabase SQL editor if not yet applied)
```sql
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS install_date date;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS warranty_registered boolean DEFAULT false;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS warranty_registered_date date;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id) ON DELETE SET NULL;
```

---

## 11. Known Issues / TODO

| Issue | Priority | Notes |
|---|---|---|
| `job_notes` not populating | High | Run: `CREATE POLICY "anon_insert" ON job_notes FOR INSERT TO anon WITH CHECK (true); CREATE POLICY "anon_select" ON job_notes FOR SELECT TO anon USING (true);` |
| Real-time subscriptions | Medium | Currently refetch-on-focus + 60s timer; Supabase Realtime would push instantly |
| Job assignment UI | Medium | `assigned_to` column exists on jobs, no picker in UI yet |
| Equipment manual add | Low | Scan-only right now; need a manual entry form for unreadable tags |
| Customer deduplication | Low | ilike lookup is best-effort; unique constraint + upsert would be cleaner |
| Pull-to-refresh gesture | Low | Currently ↺ button only |
| Camera photos don't save to device roll | Low | Browser limitation — use native camera app then 🖼 GALLERY |
| Scheduled maintenance | Future | Recurring jobs, auto-scheduling — deferred until staffing allows |
| Daikin WCS dealer integration | Future | warranty.daikincomfort.com/WCS — requires distributor credentials |
| Real-time push (Supabase Realtime) | Future | Replace 60s poll with live subscriptions |

---

## 12. Design Language

- Tactical, utilitarian, Philly grit
- Dark theme primary
- Fonts: Oswald (headers), Barlow Semi Condensed (body), Share Tech Mono (data/codes)
- Colors: olive, brass, dark slate — not generic blue SaaS
- Every interaction designed for one hand, gloves, field conditions
- Font sizes bumped above typical mobile defaults for outdoor legibility
