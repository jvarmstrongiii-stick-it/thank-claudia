// warranty-send — sends a job's prepared warranty email to the customer, with the tracker that
// lets their reply be matched back to this exact send (see _shared/warranty-send-core.ts).
//
// Called from claudia.html (WarrantySheet → SEND EMAIL) with the app's anon key, so verify_jwt
// stays ON. The email is rebuilt here from the database rather than taken from the app.
//
// Deploy (only after Jack's go-ahead):
//   supabase functions deploy warranty-send
//   supabase secrets set WARRANTY_REPLY_INBOX=warranty@<domain> WARRANTY_FROM_EMAIL=warranty@<domain> \
//     WARRANTY_FROM_NAME="ABC Mechanical" WARRANTY_EMAIL_PROVIDER=postmark WARRANTY_PROVIDER_KEY=<key>
//   ...and only when ready to email real customers: supabase secrets set WARRANTY_SEND_MODE=live
// Until WARRANTY_SEND_MODE=live, every send is recorded in warranty_outbound as "test" and no
// email leaves the building.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { readSendConfig, sendJobWarrantyEmail, type SendStore, type SendUnitRow } from "../_shared/warranty-send-core.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function supabaseStore(): SendStore {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  return {
    async loadJob(jobId, token) {
      const { data, error } = await db
        .from("warranty_registrations")
        .select("id,status,brand_key,customers(name,email),equipment(id,label,model_number,serial_number,install_date)")
        .eq("job_id", jobId).eq("email_token", token);
      if (error) throw new Error(`loadJob: ${error.message}`);
      const rows = (data ?? []) as Record<string, any>[];
      if (!rows.length) return null;
      const keys = Array.from(new Set(rows.map((r) => r.brand_key).filter(Boolean)));
      const { data: mfs } = keys.length
        ? await db.from("warranty_manufacturers").select("brand_key,display_name,registration_url,url_verified,window_days").in("brand_key", keys)
        : { data: [] };
      const byKey = new Map((mfs ?? []).map((m: any) => [m.brand_key, m]));
      const cust = rows[0].customers ?? {};
      const units: SendUnitRow[] = rows
        .filter((r) => r.equipment)
        .map((r) => ({ registration_id: r.id, status: r.status, equipment: r.equipment, manufacturer: byKey.get(r.brand_key) ?? null }));
      return { customer: cust.name ?? null, email: cust.email ?? null, units };
    },
    async countOutboundSince(since) {
      const { count } = await db.from("warranty_outbound").select("id", { count: "exact", head: true }).gte("created_at", since).neq("status", "test");
      return count ?? 0;
    },
    async hasSent(token) {
      const { data } = await db.from("warranty_outbound").select("id").eq("email_token", token).eq("status", "sent").limit(1);
      return !!(data && data.length);
    },
    async insertOutbound(row) {
      const { data, error } = await db.from("warranty_outbound").insert(row).select("id").single();
      if (error) throw new Error(`insertOutbound: ${error.message}`);
      return data.id as string;
    },
    async markSent(ids, fields) {
      const { error } = await db.from("warranty_registrations")
        .update({ status: "sent", sent_at: fields.sent_at, outbound_id: fields.outbound_id })
        .in("id", ids).eq("status", "email_prepared");
      if (error) throw new Error(`markSent: ${error.message}`);
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad JSON" }); }
  try {
    const cfg = readSendConfig((k) => Deno.env.get(k));
    const out = await sendJobWarrantyEmail(supabaseStore(), body, cfg, { fetch });
    return json(out.http, out.body);
  } catch (e) {
    console.error("warranty-send", e);
    return json(500, { ok: false, error: "send failed" });
  }
});
