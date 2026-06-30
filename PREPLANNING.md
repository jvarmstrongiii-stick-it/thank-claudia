# Pre-Planning — Records, Filters & Materials (LIVING DOC)

> Status: **discussion / pre-planning only — not approved to build.**
> This doc accumulates decisions and open questions as Jack and Claude talk it
> through. Nothing here is implemented yet. Last updated: r166 era.

---

## The core reframe

Today every job shows one generic **SERVICE HISTORY** stream (all non-system
`job_notes`). Jack wants the record *kind* to follow the **job type**, and wants
easy text/daily logging plus two new structured features (filters, materials).

### Job-type → record-kind mapping

| Job type | Record area | Voice note goes to | Status |
|----------|-------------|--------------------|--------|
| Estimate | (unchanged) general **Notes** | Notes | ✅ confirmed — leave as-is |
| Service Call | **Service Record / Log** | the service log | ✅ confirmed (service) |
| Maintenance | **Maintenance Record / Log** + checklists | the maintenance log | ✅ confirmed (maintenance) |
| New Install | **Daily Log** (progress entries) | daily log (assumed) | ⚠️ install→daily log assumed |
| Replacement | **Daily Log** (progress entries) | daily log (assumed) | ⚠️ assumed |
| Warranty | ? (likely Service Record) | ? | ❓ open — confirm |

---

## Workstream 1 — Logs (daily / service / maintenance)

The "what we did today" area + per-job running log. Same mechanism across the
non-estimate types, labeled per job type.

**Confirmed:**
- Easy **text entry**, date handled automatically.
- **No author attached** to entries — any tech adds to / appends to what other
  techs already recorded (shared running record). *(This overrides Claude's
  earlier "one entry per tech with names" idea — explicitly not wanted.)*
- Voice notes route into the job's log for **Service** and **Maintenance**
  jobs; into the **Daily Log** for in-process/install jobs; into plain **Notes**
  for **Estimate** jobs.
- Multi-day/multi-week jobs: a dated list of entries over the life of the job.

**Open questions:**
- Q1: One running entry **per day** that everyone appends to (like voice does
  today), shown as a dated list? (assumed yes)
- Q2: Is the service/maintenance log the *same* dated-append model as the daily
  log, just relabeled — or do service/maintenance want anything different
  (e.g. tied to a checklist item)?

---

## Workstream 2 — Maintenance checklists

Maintenance jobs are checklist-driven: coil/filter cleanings & replacements,
blower-motor cleaning, general inspections. **Jack will author the checklists.**

**Open questions:**
- What does a checklist look like (fixed template per maintenance job? editable
  per job?) and where is it stored?
- How does a completed checklist relate to the Maintenance Record (does checking
  items auto-write the record)?
- Lower priority than logs/filters/materials? (sequencing)

---

## Workstream 3 — Filters (attached to equipment, not the job)

**Confirmed:**
- Record **filter size(s)** where applicable.
- Attach to the **specific equipment** (not the job).
- Track **"last replaced on"** date (single last date — no full history needed).
- **Checkbox to confirm the filter was actually replaced** (customers sometimes
  assume it was; this verifies it).

**Open questions:**
- Q1: Can one piece of equipment have **more than one filter / size**, or one?
- Q2: When the "replaced" checkbox is ticked, should it **auto-set "last
  replaced on" to today** (and uncheck/reset on a new visit)? Or is the date
  always entered by hand?
- Q3: New fields on the `equipment` table (e.g. `filter_size text`,
  `filter_last_replaced date`). Confirm placement in the equipment card UI.

---

## Workstream 4 — Materials needed (cross-job)

**Confirmed:**
- Enter **materials needed per job** — **free text** (no structured qty).
- A **shop-wide "Materials Needed" list** on its own **screen in the menu**,
  aggregated from **every job** that has anything in that field.
- Each item has a **checkbox = acquired/fulfilled**; checking it **drops it off
  the shop-wide needed list** but the item **stays on the job** record.

**Open questions:**
- Q1: On the shop-wide screen, group items **by job**? Show job/customer next to
  each item? Any sort (e.g. by job schedule date)?
- Q2: Are checked items hidden everywhere on the shop list, or shown struck-
  through? (Assumed: hidden from "needed", still on the job.)

---

## Parked (future, per Jack)

- **Preventative-maintenance plans** — "getting into soon."
- "Probably more" — to be added as Jack thinks of it.

---

## Notes / interpretation flags

- "checkbook" read as **checkbox** throughout (filters + materials).
- All times/dates use the app timezone (Philly) per r163–r165.
- No schema migration files in repo — any new `equipment`/`job_notes` columns
  must be added in the Supabase dashboard + `NOTIFY pgrst, 'reload schema'`.
