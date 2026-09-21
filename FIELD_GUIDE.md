# Claudia — Field & Office Quick-Start Guide

This is the "how do I actually use this thing" guide — not the technical spec.
For architecture/schema, see `PROJECT_SPEC.md` and `CLAUDE.md`.

**App:** https://jvarmstrongiii-stick-it.github.io/thank-claudia/
**Works on:** any phone/tablet browser. Add it to your home screen (Share → Add to Home Screen) so it opens like a real app.

---

## Getting In

1. First time on a device: enter the shop passphrase. It's remembered after that — you won't see it again on that phone.
2. Pick your name from the list.
3. If you have unfinished chores, you'll see them before the dashboard loads — clear or skip them to continue.

---

## Clocking In (start of your day)

You can't do anything else in the app until you clock in or hit **BROWSE AFTER HOURS**.

1. Tap **CLOCK IN**.
2. Pick the job you're heading to (or tap **+ NEW JOB** right there if it's not on the list yet).
3. Choose **IN ROUTE** or **ON SITE** depending on whether you're driving or already there.
4. Confirm the time — if you're doing this late (forgot to clock in this morning), you can rewind the time here instead of it just using "now."

**BROWSE AFTER HOURS** lets you look at jobs/schedule without starting a clock session — use it for after-hours planning, not for actual work time.

---

## While You're Working

Your status bar at the top always shows your current state and has quick buttons:

| Button | What it does |
|---|---|
| **ON SITE** | You've arrived — flips your status, keeps the same time clock running (doesn't reset your leg time) |
| **⏸ PAUSE** | Take a break — pick a reason: 🥪 Lunch, 🧰 Getting Materials, 🏬 Shop Run, 🚻 Washy Washy, or type your own |
| **▶ RESUME** | Come back from a break |
| **⇄ MOVE JOB** | Heading to a different job without clocking out fully |
| **CLOCK OUT** | End your day (or this job) |

**Paid vs. unpaid breaks:** Lunch/Washy Washy/other = unpaid, the clock stops counting.
Getting Materials/Shop Run = paid, and you'll be asked **"bill this time to: this job or the shop?"** — pick whichever is accurate, it affects the job's labor cost, not your hours.

**Forgot to clock out yesterday / mid-break?** Every clock action (in, out, pause, resume, move) shows a **CONFIRM TIME** screen — you can rewind the time (and date, for clock-out) instead of leaving it stuck at "now." Do this rather than letting a session sit open overnight — an open session across days creates messy, hard-to-fix time log entries.

---

## Working a Job

Open any job to get to its detail screen:

- **UPDATE STATUS** — moves the job through its lifecycle (New → Scheduled → In Route → On Site → In Progress → ... → Closed). Updating status always sends you back to the dashboard.
- **Daily log / Service Record / Maintenance Record** (heading changes by job type) — type what you did, or use voice. Multiple entries the same day merge into one.
- **📷 ADD PHOTO** — camera or gallery. If it's an equipment nameplate, you'll get **🔍 SCAN FOR EQUIPMENT**; if it's a receipt, **🧾 SCAN AS RECEIPT** — both use the camera/AI to read the details for you instead of typing them in.
- **RECEIPTS** — snap a photo, it reads the vendor/amount automatically. Multi-page receipts: it'll ask "more pages?" after each shot.
- **MATERIALS NEEDED** — a checklist tied to the job; also rolls up into the shop-wide MATERIALS screen (menu) so office can see what everyone needs.
- **WHAT'S NEXT** — leave a note about what's still left, especially useful on multi-day jobs.
- **DEPOSIT** — record a cash/check deposit taken against the job (this reduces what shows as still owed).
- **SCHEDULED** — set or change the date/time this job is on the calendar.
- **TIME LOG** — shows everyone's clocked time on this job, grouped by day. You can add or fix entries here (e.g. a missed clock-out) — look for **⚠️ NO CLOCK-OUT** flags, those need fixing.
- **CREW STATUS** — who else is currently on/heading to this job.

At the bottom: **UPDATE STATUS · DELETE JOB · ‹ BACK**.

---

## Adding a New Job

Tap **+ ADD JOB** from the dashboard, or **+ NEW JOB** from the Clock In / Move Job screens. Fill in customer, job type, address, and what they asked for — voice or type. New jobs start with no date/time; schedule them from the job or from the Calendar when you're ready.

---

## The Calendar

Menu → **CALENDAR**. Three views: Agenda (list), Month, Week.
- Tap a day (Month/Week) or "+ SCHEDULE JOB" (any view) to put a job on the calendar.
- Drag a job chip to a different day to reschedule it (you'll confirm the new time).
- Tap a job chip to peek at it; long-press-and-release (no drag) to move it without dragging.

---

## Office / Admin Screens (☰ menu)

| Menu item | What it's for |
|---|---|
| **HOURS REPORT** | Everyone's hours — by tech, by job, or by day. Flags anything over 16h/day or missing a clock-out as suspicious — go fix it in that job's Time Log. |
| **CALENDAR** | Scheduling across all jobs |
| **BALANCES** | Outstanding money broken down by status (Waiting on Approval, Needs Billing, Billed/Waiting for Payment, Active Work), plus what's been Collected in a date range |
| **MATERIALS** | Every job's unchecked materials, grouped by job, shop-wide |
| **CAP CALCULATOR** | Capacitor sizing tool |
| **SETTINGS** | Timezone and other app settings |

**REFRESH** at the top of the menu re-pulls live data if something looks stale.
**🔒 LOCK THIS DEVICE** — clears this device's saved passphrase, forces a re-entry (use if handing off a shared tablet).

---

## Common Gotchas

- **The version number in the corner (rNNN)** tells you if you're on the latest build. If Jack says he pushed a fix and your number doesn't match, do a hard refresh (or close and reopen the browser tab).
- **A job you clocked into yesterday and forgot to clock out of** will prompt you next time you open the app — don't dismiss it, use it to fix the time.
- **Status changes always kick you back to the dashboard** — that's expected, not a bug.
- **Deleting a Time Log entry** can be tricky if it's tangled up with another entry — the app will ask before it does anything destructive; read those prompts, they're telling you exactly what's about to happen.

---

## Something Broken?

Screenshot it and send it to Jack with what you were doing right before it happened (which job, which button). That's usually all that's needed to track down and fix it.
