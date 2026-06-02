# PROJECT_SPEC.md
## TMC Mechanical — Claudia (Field Job Tracker)
**Last Updated:** 2026-06-02  
**Stack:** Single-file HTML/React (CDN + Babel) · Supabase · Claude API (planned)  
**Platform:** Mobile browser (Chrome/Safari) — installable as PWA via Add to Home Screen  
**Repo:** jvarmstrongiii-stick-it/thank-claudia · branch: claude/hvac-supabase-integration-Di5df  
**Working file:** tmctracker.html

---

## 1. Overview

Voice-first HVAC field service management app for TMC Mechanical (Tyler's company, Philly/Montco/Delco). Designed for field technicians to manage their day hands-free, and for all users to see the full team's workload in real time.

---

## 2. Users & Access

- No role restrictions at this time — all users see all jobs, all technicians
- Users displayed as pills across the top of the dashboard (everyone sees everyone's work)
- Jobs can be assigned to any user by any user
- Future: role-based permissions (admin vs tech)

---

## 3. Job Types & Flows

Job type determines which status flow the job follows.

### Flow 1 — Install / Replacement
**Job Types:** Install, Replacement  
**Statuses:**  
`New RFP → Estimate Given → Deposit Received → Equipment Ordered → Scheduled → In Progress → Complete → Invoiced → Paid in Full → Closed`

**PIF → Closed Checklist (non-blocking):**
- Permit pulled
- Equipment photos taken
- Serial numbers logged
- Warranty registered
- Receipts scanned
- Deposit reconciled

---

### Flow 2 — Service
**Job Types:** Service  
**Statuses:**  
`New → Scheduled → In Route → On Site → Complete → Invoiced → Paid in Full → Closed`

**PIF → Closed Checklist (non-blocking):**
- Work photos taken
- Parts receipts scanned
- Invoice attached

---

### Flow 2b — Maintenance
**Job Types:** Maintenance  
**Statuses:** Same as Service flow  

**PIF → Closed Checklist (non-blocking):**
- Filter replaced
- Maintenance report completed
- Next service date set
- Receipts scanned

---

**Checklist behavior:**
- Checklist appears when tapping Closed, but does NOT block closing
- Checklists are editable data (not hardcoded) — items can be added/removed in settings

---

## 4. Dashboard

- User pills across top — tap to filter by tech, or view all
- Job cards show: customer, address, job type, status, assigned tech, scheduled time, job value
- Drag-and-drop reordering for prioritization (admin view)
- Filter by job type / status
- Real-time updates across all users
- Revenue tracking — estimated job cost visible on each card

---

## 5. Voice System

- Floating microphone button — repositionable by user (drag to preferred corner)
- Always accessible, overlays all screens
- Voice commands include:
  - "What's on my plate today?" → lists assigned jobs
  - "Add new job" → triggers conversational job intake flow
  - "I'm heading to [customer]" → conflict check + geofence arm
  - "Mark [job] complete" → status update
  - "Call [customer]" → opens dialer
- Voice intake flow: asks for customer (new or existing), job type, scheduled time, notes
- Speech processing lag known issue — to be optimized (expo-speech-recognition threading)

---

## 6. Job Detail View

Full-page view (not bottom sheet) containing:
- Customer name, address (tappable → maps), phone (tappable → dialer)
- Assigned technician
- Scheduled date/time — tappable to reschedule (same-day time change or full date)
- Job type + status flow indicator
- Update Status button → shows correct flow statuses for job type
- Service history (all past jobs for this customer)
- Equipment info (photos, serial numbers, model numbers)
- Notes
- Photos strip
- PIF → Closed checklist (when applicable)

---

## 7. Customer Records

- Auto-created on first job entry
- Fields: name, address, phone, email (optional)
- Full service history across all visits
- Equipment log (tied to address)

---

## 8. Equipment & Photo Capture

- Camera integration via expo-camera
- OCR via Claude API — scan invoices, receipts, equipment tags
- Auto-extracts: serial number, model number, equipment type
- Photos tagged and stored per job and per customer
- Photo strip visible on job detail

---

## 9. Geofencing

- Arms when technician indicates they are heading to a job
- On arrival: triggers alert with customer history, service details, upcoming maintenance notes
- Status auto-suggestion on arrival (prompt to mark "On Site")

---

## 10. Notifications

- In-app notification bell (top right) — dot indicator when unread
- Notification types: job assigned, job status changed, scheduling conflict, chore auto-created
- Future: SMS via Twilio

---

## 11. Scheduling

- Conflict detection — warns when new job overlaps existing
- Reschedule modal: same-day time adjustment or full date change
- Scheduled date visible on all job cards

---

## 12. Chores / Admin Tasks

- Separate from jobs — internal tasks (pick up parts, call supplier, etc.)
- Auto-created chores triggered by certain job events (e.g. equipment ordered → "confirm delivery")
- Visible on dashboard alongside jobs or in separate chores tab

---

## 13. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single-file HTML · React 18 CDN · Babel standalone (no build step) |
| Backend | Supabase (PostgreSQL + REST API + Storage) |
| Auth | Splash-page user picker → localStorage (anon key, no Supabase Auth) |
| AI/OCR | Claude API — planned for nameplate scanning, voice intake |
| Fonts | Russo One (headers) · Share Tech Mono (data) |
| Maps | Browser tappable address links → Google Maps |
| Future | PWA manifest (installable) · Twilio SMS · Real-time subscriptions |

**Why single-file HTML instead of React Native:**  
Zero build step — works offline, deployed by downloading one file. Tyler and Jack open it in Chrome, add to home screen, done. Native app remains the long-term target once the workflow is validated in the field.

---

## 14. Current Build State — 2026-06-02

### ✅ Done
- Single-file React app (`tmctracker.html`) wired to Supabase
- Splash screen: tap your name (reads from `users` table, falls back to Tyler/Jack)
- Full job CRUD — all writes go to Supabase, read by any device on reload
- Field mapping layer: flat local job shape ↔ normalized `jobs` + `customers` tables
- `resolveCustomer`: case-insensitive lookup → insert new customer if not found
- `job_notes` table used for work history (filters out `source='system'` entries from display)
- Status changes write a system note to `job_notes`
- Chores sync to `chores` table
- Refetch on window focus — near-live sync without subscriptions
- localStorage write-through cache for instant render before fetch resolves
- Toast notifications for all errors and confirmations
- Import button — seeds Supabase from exported legacy JSON (localStorage → Supabase)
- Export button — downloads full job+chore snapshot as JSON
- 15 real jobs imported and live on both phones ✅

### Supabase Project
- **URL:** https://asiviwwstglniuhsryze.supabase.co
- **Project ID:** asiviwwstglniuhsryze
- **Compute:** NANO

### RLS Policies in place (anon key)
Tables with SELECT: `jobs`, `customers`, `job_notes`, `chores`, `users`, `job_status_history`  
Tables with INSERT: `jobs`, `customers`, `job_notes`, `chores`, `job_status_history`  
Tables with UPDATE: `jobs`, `customers`, `chores`  
Tables with DELETE: `jobs`

### DB fixes applied
- Dropped `jobs_flow_type_check` constraint (was blocking job type text values)
- Added anon INSERT policy on `job_status_history` (DB trigger fires on every job insert)

---

## 15. Known Issues / TODO

| Issue | Priority | Notes |
|---|---|---|
| Photo upload | High | Supabase Storage bucket not set up yet — camera button is stubbed |
| OCR nameplate scanning | High | Photo → Claude vision → populate model/serial on equipment table |
| PWA manifest | Medium | Add to Home Screen feels like a native app install |
| Real-time subscriptions | Medium | Currently refetch-on-focus; Supabase Realtime would push instantly |
| `location` / `site_address` not persisted | Medium | No separate DB column yet — mirrors customer_address on load |
| Customer deduplication | Low | ilike lookup is best-effort; DB unique constraint + upsert would be cleaner |
| Job assignment UI | Medium | `assigned_to` column exists, no picker in UI yet |
| Pull-to-refresh gesture | Low | Currently refresh button only |

---

## 16. Design Language

- Tactical, utilitarian, Philly grit
- Dark theme primary
- Fonts: Russo One (headers), Barlow (body), Share Tech Mono (data/codes)
- Colors: olive, brass, dark slate — not generic blue SaaS
- Every interaction designed for one hand, gloves, field conditions
