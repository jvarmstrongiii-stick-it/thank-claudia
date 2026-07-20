-- Phase A (multi-tenancy) — step 1 of 5
--
-- Adds the companies table and a nullable company_id column to every table.
-- Safe to run against production immediately: no RLS is touched here, no
-- column is NOT NULL yet, nothing in claudia.html's behavior changes.
--
-- Run in the Supabase SQL editor, in order, as one statement batch.
-- See db/migrations/README.md for the full run order and why it's split
-- this way.

-- ── companies ────────────────────────────────────────────────────────────
create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  status     text not null default 'active', -- 'active' | 'suspended' — no billing tie-in yet
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── company_id on every actively-used table ─────────────────────────────
-- Nullable for now — backfilled onto TMC's existing rows in 0002, then
-- flipped to NOT NULL there once the backfill is verified.
alter table public.jobs          add column if not exists company_id uuid references public.companies(id);
alter table public.customers     add column if not exists company_id uuid references public.companies(id);
alter table public.users         add column if not exists company_id uuid references public.companies(id);
alter table public.equipment     add column if not exists company_id uuid references public.companies(id);
alter table public.chores        add column if not exists company_id uuid references public.companies(id);
alter table public.job_notes     add column if not exists company_id uuid references public.companies(id);
alter table public.job_photos    add column if not exists company_id uuid references public.companies(id);
alter table public.receipts      add column if not exists company_id uuid references public.companies(id);
alter table public.notifications add column if not exists company_id uuid references public.companies(id);
alter table public.job_crew      add column if not exists company_id uuid references public.companies(id);

create index if not exists idx_jobs_company_id          on public.jobs(company_id);
create index if not exists idx_customers_company_id      on public.customers(company_id);
create index if not exists idx_users_company_id          on public.users(company_id);
create index if not exists idx_equipment_company_id      on public.equipment(company_id);
create index if not exists idx_chores_company_id         on public.chores(company_id);
create index if not exists idx_job_notes_company_id      on public.job_notes(company_id);
create index if not exists idx_job_photos_company_id     on public.job_photos(company_id);
create index if not exists idx_receipts_company_id       on public.receipts(company_id);
create index if not exists idx_notifications_company_id  on public.notifications(company_id);
create index if not exists idx_job_crew_company_id       on public.job_crew(company_id);

-- ── company_id on tables the app doesn't use yet ────────────────────────
-- Lower priority (nothing reads/writes these today) — added now anyway so
-- wiring one up later doesn't need its own migration. Left nullable
-- indefinitely; no backfill, no NOT NULL, no RLS in this pass.
alter table public.job_equipment     add column if not exists company_id uuid references public.companies(id);
alter table public.job_components    add column if not exists company_id uuid references public.companies(id);
alter table public.components        add column if not exists company_id uuid references public.companies(id);
alter table public.line_items        add column if not exists company_id uuid references public.companies(id);
alter table public.job_status_history add column if not exists company_id uuid references public.companies(id);
alter table public.sync_queue        add column if not exists company_id uuid references public.companies(id);

-- ── users: admin flag + future link to auth.users ───────────────────────
alter table public.users add column if not exists is_admin boolean not null default false;

-- users.id will become the SAME uuid as auth.users.id (not a separate FK
-- column) — see the "Key Architecture Decisions" note in CLAUDE.md for why.
-- Added as NOT VALID here: this enforces the link on every *new* row
-- (including every row handle_new_user() creates from here on) without
-- failing on TMC's 4 existing users.id values, which don't match any
-- auth.users row yet. 0005 runs VALIDATE CONSTRAINT after those 4 rows
-- are re-keyed to match real auth.users ids.
alter table public.users
  drop constraint if exists users_id_fkey,
  add constraint users_id_fkey foreign key (id) references auth.users(id) on delete cascade not valid;

-- New users.id values are assigned by handle_new_user() from auth.users.id,
-- not generated independently.
alter table public.users alter column id drop default;
