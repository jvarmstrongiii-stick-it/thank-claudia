-- 0006_warranty_registration.sql — warranty-registration workflow (APP_REV 266)
--
-- Independent of the multi-tenancy series (0001-0005): safe to run whether or not those
-- have been run, and re-runnable (every statement is IF NOT EXISTS / OR REPLACE / ON CONFLICT).
-- Paste into the Supabase SQL editor for the "Claudia" project, like the others.
-- claudia.html r266 degrades gracefully until this runs (warranty prep just no-ops with a
-- console warning), so the app and this file can ship in either order.
--
-- If 0001-0004 are run LATER, add the new tables to their company_id / set_company_id() /
-- RLS lists: warranty_registrations, warranty_outbound, warranty_inbound, warranty_inbound_raw
-- (warranty_manufacturers is global reference data, like motor_crossref — no company_id).

-- ── 1. Equipment: a single at-a-glance status ───────────────────────────────
-- The existing warranty_registered / warranty_registered_date columns stay exactly as they
-- are (the WarrantySheet and EquipEditSheet still read/write them); the trigger in step 6
-- keeps them in sync whenever a registration becomes 'registered'.
alter table public.equipment add column if not exists warranty_status text not null default 'not_sent';
alter table public.equipment add column if not exists warranty_status_at timestamptz;

do $$ begin
  alter table public.equipment add constraint equipment_warranty_status_check
    check (warranty_status in ('not_sent','email_prepared','sent','registered','needs_review'));
exception when duplicate_object then null; end $$;

update public.equipment
   set warranty_status = 'registered', warranty_status_at = coalesce(warranty_status_at, now())
 where warranty_registered is true and warranty_status <> 'registered';

-- ── 2. Manufacturer → official registration page lookup ─────────────────────
-- url_verified = false means the link has NOT been confirmed on the manufacturer's own
-- site; the app then holds that customer email for review instead of guessing a link.
create table if not exists public.warranty_manufacturers (
  id               uuid primary key default gen_random_uuid(),
  brand_key        text not null unique,          -- lower-case canonical key, e.g. 'daikin'
  display_name     text not null,
  aliases          text[] not null default '{}',  -- other spellings seen on nameplates / OCR
  email_domains    text[] not null default '{}',  -- sender domains of their confirmation mail
  registration_url text,
  url_verified     boolean not null default false,
  verified_at      date,
  verified_note    text,                          -- where/how it was verified
  window_days      int,                           -- registration window, if the maker states one
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── 3. One registration row per installed unit ──────────────────────────────
create table if not exists public.warranty_registrations (
  id                  uuid primary key default gen_random_uuid(),
  equipment_id        uuid not null unique references public.equipment(id) on delete cascade,
  job_id              uuid references public.jobs(id) on delete set null,
  customer_id         uuid references public.customers(id) on delete cascade,
  brand_key           text,                       -- warranty_manufacturers.brand_key, null = unknown maker
  email_token         text,                       -- job ref code (shared by a job's units), e.g. 'K7M3QX'
  status              text not null default 'not_sent'
                      check (status in ('not_sent','email_prepared','sent','registered','needs_review')),
  hold_reasons        text[] not null default '{}', -- why it needs review, e.g. {unverified_url,no_customer_email}
  registration_url    text,
  email_to            text,
  email_subject       text,
  email_body          text,
  prepared_at         timestamptz,
  sent_at             timestamptz,
  registered_at       timestamptz,
  registered_via      text check (registered_via in ('auto_match','manual_review','manual')),
  confirmation_number text,
  matched_inbound_id  uuid,
  prepared_by         uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists warranty_registrations_token_idx  on public.warranty_registrations (email_token);
create index if not exists warranty_registrations_job_idx    on public.warranty_registrations (job_id);
create index if not exists warranty_registrations_status_idx on public.warranty_registrations (status);

-- ── 4. Inbound confirmation emails ──────────────────────────────────────────
-- Raw provider payloads: service-role only (RLS on, no policies) — full email bodies can
-- carry more personal detail than the app needs, and the app's anon key is public.
create table if not exists public.warranty_inbound_raw (
  id          uuid primary key default gen_random_uuid(),
  provider    text,
  message_id  text,
  payload     jsonb,
  received_at timestamptz not null default now()
);

-- What the review queue shows: parsed fields + a 1,500-char snippet, no attachments.
create table if not exists public.warranty_inbound (
  id                       uuid primary key default gen_random_uuid(),
  raw_id                   uuid references public.warranty_inbound_raw(id) on delete set null,
  provider                 text,
  message_id               text unique,
  received_at              timestamptz not null default now(),
  from_email               text,
  to_addresses             text[] not null default '{}',
  subject                  text,
  snippet                  text,
  parsed                   jsonb not null default '{}',
  status                   text not null default 'needs_review'
                           check (status in ('auto_matched','needs_review','unmatched','resolved_matched','resolved_rejected')),
  confidence               numeric(4,2),
  summary                  text,
  candidates               jsonb not null default '[]',
  matched_registration_ids uuid[] not null default '{}',
  reviewed_by              uuid references public.users(id) on delete set null,
  reviewed_at              timestamptz,
  review_note              text
);
create index if not exists warranty_inbound_status_idx on public.warranty_inbound (status, received_at desc);

do $$ begin
  alter table public.warranty_registrations
    add constraint warranty_registrations_matched_inbound_fkey
    foreign key (matched_inbound_id) references public.warranty_inbound(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Every warranty email we send (or, in test mode, would have sent). message_ids holds our own
-- Message-ID plus the provider's id, so a customer's reply (In-Reply-To / References) is tied
-- back to this exact send — the tracker. Written only by the warranty-send Edge Function.
create table if not exists public.warranty_outbound (
  id               uuid primary key default gen_random_uuid(),
  email_token      text not null,
  job_id           uuid references public.jobs(id) on delete set null,
  registration_ids uuid[] not null default '{}',
  to_email         text,
  reply_to         text,
  subject          text,
  body             text,
  provider         text,
  status           text not null check (status in ('test','sent','failed')),
  message_ids      text[] not null default '{}',
  error            text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index if not exists warranty_outbound_token_idx on public.warranty_outbound (email_token);
create index if not exists warranty_outbound_msgids_idx on public.warranty_outbound using gin (message_ids);

alter table public.warranty_registrations add column if not exists outbound_id uuid references public.warranty_outbound(id) on delete set null;
alter table public.warranty_inbound       add column if not exists outbound_id uuid references public.warranty_outbound(id) on delete set null;

-- ── 5. updated_at ───────────────────────────────────────────────────────────
create or replace function public.warranty_touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists warranty_registrations_touch on public.warranty_registrations;
create trigger warranty_registrations_touch before update on public.warranty_registrations
  for each row execute function public.warranty_touch_updated_at();
drop trigger if exists warranty_manufacturers_touch on public.warranty_manufacturers;
create trigger warranty_manufacturers_touch before update on public.warranty_manufacturers
  for each row execute function public.warranty_touch_updated_at();

-- ── 6. Keep equipment's status columns in sync with its registration ────────
-- One direction only (registration → equipment), so there's no trigger loop. Moving a
-- registration to 'registered' also sets the legacy warranty_registered flag + date that
-- warrantyStatus() / the 12-year expiry display already use.
create or replace function public.warranty_sync_equipment() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    update public.equipment e
       set warranty_status    = new.status,
           warranty_status_at = now(),
           warranty_registered = case when new.status = 'registered' then true else e.warranty_registered end,
           warranty_registered_date = case
             when new.status = 'registered' then coalesce(e.warranty_registered_date, (coalesce(new.registered_at, now()) at time zone 'America/New_York')::date)
             else e.warranty_registered_date end,
           updated_at = now()
     where e.id = new.equipment_id;
  end if;
  return new;
end $$;

drop trigger if exists warranty_registrations_sync on public.warranty_registrations;
create trigger warranty_registrations_sync after insert or update of status on public.warranty_registrations
  for each row execute function public.warranty_sync_equipment();

-- ── 7. Row-level security (same open-anon model the rest of the app uses today) ──
alter table public.warranty_manufacturers enable row level security;
alter table public.warranty_registrations enable row level security;
alter table public.warranty_inbound       enable row level security;
alter table public.warranty_inbound_raw   enable row level security;  -- no policies: service role only
alter table public.warranty_outbound      enable row level security;

drop policy if exists warranty_manufacturers_read on public.warranty_manufacturers;
create policy warranty_manufacturers_read on public.warranty_manufacturers for select to anon, authenticated using (true);

drop policy if exists warranty_registrations_read   on public.warranty_registrations;
drop policy if exists warranty_registrations_insert on public.warranty_registrations;
drop policy if exists warranty_registrations_update on public.warranty_registrations;
create policy warranty_registrations_read   on public.warranty_registrations for select to anon, authenticated using (true);
create policy warranty_registrations_insert on public.warranty_registrations for insert to anon, authenticated with check (true);
create policy warranty_registrations_update on public.warranty_registrations for update to anon, authenticated using (true) with check (true);
-- no delete policy: rows go away only via equipment / customer cascade

-- The app reviews inbound mail (select + resolve) but never creates or deletes it — only
-- the warranty-inbound Edge Function (service role) inserts.
drop policy if exists warranty_inbound_read   on public.warranty_inbound;
drop policy if exists warranty_inbound_review on public.warranty_inbound;
create policy warranty_inbound_read   on public.warranty_inbound for select to anon, authenticated using (true);
create policy warranty_inbound_review on public.warranty_inbound for update to anon, authenticated using (true) with check (true);

-- The app shows send history but never writes it — only warranty-send (service role) does.
drop policy if exists warranty_outbound_read on public.warranty_outbound;
create policy warranty_outbound_read on public.warranty_outbound for select to anon, authenticated using (true);

-- ── 8. Seed manufacturers ───────────────────────────────────────────────────
-- Verified = the registration page itself (or a manufacturer page linking straight to it)
-- was loaded on the manufacturer's own domain on the verified_at date. Unverified rows keep
-- their customer emails on hold for review. Edit in the Table Editor as links change.
insert into public.warranty_manufacturers
  (brand_key, display_name, aliases, email_domains, registration_url, url_verified, verified_at, verified_note, window_days)
values
  ('daikin', 'Daikin', array['daikin comfort','daikin industries','daikin ac']::text[], array['daikincomfort.com','goodmanmfg.com']::text[], 'https://warranty.goodmanmfg.com/newregistration/', true, '2026-11-16'::date, 'daikincomfort.com/warranty-registration links to this shared Daikin/Goodman/Amana portal (page title "Daikin - Product Registration")', null),
  ('goodman', 'Goodman', array['goodman manufacturing','goodman mfg']::text[], array['goodmanmfg.com']::text[], 'https://warranty.goodmanmfg.com/newregistration/', true, '2026-11-16'::date, 'goodmanmfg.com warranty page links "Product Registration" here; 60 days for 10-yr coverage', 60),
  ('amana', 'Amana', array['amana hac','amana heating and air conditioning']::text[], array['amana-hac.com','goodmanmfg.com']::text[], 'https://warranty.goodmanmfg.com/newregistration/', true, '2026-11-16'::date, 'amana-hac.com/product-registration links here', 60),
  ('mitsubishi', 'Mitsubishi Electric', array['mitsubishi electric','mitsubishi electric trane','mitsubishi electric trane hvac','mitsubishi electric cooling and heating','mehvac']::text[], array['mitsubishicomfort.com','registermehvac.com','meus.mea.com']::text[], 'https://registermehvac.com/start.aspx', true, '2026-11-16'::date, '"Register now" on mitsubishicomfort.com/register-your-product links here (target page did not load during check); 12-yr residential needs 90 days + qualifying installer', 90),
  ('carrier', 'Carrier', array['carrier corporation']::text[], array['carrier.com']::text[], 'https://productregistration.carrier.com/Public/Home?brand=carrier', true, '2026-11-16'::date, 'carrier.com homeowner warranty page links here', 90),
  ('bryant', 'Bryant', array['bryant heating and cooling']::text[], array['bryant.com']::text[], 'https://productregistration.bryant.com/Public/Home?brand=bryant', true, '2026-11-16'::date, 'bryant.com warranty-information page "Register My Product" links here', 90),
  ('payne', 'Payne', '{}'::text[], array['payne.com']::text[], 'https://productregistration.payne.com/', true, '2026-11-16'::date, 'payne.com registration-warranty page links here (portal itself not fetched)', null),
  ('lennox', 'Lennox', array['lennox industries','lennox international']::text[], array['lennox.com','warrantyyourway.com']::text[], 'https://www.warrantyyourway.com/', true, '2026-11-16'::date, 'lennox.com homeowner Product Registration page links its Warranty Your Way portal here', 60),
  ('trane', 'Trane', array['trane technologies','trane us']::text[], array['trane.com']::text[], 'https://www.trane.com/residential/en/resources/warranty-and-registration/', true, '2026-11-16'::date, 'trane.com page with the Register new product button; Trane''s warranty PDF names it', 60),
  ('american_standard', 'American Standard', array['american standard','american standard heating and air conditioning','american standard air']::text[], array['americanstandardair.com']::text[], 'https://www.americanstandardair.com/resources/warranty-and-registration/', true, '2026-11-16'::date, 'americanstandardair.com page with the Register new product button', 60),
  ('rheem', 'Rheem', array['rheem manufacturing','rheem manufacturing company']::text[], array['rheem.com','registermyunit.com']::text[], 'https://rheem.registermyunit.com/en-US/warranty/brand?brand=rheem', true, '2026-11-16'::date, 'rheem.com/warranties "Register Your Product" links here', null),
  ('ruud', 'Ruud', '{}'::text[], array['ruud.com','registermyunit.com']::text[], 'https://ruud.registermyunit.com/en-US/warranty/wizard?brand=ruud', true, '2026-11-16'::date, 'ruud.com/homeowners "Product Registration" links here', null),
  ('lg', 'LG', array['lg electronics','lg hvac','lg air conditioning']::text[], array['lghvac.com','lg-dfs-warranty.com']::text[], 'https://lg-dfs-warranty.com/register', true, '2026-11-16'::date, 'lghvac.com/warranty-page "Register Now" links here; installs over 60 days old get shorter coverage. Commercial Multi V VRF registers through distributor startup docs instead', 60),
  ('york', 'York', array['york international']::text[], array['york.com','jci.com','bosch-hcgroup.com']::text[], 'https://wtyprod.jci.com/jci/warranty/public/warrantyreg/index.html', true, '2026-11-16'::date, 'york.bosch-hcgroup.com warranty page "Register Now" links here', 90),
  ('coleman', 'Coleman', array['coleman hvac']::text[], array['colemanac.com','jci.com']::text[], 'https://wtyprod.jci.com/jci/warranty/public/warrantyreg/index.html', true, '2026-11-16'::date, 'colemanac.com warranty-and-registration "Register Now" links here', 90),
  ('luxaire', 'Luxaire', '{}'::text[], array['luxaire.com','jci.com']::text[], 'https://wtyprod.jci.com/jci/warranty/public/warrantyreg/index.html', true, '2026-11-16'::date, 'luxaire.com warranty-registration "Register Now" links here', 90),
  ('johnson_controls', 'Johnson Controls', array['johnson controls','jci','johnson controls inc']::text[], array['jci.com']::text[], 'https://wtyprod.jci.com/jci/warranty/public/warrantyreg/index.html', true, '2026-11-16'::date, 'Johnson Controls'' own portal (jci.com), linked from the York, Coleman and Luxaire pages', 90),
  ('icp', 'International Comfort Products', array['international comfort products','icp','international comfort products llc']::text[], array['icpusa.com']::text[], 'https://productregistration2.icpusa.com', true, '2026-11-16'::date, 'ICP''s homeowner portal, linked from heil-hvac.com and tempstar.com registration pages', 90),
  ('heil', 'Heil', array['heil hvac']::text[], array['heil-hvac.com','icpusa.com']::text[], 'https://productregistration2.icpusa.com', true, '2026-11-16'::date, 'heil-hvac.com product-registration page links here', 90),
  ('tempstar', 'Tempstar', '{}'::text[], array['tempstar.com','icpusa.com']::text[], 'https://productregistration2.icpusa.com', true, '2026-11-16'::date, 'tempstar.com product-registration page links here', 90),
  ('comfortmaker', 'Comfortmaker', '{}'::text[], array['icpusa.com']::text[], 'https://productregistration2.icpusa.com', false, '2026-11-16'::date, 'Listed in the ICP portal''s brand list, but no comfortmaker.com page linking to it was found', null),
  ('arcoaire', 'Arcoaire', '{}'::text[], array['icpusa.com']::text[], 'https://productregistration2.icpusa.com', false, '2026-11-16'::date, 'Listed in the ICP portal''s brand list, but no arcoaire.com page linking to it was found', null),
  ('keeprite', 'KeepRite', array['keep rite']::text[], array['icpusa.com']::text[], 'https://productregistration2.icpusa.com', false, '2026-11-16'::date, 'Listed in the ICP portal''s brand list, but no keeprite.com page linking to it was found; Canadian terms may differ', null),
  ('bradford_white', 'Bradford White', array['bradford white corporation','bradford white water heaters']::text[], array['bradfordwhite.com']::text[], 'https://warrantycenter.bradfordwhite.com/', true, '2026-11-16'::date, 'bradfordwhite.com/my-water-heater "Register my warranty" links here', null),
  ('gree', 'Gree', array['gree electric','gree comfort']::text[], array['greecomfort.com']::text[], 'https://www.greecomfort.com/warranty-program', true, '2026-11-16'::date, 'Registration form is on the greecomfort.com warranty-program page itself (US products)', null),
  ('fujitsu', 'Fujitsu', array['fujitsu general','fujitsu halcyon','airstage']::text[], array['fujitsu-general.com','airstagehvac.com']::text[], 'https://access.airstagehvac.com/en-US/warranty/register', true, '2026-11-16'::date, 'fujitsu-general.com/us/support redirects to airstagehvac.com (US Fujitsu/AIRSTAGE distributor), which links Product Registration here', null),
  ('bosch', 'Bosch', array['bosch thermotechnology','bosch home comfort']::text[], array['bosch-homecomfort.com','boschprohvac.com']::text[], 'https://boschprohvac.com/register/', true, '2026-11-16'::date, 'bosch-homecomfort.com/us "Homeowner Product Registration" links here', 90),
  ('aaon', 'AAON', '{}'::text[], array['aaon.com']::text[], null, false, null, 'Commercial maker: no owner registration program found; warranty claims go through the local AAON rep', null),
  ('heatcraft', 'Heatcraft', array['heatcraft refrigeration products','heatcraft refrigeration products llc','heatcraft rpd']::text[], array['heatcraftrpd.com']::text[], null, false, null, 'Commercial refrigeration: no product registration found; claims via hub.heatcraftrpd.com', null),
  ('reznor', 'Reznor', array['itt reznor']::text[], array['reznorhvac.com']::text[], null, false, null, 'No product registration found; returns via distributors or Reznor Customer Service', null)
on conflict (brand_key) do update set
  display_name = excluded.display_name, aliases = excluded.aliases, email_domains = excluded.email_domains,
  registration_url = excluded.registration_url, url_verified = excluded.url_verified,
  verified_at = excluded.verified_at, verified_note = excluded.verified_note, window_days = excluded.window_days;
