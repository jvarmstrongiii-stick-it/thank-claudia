-- Phase A/B (multi-tenancy) — step 5 of 5: THE CUTOVER
--
-- This is a runbook, not a script to paste and run in one shot. Every step
-- is manual and ordered on purpose. Read it end to end before doing
-- anything. This is the one step in the whole migration that touches a
-- live production PK and flips on enforcement that can lock people out —
-- confirm with Jack before running step 3 or step 5 specifically, even if
-- everything else here has already been agreed to.
--
-- Do this on a throwaway/staging Supabase project FIRST. Rehearse the
-- whole thing there, including step 3's transaction, before touching
-- production.
--
-- Preconditions: 0001-0004 have all been run successfully against this
-- project already, and are confirmed working (the still-unauthenticated,
-- pre-Phase-B claudia.html has been used normally since — clock in/out,
-- add a note, etc. — with no errors, proving the set_company_id()
-- fallback in 0002 is doing its job).


-- ── Step 1 (dashboard, not SQL) ──────────────────────────────────────────
-- Supabase Dashboard → Authentication → Users → Invite user, once per
-- person: Tyler, Jack, Brett, Admin (only if "Admin" is a real inbox
-- someone checks — otherwise skip it and don't give it a login).
-- Each invite email lets that person set their own password. After all
-- four have done this, note down each person's new auth.users.id (visible
-- in the same Users list) — you'll need them in step 3.


-- ── Step 2 (SQL, read-only, confirms step 1 landed correctly) ───────────
-- select id, email from auth.users order by created_at;
-- Match each id to a person by email. Also grab each person's CURRENT
-- users.id from before the rekey:
-- select id, name from public.users order by name;


-- ── Step 3 (SQL, THE RISKY PART — confirm with Jack first) ──────────────
-- Take a fresh backup / confirm Point-in-Time-Recovery is available
-- immediately before running this. Run during a confirmed low-traffic
-- window — nobody clocked in on any device.
--
-- Fill in the eight uuids below from steps 1-2, then run this whole block
-- as one transaction. If anything looks wrong after the SELECT at the end,
-- ROLLBACK instead of COMMIT — nothing is final until COMMIT runs.
--
-- The users_id_fkey constraint from 0001 was added NOT VALID specifically
-- so these updates don't get rejected mid-transaction (it isn't checking
-- existing rows yet — only step 4 turns that checking on, after this
-- succeeds).

begin;

update public.users set id = '<TYLER_AUTH_UUID>' where id = '<TYLER_OLD_UUID>';
update public.users set id = '<JACK_AUTH_UUID>'  where id = '<JACK_OLD_UUID>';
update public.users set id = '<BRETT_AUTH_UUID>' where id = '<BRETT_OLD_UUID>';
update public.users set id = '<ADMIN_AUTH_UUID>' where id = '<ADMIN_OLD_UUID>';
-- If Admin isn't a real login (per Step 1), skip its line above and instead
-- decide separately whether that users row stays as a login-less record or
-- gets removed — don't leave it half-migrated.

-- Verify all four (or three) landed and every existing FK still resolves:
select u.id, u.name, u.company_id,
       (select count(*) from public.jobs j where j.assigned_to = u.id) as jobs_assigned,
       (select count(*) from public.job_notes n where n.user_id = u.id) as notes_written
from public.users u
order by u.name;
-- Spot-check jobs_assigned/notes_written against what you'd expect for
-- each person before committing.

commit; -- or: rollback;


-- ── Step 4 (SQL, safe once step 3 is committed and verified) ────────────
alter table public.users validate constraint users_id_fkey;
-- Set Jack's admin flag (adjust the name filter for whoever should have it):
update public.users set is_admin = true where name = 'Jack';


-- ── Step 5 (deploy, NOT SQL — do this before step 6) ─────────────────────
-- Deploy the Phase B claudia.html (LoginScreen, session handling,
-- PassphraseGate/Splash/FALLBACK_USERS removed — see CLAUDE.md). Bump
-- APP_REV, push to main per the repo's standing rules. Confirm Tyler,
-- Jack, and Brett can each log in with their new email+password and see
-- all of TMC's existing data untouched (their full job/time history).
--
-- Do not run step 6 until this is confirmed working for everyone — the
-- pre-Phase-B app can still write correctly via 0002's fallback for as
-- long as you need, so there's no clock running here.


-- ── Step 6 (SQL, THE ACTUAL CUTOVER — confirm with Jack first) ──────────
-- Only after step 5 is confirmed working for every real user. This is
-- irreversible in the sense that the OLD, passphrase-only claudia.html
-- will stop being able to read or write anything the instant this runs
-- (it never sends an auth session, so current_company_id() is always null
-- for it from here on) — that's the point, but make sure nobody is still
-- relying on the old version (e.g. a cached tab that hasn't reloaded).

alter table public.jobs          enable row level security;
alter table public.customers     enable row level security;
alter table public.users         enable row level security;
alter table public.equipment     enable row level security;
alter table public.chores        enable row level security;
alter table public.job_notes     enable row level security;
alter table public.job_photos    enable row level security;
alter table public.receipts      enable row level security;
alter table public.notifications enable row level security;
alter table public.job_crew      enable row level security;
alter table public.companies     enable row level security;

-- Immediately verify: log into claudia.html as Jack, confirm every screen
-- still shows TMC's data normally. Then, separately, confirm the anon key
-- alone (no session — e.g. curl with just apikey/Authorization: Bearer
-- <anon key>) can no longer read rows from any of the tables above.


-- ── Step 7 (SQL, cleanup — do this last, once step 6 has been stable) ───
-- Removes the TMC-name fallback in set_company_id() now that every write
-- goes through a real authenticated session. Optional/low-risk, can wait.
create or replace function public.set_company_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    new.company_id := public.current_company_id();
  end if;
  return new;
end;
$$;
