-- Phase A (multi-tenancy) — step 4 of 5
--
-- Defines the RLS policies for every tenant table, but deliberately does
-- NOT enable row level security yet. A CREATE POLICY with RLS still
-- disabled is completely inert — this file is safe to run any time after
-- 0001, with zero effect on the live app.
--
-- DO NOT run "alter table ... enable row level security" until Phase B's
-- login-gated claudia.html is deployed and confirmed working. Doing it
-- before that point would blank every list in the app for everyone: the
-- still-live, pre-Phase-B claudia.html only ever uses the anon key with no
-- session, so current_company_id() (auth.uid() is null) would make every
-- "using (company_id = current_company_id())" check evaluate to
-- "company_id = NULL", which is never true — nobody would be able to read
-- anything. That ENABLE step lives in 0005_cutover_runbook.sql, ordered
-- correctly relative to the Phase B app deploy.
--
-- (Postgres has no "CREATE POLICY IF NOT EXISTS" — every policy below is
-- dropped-then-recreated instead, so this file is safe to re-run.)

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select using (id = public.current_company_id());
-- Deliberately no insert/update/delete policy on companies at all — the
-- only way a company row is ever created is handle_new_user() (0002),
-- which runs as SECURITY DEFINER and bypasses RLS. This is what stops a
-- signed-in user from creating or renaming an arbitrary company directly.

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs
  for select using (company_id = public.current_company_id());
drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs
  for insert with check (company_id = public.current_company_id());
drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs
  for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists jobs_delete on public.jobs;
create policy jobs_delete on public.jobs
  for delete using (company_id = public.current_company_id());

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select using (company_id = public.current_company_id());
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert with check (company_id = public.current_company_id());
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers
  for delete using (company_id = public.current_company_id());

drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select using (company_id = public.current_company_id());
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
-- No client-facing insert/delete policy on users — rows are only ever
-- created by handle_new_user() (SECURITY DEFINER, bypasses RLS) and
-- deleted, if ever, by hand via the dashboard.

drop policy if exists equipment_select on public.equipment;
create policy equipment_select on public.equipment
  for select using (company_id = public.current_company_id());
drop policy if exists equipment_insert on public.equipment;
create policy equipment_insert on public.equipment
  for insert with check (company_id = public.current_company_id());
drop policy if exists equipment_update on public.equipment;
create policy equipment_update on public.equipment
  for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists equipment_delete on public.equipment;
create policy equipment_delete on public.equipment
  for delete using (company_id = public.current_company_id());

drop policy if exists chores_select on public.chores;
create policy chores_select on public.chores
  for select using (company_id = public.current_company_id());
drop policy if exists chores_insert on public.chores;
create policy chores_insert on public.chores
  for insert with check (company_id = public.current_company_id());
drop policy if exists chores_update on public.chores;
create policy chores_update on public.chores
  for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists chores_delete on public.chores;
create policy chores_delete on public.chores
  for delete using (company_id = public.current_company_id());

drop policy if exists job_notes_select on public.job_notes;
create policy job_notes_select on public.job_notes
  for select using (company_id = public.current_company_id());
drop policy if exists job_notes_insert on public.job_notes;
create policy job_notes_insert on public.job_notes
  for insert with check (company_id = public.current_company_id());
drop policy if exists job_notes_update on public.job_notes;
create policy job_notes_update on public.job_notes
  for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists job_notes_delete on public.job_notes;
create policy job_notes_delete on public.job_notes
  for delete using (company_id = public.current_company_id());

drop policy if exists job_photos_select on public.job_photos;
create policy job_photos_select on public.job_photos
  for select using (company_id = public.current_company_id());
drop policy if exists job_photos_insert on public.job_photos;
create policy job_photos_insert on public.job_photos
  for insert with check (company_id = public.current_company_id());
drop policy if exists job_photos_update on public.job_photos;
create policy job_photos_update on public.job_photos
  for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists job_photos_delete on public.job_photos;
create policy job_photos_delete on public.job_photos
  for delete using (company_id = public.current_company_id());

drop policy if exists receipts_select on public.receipts;
create policy receipts_select on public.receipts
  for select using (company_id = public.current_company_id());
drop policy if exists receipts_insert on public.receipts;
create policy receipts_insert on public.receipts
  for insert with check (company_id = public.current_company_id());
drop policy if exists receipts_update on public.receipts;
create policy receipts_update on public.receipts
  for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists receipts_delete on public.receipts;
create policy receipts_delete on public.receipts
  for delete using (company_id = public.current_company_id());

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (company_id = public.current_company_id());
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert with check (company_id = public.current_company_id());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete using (company_id = public.current_company_id());

drop policy if exists job_crew_select on public.job_crew;
create policy job_crew_select on public.job_crew
  for select using (company_id = public.current_company_id());
drop policy if exists job_crew_insert on public.job_crew;
create policy job_crew_insert on public.job_crew
  for insert with check (company_id = public.current_company_id());
drop policy if exists job_crew_update on public.job_crew;
create policy job_crew_update on public.job_crew
  for update using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists job_crew_delete on public.job_crew;
create policy job_crew_delete on public.job_crew
  for delete using (company_id = public.current_company_id());
