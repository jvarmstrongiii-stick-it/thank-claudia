# Migrations

This directory exists as an exception to this repo's usual convention (schema
changes are normally ad hoc SQL run directly in the Supabase SQL editor, not
committed anywhere). The multi-tenancy migration is committed here instead
because it touches RLS across 10+ tables and includes a live production
primary-key re-key — worth having reviewable, diffable, and re-runnable
against a sandbox before it touches production. Smaller day-to-day schema
tweaks can stay ad hoc as before; this isn't adopting the Supabase CLI's
migration-tracking machinery.

**You still run these by pasting each file's contents into the Supabase SQL
editor**, in filename order, one at a time — nothing here executes itself.

## Run order and why it's this order

1. **`0001_companies_and_company_id.sql`** — schema only. `companies` table,
   nullable `company_id` on every table, `users.is_admin`, a `NOT VALID`
   FK from `users.id` to `auth.users.id`. Safe any time — nothing enforces
   anything yet.
2. **`0002_functions_and_triggers.sql`** — `current_company_id()`,
   `set_company_id()` (with a fallback to TMC's company by name, so the
   still-unauthenticated pre-Phase-B app keeps writing correctly-scoped
   rows), `handle_new_user()`. Must run **before** step 3, not after — the
   fallback trigger is what makes it safe to set `company_id NOT NULL`.
3. **`0003_backfill_tmc_company.sql`** — creates TMC's own `companies` row,
   backfills `company_id` onto every existing row, sets it `NOT NULL`.
4. **`0004_rls_policies.sql`** — defines every RLS policy but does **not**
   enable RLS on any table. A policy with RLS disabled is inert, so this is
   safe to run any time after step 1 too.
5. **`0005_cutover_runbook.sql`** — not a script, a step-by-step runbook:
   invite real accounts, re-key the 4 existing TMC `users` rows to match
   them (the one genuinely risky step — confirm before running), deploy
   the auth-retrofitted `claudia.html`, *then* enable RLS. Read the whole
   file before starting; some steps are dashboard actions, not SQL.

The gap between steps 4 and 5's RLS-enable is intentional: RLS can't safely
go on until the app is actually sending an authenticated session on every
request, which only happens once Phase B's `claudia.html` is deployed.
Enabling it any earlier would make every list in the app appear empty for
everyone, since the old app never authenticates at all.
