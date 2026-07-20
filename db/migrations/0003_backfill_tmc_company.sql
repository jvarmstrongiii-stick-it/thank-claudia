-- Phase A (multi-tenancy) — step 3 of 5 (yes, 3 — see db/migrations/README.md
-- for why 0002_functions_and_triggers.sql runs BEFORE this file even though
-- its filename sorts first numerically... it doesn't; read the README).
--
-- Creates TMC Mechanical's own companies row and backfills company_id onto
-- every existing row in every actively-used table, then makes company_id
-- required.
--
-- MUST run after 0002_functions_and_triggers.sql, not before. set_company_id()
-- (created in 0002) is what makes it safe to flip company_id to NOT NULL here
-- — it auto-fills company_id on every insert the still-unauthenticated,
-- pre-Phase-B claudia.html makes (falling back to TMC's company row by name
-- since there's no auth.uid() yet). Setting NOT NULL before that trigger
-- exists would make every insert from the live app start failing the moment
-- this file runs.
--
-- Idempotent: re-running this after TMC's companies row already exists is
-- safe — the insert is skipped and the backfill/NOT NULL steps are no-ops
-- on rows that already have company_id set.

do $$
declare
  v_company_id uuid;
begin
  select id into v_company_id from public.companies where name = 'TMC Mechanical';

  if v_company_id is null then
    insert into public.companies (name) values ('TMC Mechanical')
    returning id into v_company_id;
  end if;

  update public.jobs          set company_id = v_company_id where company_id is null;
  update public.customers     set company_id = v_company_id where company_id is null;
  update public.users         set company_id = v_company_id where company_id is null;
  update public.equipment     set company_id = v_company_id where company_id is null;
  update public.chores        set company_id = v_company_id where company_id is null;
  update public.job_notes     set company_id = v_company_id where company_id is null;
  update public.job_photos    set company_id = v_company_id where company_id is null;
  update public.receipts      set company_id = v_company_id where company_id is null;
  update public.notifications set company_id = v_company_id where company_id is null;
  update public.job_crew      set company_id = v_company_id where company_id is null;

  raise notice 'TMC Mechanical companies.id = %', v_company_id;
end $$;

-- Verify the backfill actually caught everything before running the
-- statements below — each of these should return 0 rows. If any live
-- traffic landed rows between 0001 and here, set_company_id() (0002)
-- should already have filled them in via the TMC-name fallback, but check:
--   select count(*) from jobs where company_id is null;
--   select count(*) from customers where company_id is null;
--   select count(*) from users where company_id is null;
--   select count(*) from equipment where company_id is null;
--   select count(*) from chores where company_id is null;
--   select count(*) from job_notes where company_id is null;
--   select count(*) from job_photos where company_id is null;
--   select count(*) from receipts where company_id is null;
--   select count(*) from notifications where company_id is null;
--   select count(*) from job_crew where company_id is null;

alter table public.jobs          alter column company_id set not null;
alter table public.customers     alter column company_id set not null;
alter table public.users         alter column company_id set not null;
alter table public.equipment     alter column company_id set not null;
alter table public.chores        alter column company_id set not null;
alter table public.job_notes     alter column company_id set not null;
alter table public.job_photos    alter column company_id set not null;
alter table public.receipts      alter column company_id set not null;
alter table public.notifications alter column company_id set not null;
alter table public.job_crew      alter column company_id set not null;
