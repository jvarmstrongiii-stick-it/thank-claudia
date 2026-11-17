-- Minimal stand-in for the live Claudia tables that 0006 touches, plus Supabase's roles and
-- default grants. Used only to test the migration on a throwaway local Postgres.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.users (id uuid primary key default gen_random_uuid(), name text);
create table public.customers (id uuid primary key default gen_random_uuid(), name text, email text);
create table public.jobs (id uuid primary key default gen_random_uuid(), customer_id uuid references public.customers(id));
create table public.equipment (
  id uuid primary key default gen_random_uuid(), customer_id uuid references public.customers(id),
  job_id uuid references public.jobs(id), label text, brand text, model_number text, serial_number text,
  install_date date, warranty_registered boolean default false, warranty_registered_date date,
  created_at timestamptz default now(), updated_at timestamptz default now());
-- One unit already registered the old way, to check the backfill.
insert into public.customers (id, name, email) values ('00000000-0000-0000-0000-0000000000c1', 'Smith, Pat', 'pat@example.com');
insert into public.jobs (id, customer_id) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1')
  on conflict do nothing;
insert into public.equipment (id, customer_id, job_id, label, warranty_registered, warranty_registered_date)
  values ('00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Old unit', true, '2025-05-01'),
         ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'New unit', false, null);
