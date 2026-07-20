-- Phase A (multi-tenancy) — step 2 of 5
--
-- current_company_id(): the single function every RLS policy and every
-- auto-scoping trigger is built on.
--
-- set_company_id(): BEFORE INSERT trigger, attached to every actively-used
-- tenant table. This is what lets claudia.html's ~50 scattered, unmodified
-- insert call sites keep working: they never set company_id themselves,
-- this fills it in server-side. Two cases:
--   - Once Phase B ships and someone is logged in via Supabase Auth,
--     current_company_id() resolves to their real company.
--   - Until then (the still-unauthenticated, pre-Phase-B claudia.html,
--     using only the anon key), current_company_id() is null, so this
--     falls back to the company named 'TMC Mechanical' — the only company
--     that exists until Phase C ships. Once a second company exists this
--     fallback becomes ambiguous by name; that's fine, by the time a
--     second company can exist (Phase C), Phase B is long since deployed
--     and every write goes through a real authenticated session, so the
--     fallback branch stops being hit at all in practice. Left in place
--     rather than removed — harmless if never hit, saves a migration.
--
-- handle_new_user(): fires on every new auth.users row (real signups from
-- here on). Branches on signup metadata: no invited_company_id -> creates
-- a brand new company (self-serve signup, Phase C). invited_company_id
-- present -> joins that company instead (invited teammate, Phase D). The
-- client can only ever set company_name/full_name in signUp() metadata —
-- invited_company_id is injected server-side by the invite-teammate Edge
-- Function (Phase D), never by the browser, which is what stops a self-serve
-- signup from claiming membership in an existing company by typing its name.
--
-- Safe to run any time after 0001. Doesn't change app behavior by itself.

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.users where id = auth.uid();
$$;

create or replace function public.set_company_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    new.company_id := coalesce(
      public.current_company_id(),
      (select id from public.companies where name = 'TMC Mechanical' limit 1)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_company_id on public.jobs;
create trigger trg_set_company_id before insert on public.jobs
  for each row execute function public.set_company_id();

drop trigger if exists trg_set_company_id on public.customers;
create trigger trg_set_company_id before insert on public.customers
  for each row execute function public.set_company_id();

drop trigger if exists trg_set_company_id on public.equipment;
create trigger trg_set_company_id before insert on public.equipment
  for each row execute function public.set_company_id();

drop trigger if exists trg_set_company_id on public.chores;
create trigger trg_set_company_id before insert on public.chores
  for each row execute function public.set_company_id();

drop trigger if exists trg_set_company_id on public.job_notes;
create trigger trg_set_company_id before insert on public.job_notes
  for each row execute function public.set_company_id();

drop trigger if exists trg_set_company_id on public.job_photos;
create trigger trg_set_company_id before insert on public.job_photos
  for each row execute function public.set_company_id();

drop trigger if exists trg_set_company_id on public.receipts;
create trigger trg_set_company_id before insert on public.receipts
  for each row execute function public.set_company_id();

drop trigger if exists trg_set_company_id on public.notifications;
create trigger trg_set_company_id before insert on public.notifications
  for each row execute function public.set_company_id();

drop trigger if exists trg_set_company_id on public.job_crew;
create trigger trg_set_company_id before insert on public.job_crew
  for each row execute function public.set_company_id();

-- users is NOT given the generic trigger above — it's populated exclusively
-- by handle_new_user() below, which sets company_id explicitly itself.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  meta jsonb := new.raw_user_meta_data;
begin
  if meta ? 'invited_company_id' then
    v_company_id := (meta ->> 'invited_company_id')::uuid;
    insert into public.users (id, company_id, name, is_admin)
    values (new.id, v_company_id, coalesce(meta ->> 'full_name', new.email), false);
  else
    insert into public.companies (name)
    values (coalesce(meta ->> 'company_name', 'New Company'))
    returning id into v_company_id;

    insert into public.users (id, company_id, name, is_admin)
    values (new.id, v_company_id, coalesce(meta ->> 'full_name', new.email), true);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
