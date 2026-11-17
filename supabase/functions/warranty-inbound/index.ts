// warranty-inbound — receives customers' REPLIES to the warranty email (Reply-To: warranty+CODE@…)
// from an inbound-email provider webhook, ties each reply back to the send it answers (the
// tracker), matches it to equipment, and auto-marks a registration as registered only when
// confidently matched. Everything else lands in the app's WARRANTY REVIEW queue.
//
// Deploy (only after Jack's go-ahead):
//   supabase functions deploy warranty-inbound --no-verify-jwt
//   supabase secrets set WARRANTY_INBOUND_SECRET=<long random string>
//   optional: supabase secrets set WARRANTY_AUTO_THRESHOLD=80
// verify_jwt must be off (see supabase/config.toml) because email providers can't send a
// Supabase JWT — the shared secret (header, ?key= or basic-auth password) is the gate instead.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase automatically.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  extractSecret,
  normalizeInbound,
  processInboundEmail,
  safeEqual,
  type OutboundRow,
  type RegistrationRow,
  type WarrantyStore,
} from "../_shared/warranty-inbound-core.ts";

const MAX_BODY_BYTES = 2_000_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function supabaseStore(): WarrantyStore {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  return {
    async findInboundByMessageId(messageId) {
      const { data } = await db.from("warranty_inbound").select("id,status").eq("message_id", messageId).maybeSingle();
      return data ?? null;
    },
    async insertRaw(row) {
      const { data, error } = await db.from("warranty_inbound_raw").insert(row).select("id").single();
      if (error) { console.error("insertRaw", error); return null; }
      return data.id;
    },
    async insertInbound(row) {
      const { data, error } = await db.from("warranty_inbound").insert(row).select("id").single();
      if (error) throw new Error(`insertInbound: ${error.message}`);
      return data.id;
    },
    async loadManufacturers() {
      const { data, error } = await db.from("warranty_manufacturers").select("brand_key,display_name,aliases,email_domains");
      if (error) throw new Error(`loadManufacturers: ${error.message}`);
      return data ?? [];
    },
    async loadRegistrations() {
      // Small table (one row per installed unit) — load the recent ones and score in memory.
      const since = new Date(Date.now() - 2 * 365 * 86400000).toISOString();
      const { data, error } = await db
        .from("warranty_registrations")
        .select("id,job_id,email_token,status,brand_key,equipment(serial_number,model_number),customers(name,email)")
        .gte("created_at", since)
        .limit(5000);
      if (error) throw new Error(`loadRegistrations: ${error.message}`);
      return (data ?? []) as unknown as RegistrationRow[];
    },
    async markRegistered(ids, fields) {
      const { error } = await db
        .from("warranty_registrations")
        .update({
          status: "registered",
          registered_at: new Date().toISOString(),
          registered_via: "auto_match",
          confirmation_number: fields.confirmation_number,
          matched_inbound_id: fields.matched_inbound_id,
          hold_reasons: [],
        })
        .in("id", ids)
        .neq("status", "registered");
      if (error) throw new Error(`markRegistered: ${error.message}`);
    },
    async findOutbound({ threadIds, tokens }) {
      const rows: OutboundRow[] = [];
      const cols = "id,email_token,to_email,message_ids";
      if (threadIds.length) {
        const { data, error } = await db.from("warranty_outbound").select(cols).overlaps("message_ids", threadIds).limit(20);
        if (error) console.error("findOutbound(thread)", error); else rows.push(...((data ?? []) as OutboundRow[]));
      }
      if (tokens.length) {
        const { data, error } = await db.from("warranty_outbound").select(cols).in("email_token", tokens).limit(20);
        if (error) console.error("findOutbound(token)", error); else rows.push(...((data ?? []) as OutboundRow[]));
      }
      return Array.from(new Map(rows.map((r) => [r.id, r])).values());
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const secret = Deno.env.get("WARRANTY_INBOUND_SECRET") || "";
  const url = new URL(req.url);
  const given = extractSecret(req.headers, url) || "";
  if (!secret || secret.length < 16 || !safeEqual(given, secret)) return json(401, { error: "unauthorized" });

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) return json(413, { error: "too large" });

  let body: Record<string, unknown> = {};
  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("application/json")) {
      body = await req.json();
    } else if (ctype.includes("multipart/form-data") || ctype.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      for (const [k, v] of form.entries()) if (typeof v === "string") body[k] = v; // attachments ignored
    } else {
      return json(415, { error: "unsupported content type" });
    }
  } catch (e) {
    return json(400, { error: `bad body: ${(e as Error).message}` });
  }

  try {
    const threshold = Number(Deno.env.get("WARRANTY_AUTO_THRESHOLD")) || undefined;
    const email = normalizeInbound(body);
    const outcome = await processInboundEmail(supabaseStore(), body, email, { threshold });
    // Always 200 for processed mail so the provider doesn't retry; the outcome is in the queue.
    return json(200, { ok: true, status: outcome.status, inbound_id: outcome.inbound_id });
  } catch (e) {
    console.error("warranty-inbound", e);
    return json(500, { error: "processing failed" }); // provider retries later
  }
});
