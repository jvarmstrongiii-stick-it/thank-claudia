# PROJECT_SPEC.md
## TMC Mechanical — Caitlyn App
**Last Updated:** 2026-05-30  
**Stack:** React Native (Expo) · Node.js · Supabase · Claude API  
**Platform:** Android (internal, no Play Store) · iOS future  
**Build Tool:** EAS (Expo Application Services)  
**Repo:** jacksteriii/tmc-mechanical · apps/mobile

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
| Mobile Frontend | React Native (Expo SDK 54) |
| Routing | Expo Router v6 |
| Build/Deploy | EAS (Expo Application Services) |
| Backend | Node.js |
| Database | Supabase (PostgreSQL + Realtime + Storage) |
| AI/OCR | Claude API (claude-sonnet-4-20250514) |
| Speech | expo-speech-recognition |
| Camera | expo-camera + expo-image-picker |
| Fonts | Barlow, Russo One, Share Tech Mono |
| Maps | TBD (Google Maps SDK or expo-location) |
| SMS | Twilio (future) |

---

## 14. Current Build State

- EAS project initialized: `@jacksteriii/tmc-mechanical`
- Android development build completed and installed on device
- App shell running, dev client launcher confirmed working
- Tunnel mode (`npx expo start --tunnel`) configured for remote dev
- OTA updates configured for field testing without LAN
- App code in `apps/mobile/` with Expo Router structure
- Components built: JobCard, VoiceBar, EquipmentCard, OCRResultCard, PhotoCapture, PhotoStrip, ConfirmJobModal

---

## 15. Known Issues / TODO

| Issue | Priority | Notes |
|---|---|---|
| Speech recognition 8-sec processing lag | High | expo-speech-recognition threading issue |
| Network request failed on tunnel (mobile data) | Medium | Flaky on cellular, stable on WiFi |
| EAS Workflow (auto-build on git push) | Low | Set up when app is stable |
| iOS build | Low | Android first, iOS later |
| User list pills not yet in native build | High | Was in prototype, needs porting |
| Floating mic button | High | Needs drag-to-reposition implementation |
| Job assignment to users | High | UI needed |

---

## 16. Design Language

- Tactical, utilitarian, Philly grit
- Dark theme primary
- Fonts: Russo One (headers), Barlow (body), Share Tech Mono (data/codes)
- Colors: olive, brass, dark slate — not generic blue SaaS
- Every interaction designed for one hand, gloves, field conditions
