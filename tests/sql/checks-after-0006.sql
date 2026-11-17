-- Assertions run after 0006 (applied twice). Any failure raises and stops psql.
do $$
declare n int; s text; b boolean; d date;
begin
  select warranty_status into s from public.equipment where label = 'Old unit';
  assert s = 'registered', 'backfill: already-registered unit should read registered, got ' || s;
  select warranty_status into s from public.equipment where label = 'New unit';
  assert s = 'not_sent', 'new column default';

  select count(*) into n from public.warranty_manufacturers;
  assert n >= 30, 'seed rows: ' || n;
  select count(*) into n from public.warranty_manufacturers where url_verified and registration_url is null;
  assert n = 0, 'a verified row has no URL';
  select url_verified into b from public.warranty_manufacturers where brand_key = 'comfortmaker';
  assert not b, 'comfortmaker must stay unverified';

  -- Registration drives the equipment row.
  insert into public.warranty_registrations (equipment_id, job_id, customer_id, brand_key, email_token, status)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'goodman', 'K7M3QX', 'email_prepared');
  select warranty_status into s from public.equipment where label = 'New unit';
  assert s = 'email_prepared', 'sync on insert, got ' || s;
  update public.warranty_registrations set status = 'registered', registered_via = 'auto_match' where email_token = 'K7M3QX';
  select warranty_status, warranty_registered, warranty_registered_date into s, b, d from public.equipment where label = 'New unit';
  assert s = 'registered' and b and d is not null, 'sync on registered';

  begin
    update public.warranty_registrations set status = 'bogus';
    assert false, 'status check constraint missing';
  exception when check_violation then null;
  end;
end $$;

-- The app's public key (anon): can read makers, write registrations, review inbound;
-- can't delete registrations and can't see raw email bodies.
insert into public.warranty_inbound_raw (provider, payload) values ('test', '{"secret":"body"}');
insert into public.warranty_inbound (message_id, status) values ('m-1', 'needs_review');
insert into public.warranty_outbound (email_token, status, message_ids, to_email)
  values ('K7M3QX', 'sent', array['warranty.k7m3qx.ab12@abcmech.com', 'pm-uuid-777'], 'pat@example.com');
set role anon;
do $$
declare n int;
begin
  select count(*) into n from public.warranty_manufacturers; assert n >= 30, 'anon reads makers';
  select count(*) into n from public.warranty_inbound_raw;   assert n = 0, 'anon must not see raw emails';
  update public.warranty_inbound set status = 'resolved_rejected' where message_id = 'm-1';
  get diagnostics n = row_count; assert n = 1, 'anon can review inbound';
  delete from public.warranty_registrations; get diagnostics n = row_count; assert n = 0, 'anon must not delete registrations';
  update public.warranty_registrations set status = 'sent'; get diagnostics n = row_count; assert n = 1, 'anon can update registrations';
  -- The tracker lookup the inbound function does (array overlap on the GIN index).
  select count(*) into n from public.warranty_outbound where message_ids && array['pm-uuid-777'];
  assert n = 1, 'anon reads send history / tracker lookup';
  begin
    insert into public.warranty_outbound (email_token, status) values ('ZZZZZZ', 'sent');
    assert false, 'anon must not write send history';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'ALL 0006 CHECKS PASSED' as result;
