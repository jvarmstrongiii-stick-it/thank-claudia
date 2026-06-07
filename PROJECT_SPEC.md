# PROJECT_SPEC.md
## TMC Mechanical — Claudia (Field Job Tracker)
**Last Updated:** 2026-06-05  
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

### Device passphrase gate
- All visits to the URL require a passphrase before anything loads
- Passphrase entered once per device → stored in `localStorage` as `tmc_device_auth`
- **Default passphrase:** `TMCmech` — change via `DEVICE_PASSPHRASE` constant at top of `claudia.html`
- Changing the constant invalidates all existing devices (they re-prompt on next visit)
- 🔒 button in header bar + Settings modal → "LOCK THIS DEVICE" — clears auth, returns to gate immediately

### User picker (Splash)
- Shown after device is authorized; reads from `users` table (falls back to Tyler/Jack)
- All users see all jobs and all technicians — no role restrictions at this time
- Chores assignable to specific users
- Future: role-based permissions (admin vs tech)

---

## 3. Job Types & Status Flows

| Job Type | Status Flow |
|---|---|
| Service Call | New → Scheduled → In Route → On Site → In Progress → On Hold → Completed/Needs Billing → Billed/Waiting for Payment → Completed/Paid → Closed |
| New Install | New → Evaluation Needed → Write Estimate → Waiting on Approval → Scheduled → In Route → On Site → In Progress → Completed/Needs Billing → Billed/Waiting for Payment → Completed/Paid → Closed |
| Maintenance | New → Scheduled → In Route → On Site → In Progress → Completed/Needs Billing → Billed/Waiting for Payment → Completed/Paid → Closed |
| Replacement | Same as New Install |
| Warranty | Same as Service Call |
| Estimate | New → Write Estimate → Waiting on Approval → Closed |

Full status list (in display order):
`On Site` · `In Route` · `Scheduled` · `New` · `Evaluation Needed` · `Write Estimate` · `Waiting on Approval` · `In Progress` · `On Hold` · `Completed/Needs Billing` · **`Billed/Waiting for Payment`** · `Completed/Paid` · `Closed`

- Billing chore auto-created when job reaches "Completed/Needs Billing"
- "Billed/Waiting for Payment" sits between billing steps (amber color) to track sent-but-unpaid invoices

---

## 4. Dashboard

- **Filter bar** — statuses that have active jobs appear as tabs; `All` (excludes Closed) at end, then `Closed`
  - First three tabs always: On Site · In Route · Scheduled (when populated)
- **Customer grouping** — customers with 2+ jobs are collapsed into a single header showing name, job count, status pills, and total value; tap to expand individual cards
- **Search** — real-time across customer name, phone, address, site address, notes; "Include closed jobs" toggle
- **Job cards** show: customer name, site address, job type, status pill, scheduled date/time, job value
- Revenue outstanding shown in header (all non-Closed, non-Paid jobs)
- ↺ manual refresh + 60s auto-refresh + window focus refresh
- ⚑ CHORES button → full chores management view

## 4a. Chores

- Internal tasks separate from jobs (pick up parts, call supplier, confirm delivery, etc.)
- Assignable to a specific technician; linkable to a specific job
- Billing chore auto-created when any job hits "Completed/Needs Billing"
- Full chores view:
  - Add new chore with description, job link, assignee
  - **Tap chore text or ✎ button** → inline edit form (description, job, assignee, save/delete/cancel)
  - Checkbox marks complete; completed chores visible via "SHOW COMPLETED (N)" toggle at bottom
  - Checking a completed chore reopens it (sets status back to `open`)
- Synced to `chores` table; `status` field is `open` | `done`

---

## 5. Voice System ✅ LIVE

- **🎙 floating mic button** — fixed position overlay on every screen
- Draggable — user repositions it, position persists to localStorage
- Tap → Web Speech API activates (browser-native, continuous mode, stops on button re-tap)
- Button pulses red while listening, amber while Claude parses intent
- Transcript sent to Claude Haiku via `claude-proxy` edge function

### Screen-aware routing
The prompt includes the current screen (`chores` / `job_detail:<id>` / `new_job_form` / `dashboard`) so Claude routes the command correctly:
- Speaking on the chores screen → creates a chore
- Speaking on a job detail → creates a chore linked to that job, or adds a note to that job

### Supported intents
| Intent | Example | Action |
|---|---|---|
| `add_job` | "add a service call for Smith" | Opens form pre-filled |
| `add_chore` | "remind Tyler to order filters" | Inserts to `chores` table; links to current job if on job detail |
| `navigate` | "go to Robert" | Opens that job |
| `search` | "show me scheduled jobs" | Filters dashboard |
| `update_status` | "mark Smith as on site" | Updates job status immediately |
| `add_note` | "add note: no dogs" | Writes to `job_notes` |

---

## 5a. Customer Site Locations

Customers can have multiple service addresses (e.g. a property manager with 6 buildings, or a homeowner with a rental unit).

- When adding a job for an existing customer, the form checks their history for past site addresses
- If multiple sites found: picker shows saved addresses — tap to select or tap "+ NEW SITE" to add one
- If same as customer address: "Same as customer address" checkbox (remembered per device)
- Site address and customer address stored independently on `jobs` table via `resolveCustomer`
- All jobs for a customer share their equipment log regardless of which site the job was at

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
  - Tapping ✕ on a photo shows an inline bottom-sheet confirmation (not `confirm()`)
  - Equipment scan photos tagged `photo_type='equipment'` — deleting one shows a stronger warning ("equipment record stays but reference image will be lost")
  - Pinch-to-zoom lightbox with pan; 🔍 SCAN FOR EQUIPMENT button in lightbox
- **Equipment — THIS JOB** — gear installed/serviced on this job
  - 📷 SCAN (camera) + 🖼 UPLOAD (gallery) → OCR + photo saved to gallery simultaneously
- **Equipment — OTHER AT THIS ADDRESS** — pre-existing gear captured for reference
- Service history (status change log)
- UPDATE STATUS → sheet showing valid next statuses
- DELETE JOB

---

## 7. Equipment System ✅ LIVE

Equipment is linked to **customers** (not jobs) — appears on every job for that address.

### Per-equipment card shows:
- User-defined label (e.g. "Living Room", "Outdoor Unit", "Furnace")
- Brand · Model # · Serial #
- Warranty status badge
- Expandable: Type, Year, **Capacity** (replaces "Tonnage"), Refrigerant, Voltage, SEER, MCA, MOP

### OCR scanning — model number inference:
Claude extracts all printed fields and decodes specs from the model number:
- **AC/heat pumps:** `036` → `3 ton (36,000 BTU)`, `024` → `2 ton (24,000 BTU)`, etc.
- **Electric heat strips:** `H6HK010H` → `10 kW (34,120 BTU)`, formula: kW × 3,412 = BTU
- **Gas furnaces:** `080` → `80,000 BTU`, `100` → `100,000 BTU`
- **Equipment type + brand** inferred from prefix: DR96TC=furnace, GSX/SSX=AC condenser, FTX=Mitsubishi, etc.
- Capacity stored in the `tonnage` DB column; labeled "CAPACITY" in UI

### Warranty tracking:
- `install_date` auto-set from job's scheduled date on scan
- 60-day countdown to Daikin enhanced warranty registration deadline
- Badge: pending · urgent (≤14 days, amber) · lapsed · registered ✓
- WarrantySheet: pre-filled data block, 📋 COPY ALL, 🌐 Daikin reg link, ✓ MARK AS REGISTERED

---

## 8. Adding / Editing Jobs

Job form fields:
- Customer name (autocomplete from existing customers)
- Site address (picker if customer has multiple known sites, or free-text)
- Customer address (if different from site)
- Phone, Job type, Status, Scheduled date + time, Job value, Notes

**Note:** `fromRow` uses `c.address` as-is when present (no city/state concatenation). Prevents state abbreviation being appended on each save cycle if the customers table has both `address` and `state` columns populated.

---

## 9. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single-file HTML · React 18 CDN · Babel standalone (no build step) |
| Backend | Supabase (PostgreSQL + REST API + Storage) |
| Auth | Device passphrase gate (localStorage) → Splash user picker (anon key, no Supabase Auth) |
| AI / OCR | Claude Haiku via Supabase Edge Function `claude-proxy` (CORS proxy) |
| Voice | Web Speech API (browser-native STT, continuous) + Claude Haiku intent parsing |
| Fonts | Oswald (headers) · Barlow Semi Condensed (body) · Share Tech Mono (data) |
| Maps | Tappable address links → Google Maps |
| Deploy | GitHub Actions → GitHub Pages on push to `claude/hvac-supabase-integration-Di5df` |
| PWA | Manifest + Apple meta tags — Add to Home Screen installable |

**Why single-file HTML:** Zero build step. Tyler and Jack open it in Chrome, add to home screen, done. Native app is the long-term target once workflow is validated in the field.

---

## 10. Current Build State — r42 (2026-06-05)

### ✅ Done (cumulative)
- Supabase-wired React app, live on GitHub Pages, auto-deployed on push
- Device passphrase gate — entered once per device, lockable from header/settings
- Splash screen user picker (from DB, fallback Tyler/Jack)
- Full job CRUD with Supabase field mapping layer
- `resolveCustomer` — case-insensitive lookup, auto-insert on new
- Status changes log to `job_notes` as system entries
- All 13 statuses including "Billed/Waiting for Payment"
- Chores: full sync, assignment, inline editing, completed section, auto-billing chore
- Customer grouping on dashboard — collapsible headers for multi-job customers
- 60s auto-refresh + focus refresh + manual ↺
- localStorage write-through cache (instant render before fetch)
- sessionStorage selected job persistence
- Toast notifications throughout
- Photo upload: camera + gallery → Supabase Storage → `job_photos`
  - Equipment scan photos tagged `photo_type='equipment'`
  - Inline confirmation sheet on delete (no `confirm()`)
  - Stronger warning when deleting equipment-scan photos
- Pinch-to-zoom lightbox (6× max, pan)
- OCR nameplate scanning — extracts fields + derives BTU/kW/tonnage from model number
- Equipment table: per-customer, labeled, expandable cards, edit/delete
  - Split in job detail: THIS JOB vs OTHER AT THIS ADDRESS
- Warranty registration flow: countdown, clipboard copy, Daikin link, mark-registered
- Voice button: floating, draggable, Web Speech API + Claude intent parsing
  - Screen-aware routing: `add_chore` intent for chores/job-detail screens
- Filter bar: ordered On Site → In Route → Scheduled → …; All at end before Closed
- `fromRow` address fix: uses `c.address` directly (no state-suffix accumulation)

### Supabase Project
- **URL:** https://asiviwwstglniuhsryze.supabase.co
- **Project ID:** asiviwwstglniuhsryze
- **Compute:** NANO
- **Edge Function:** `claude-proxy` — proxies Anthropic API; `ANTHROPIC_KEY` as secret

### Storage
- **Bucket:** `job-photos` (public)
- **Table:** `job_photos` (id, job_id, url, storage_path, photo_type, created_at)

### Equipment Table
```sql
equipment (
  id uuid PK,
  customer_id uuid → customers.id CASCADE,
  job_id uuid → jobs.id ON DELETE SET NULL,
  label text NOT NULL,
  equipment_type, brand, model_number, serial_number,
  tonnage,         -- stores full capacity string: "3 ton (36,000 BTU)" or "10 kW (34,120 BTU)"
  refrigerant, voltage, seer, mca, mop, year_manufactured,
  install_date date,
  warranty_registered boolean DEFAULT false,
  warranty_registered_date date,
  notes text,
  created_at, updated_at timestamptz
)
```

### RLS Policies in place (anon key)
- SELECT: `jobs`, `customers`, `job_notes`, `chores`, `users`, `job_status_history`, `job_photos`, `equipment`
- INSERT: `jobs`, `customers`, `job_notes`, `chores`, `job_status_history`, `job_photos`, `equipment`
- UPDATE: `jobs`, `customers`, `chores`, `equipment`
- DELETE: `jobs`, `job_photos`, `equipment`, `chores`

### Pending DB migrations (run in Supabase SQL editor if not yet applied)
```sql
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS install_date date;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS warranty_registered boolean DEFAULT false;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS warranty_registered_date date;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS photo_type text;
```

---

## 11. Known Issues / TODO

| Issue | Priority | Notes |
|---|---|---|
| `job_notes` not populating | High | Run: `CREATE POLICY "anon_insert" ON job_notes FOR INSERT TO anon WITH CHECK (true); CREATE POLICY "anon_select" ON job_notes FOR SELECT TO anon USING (true);` |
| Duplicate PA in existing addresses | Medium | Some customer records may have accumulated `, PA` before the fix — clean up manually in Supabase |
| Real-time subscriptions | Medium | Currently refetch-on-focus + 60s timer; Supabase Realtime would push instantly |
| Job assignment UI | Medium | `assigned_to` column exists on jobs, no picker in UI yet |
| Equipment manual add | Low | Scan-only right now; need a manual entry form for unreadable tags |
| Customer deduplication | Low | ilike lookup is best-effort; unique constraint + upsert would be cleaner |
| Pull-to-refresh gesture | Low | Currently ↺ button only |
| Camera photos don't save to device roll | Low | Browser limitation — use native camera app then 🖼 GALLERY |
| Scheduled maintenance | Future | Recurring jobs, auto-scheduling — deferred until staffing allows |
| Supabase Auth (proper login) | Future | Replace passphrase gate with magic-link email auth per user |
| Warranty badge on components | Low | Countdown shows on motors/capacitors/parts that don't qualify — restrict to whole units (condensers, heat pumps, air handlers, furnaces) only |
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
