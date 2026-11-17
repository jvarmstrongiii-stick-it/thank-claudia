// Builds demo/claudia-demo.html: the real claudia.html from this branch, running on an in-browser
// stand-in database seeded with made-up customers, so the warranty workflow can be clicked through
// (and screenshotted) without touching the live Supabase project or emailing anyone.
//
//   node --experimental-strip-types demo/build-demo.ts
//
// What is real in the demo: the whole app, the warranty email builder, the warranty-send core
// (run in the page, with a pretend email provider that sends nothing), and the warranty-inbound
// matcher (run in the page when you press "Reply as the customer").
// What is pretend: the database (in memory, resets on reload) and the email provider.
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { buildEmail } from "../supabase/functions/_shared/warranty-send-core.ts";
import { normalizeInbound, processInboundEmail, type WarrantyStore } from "../supabase/functions/_shared/warranty-inbound-core.ts";

const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

const INBOX = "warranty@abcmechanical.example";
const COMPANY = "ABC Mechanical";
const TODAY = "2026-11-17";

// ── manufacturers: the real seed rows from migration 0006 ────────────────────
function parseManufacturers(sql: string) {
  const start = sql.indexOf("insert into public.warranty_manufacturers");
  const block = sql.slice(sql.indexOf("values", start) + 6, sql.indexOf("on conflict (brand_key)", start));
  const cols = ["brand_key", "display_name", "aliases", "email_domains", "registration_url", "url_verified", "verified_at", "verified_note", "window_days"];
  const rows: Record<string, unknown>[] = [];
  let i = 0;
  const s = block;
  const str = () => { let out = ""; i++; while (i < s.length) { if (s[i] === "'" && s[i + 1] === "'") { out += "'"; i += 2; } else if (s[i] === "'") { i++; break; } else out += s[i++]; } return out; };
  const skipCast = () => { const m = /^::[a-z\[\]]+/.exec(s.slice(i)); if (m) i += m[0].length; };
  const ws = () => { while (/\s|,/.test(s[i] ?? "")) i++; };
  const value = (): unknown => {
    ws();
    if (s[i] === "'") { const v = str(); skipCast(); return v === "{}" ? [] : v; }
    if (s.startsWith("array[", i)) {
      i += 6; const arr: string[] = [];
      while (s[i] !== "]") { ws(); if (s[i] === "'") arr.push(str()); else i++; }
      i++; skipCast(); return arr;
    }
    const m = /^(null|true|false|-?\d+)/.exec(s.slice(i));
    if (!m) throw new Error("parse error near: " + s.slice(i, i + 40));
    i += m[0].length;
    return m[0] === "null" ? null : m[0] === "true" ? true : m[0] === "false" ? false : Number(m[0]);
  };
  while (true) {
    ws();
    if (s[i] !== "(") break;
    i++;
    const row: Record<string, unknown> = {};
    for (const c of cols) row[c] = value();
    ws();
    if (s[i] !== ")") throw new Error("row end expected near: " + s.slice(i, i + 40));
    i++;
    rows.push(row);
  }
  return rows.map((r, n) => ({ id: `mf${n + 1}`, ...r }));
}
const MANUFACTURERS = parseManufacturers(read("db/migrations/0006_warranty_registration.sql"));
const mf = (k: string) => MANUFACTURERS.find((m) => m.brand_key === k) as any;

// ── made-up customers and jobs ───────────────────────────────────────────────
const JACK = { id: "11111111-1111-4111-8111-111111111111", name: "Jack", role: "hnic", status: "active" };
const TYLER = { id: "22222222-2222-4222-8222-222222222222", name: "Tyler", role: "office", status: "active" };

const tables: Record<string, any[]> = {
  users: [JACK, TYLER],
  customers: [
    { id: "c1", name: "Smith, Pat", email: "pat.smith@example.com", phone: "215-555-0100", address: "14 Orchard Ln, Doylestown PA" },
    { id: "c2", name: "Rivera, Sam", email: "sam.rivera@example.com", phone: "215-555-0142", address: "220 Mill Rd, Warminster PA" },
    { id: "c3", name: "Nguyen, Dana", email: "dana.nguyen@example.com", phone: "215-555-0177", address: "9 Beacon Ct, Horsham PA" },
  ],
  jobs: [
    { id: "j1", customer_id: "c1", flow_type: "New Install", current_status: "In Progress", value: 11800, created_at: "2026-11-12T13:00:00Z" },
    { id: "j2", customer_id: "c2", flow_type: "New Install", current_status: "Completed/Needs Billing", value: 7400, created_at: "2026-11-10T13:00:00Z" },
    { id: "j3", customer_id: "c3", flow_type: "New Install", current_status: "Completed/Needs Billing", value: 6900, created_at: "2026-11-11T13:00:00Z" },
  ],
  equipment: [
    { id: "e1", customer_id: "c1", job_id: "j1", label: "Outdoor Unit", brand: "Goodman", model_number: "GSXC160361", serial_number: "2105123456", created_at: "2026-11-12", warranty_status: "not_sent" },
    { id: "e2", customer_id: "c1", job_id: "j1", label: "Furnace", brand: "Goodman", model_number: "GR9S800803BN", serial_number: "2106654321", created_at: "2026-11-12", warranty_status: "not_sent" },
    { id: "e3", customer_id: "c2", job_id: "j2", label: "Outdoor Unit", brand: "Goodman", model_number: "GSXC180481", serial_number: "2104777001", created_at: "2026-11-10", install_date: "2026-11-14", warranty_status: "sent" },
    { id: "e4", customer_id: "c3", job_id: "j3", label: "Furnace", brand: "Comfortmaker", model_number: "N9MSE0802714A", serial_number: "A123456789", created_at: "2026-11-11", install_date: "2026-11-15", warranty_status: "needs_review" },
  ],
  job_notes: [], chores: [],
  warranty_manufacturers: MANUFACTURERS,
  warranty_registrations: [],
  warranty_outbound: [],
  warranty_inbound: [],
};

// Sam Rivera: email sent Nov 14, then Sam replied with a question (not a confirmation).
const samEmail = buildEmail({
  job: { customer: "Rivera, Sam", email: "sam.rivera@example.com" },
  units: [{ eq: tables.equipment[2], mf: mf("goodman") }], token: "R4TV9P", inbox: INBOX, company: COMPANY, today: "2026-11-14",
});
tables.warranty_outbound.push({
  id: "o2", email_token: "R4TV9P", job_id: "j2", registration_ids: ["r3"], to_email: "sam.rivera@example.com",
  reply_to: samEmail.replyTo, subject: samEmail.subject, body: samEmail.body, provider: "postmark", status: "sent",
  message_ids: ["warranty.r4tv9p.5c1e0a77@abcmechanical.example", "0f3a9e1c-demo-4b1d-9a55-6d1c2b7e9f01"],
  created_at: "2026-11-14T15:02:00Z", sent_at: "2026-11-14T15:02:00Z",
});
tables.warranty_registrations.push({
  id: "r3", equipment_id: "e3", job_id: "j2", customer_id: "c2", brand_key: "goodman", email_token: "R4TV9P", status: "sent", hold_reasons: [],
  registration_url: mf("goodman").registration_url, email_to: "sam.rivera@example.com", email_subject: samEmail.subject, email_body: samEmail.body,
  prepared_at: "2026-11-14T15:00:00Z", sent_at: "2026-11-14T15:02:00Z", outbound_id: "o2", created_at: "2026-11-14T15:00:00Z",
});

// Dana Nguyen: Comfortmaker's registration link isn't verified yet, so the email is on hold.
const danaEmail = buildEmail({
  job: { customer: "Nguyen, Dana", email: "dana.nguyen@example.com" },
  units: [{ eq: tables.equipment[3], mf: mf("comfortmaker") }], token: "N8HZ2C", inbox: INBOX, company: COMPANY, today: "2026-11-15",
});
tables.warranty_registrations.push({
  id: "r4", equipment_id: "e4", job_id: "j3", customer_id: "c3", brand_key: "comfortmaker", email_token: "N8HZ2C", status: "needs_review",
  hold_reasons: danaEmail.emailHolds.length ? danaEmail.emailHolds : ["unverified_url"],
  registration_url: mf("comfortmaker").registration_url, email_to: "dana.nguyen@example.com", email_subject: danaEmail.subject, email_body: danaEmail.body,
  prepared_at: "2026-11-15T16:00:00Z", created_at: "2026-11-15T16:00:00Z",
});

// Run Sam's reply through the REAL inbound pipeline so the review card shows real matcher output.
function memStore(): WarrantyStore {
  return {
    async findInboundByMessageId() { return null; },
    async insertRaw() { return null; },
    async insertInbound(row) { const id = `in${tables.warranty_inbound.length + 1}`; tables.warranty_inbound.push({ id, received_at: "2026-11-16T19:41:00Z", ...row }); return id; },
    async loadManufacturers() { return MANUFACTURERS as any; },
    async loadRegistrations() {
      return tables.warranty_registrations.map((r) => ({
        ...r,
        equipment: tables.equipment.find((e) => e.id === r.equipment_id),
        customers: tables.customers.find((c) => c.id === r.customer_id),
      })) as any;
    },
    async markRegistered() { throw new Error("Sam's question should not auto-register"); },
    async findOutbound({ threadIds, tokens }) {
      return tables.warranty_outbound.filter((o) => o.message_ids.some((id: string) => threadIds.includes(id)) || tokens.includes(o.email_token));
    },
  };
}
const samReply = {
  from: "Sam Rivera <sam.rivera@example.com>", to: "warranty+R4TV9P@abcmechanical.example",
  subject: `Re: ${samEmail.subject}`, message_id: "sam-reply-1@mail.example.com",
  in_reply_to: "<warranty.r4tv9p.5c1e0a77@abcmechanical.example>",
  text: "Thanks! Quick question before I do this. Do I need to register the thermostat too, or just the outdoor unit?\n\n> On Nov 14, ABC Mechanical wrote:\n> " + samEmail.subject,
};
const samOut = await processInboundEmail(memStore(), samReply, normalizeInbound(samReply));
if (samOut.status !== "needs_review") throw new Error(`expected Sam's reply to need review, got ${samOut.status}`);

// ── assemble the demo page ───────────────────────────────────────────────────
let html = read("claudia.html");
const must = (cond: boolean, what: string) => { if (!cond) throw new Error(`demo build: couldn't ${what}`); };

// 1. The app ships with no reply inbox (emails held until Jack picks one); the demo pretends one is set.
must(html.includes("const WARRANTY_INBOX = null;"), "find WARRANTY_INBOX");
html = html.replace("const WARRANTY_INBOX = null;", `const WARRANTY_INBOX = ${JSON.stringify(INBOX)}; // DEMO ONLY`);

// 2. Swap the real Supabase client for the in-memory stand-in, and drop the Google Maps loader.
const sbTag = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^>]*><\/script>/;
must(sbTag.test(html), "find the supabase-js script tag");
const gmaps = /<script>\s*\(g\s*=>[\s\S]*?<\/script>/;
must(gmaps.test(html), "find the Google Maps loader");
html = html.replace(gmaps, `<script>window.google = { maps: { importLibrary: async () => ({}) } };</script>`);

const js = (p: string) => stripTypeScriptTypes(read(p), { mode: "strip" });
const cores = {
  match: js("supabase/functions/_shared/warranty-match.ts"),
  inbound: js("supabase/functions/_shared/warranty-inbound-core.ts"),
  send: js("supabase/functions/_shared/warranty-send-core.ts"),
};
const demoRuntime = read("demo/demo-runtime.js");
const injected = `<script>
window.__DEMO = ${JSON.stringify({ tables, inbox: INBOX, company: COMPANY, today: TODAY, user: JACK })};
window.__DEMO_CORES = ${JSON.stringify(cores).replace(/<\/script/gi, "<\\/script")};
</script>
<script>
${demoRuntime}
</script>`;
html = html.replace(sbTag, () => injected); // function form: the injected code contains "$&"

// 3. Label the page so nobody mistakes it for the real app.
html = html.replace(/<title>([^<]*)<\/title>/, "<title>$1 (warranty demo)</title>");

writeFileSync(new URL("demo/claudia-demo.html", root), html);
console.log(`demo/claudia-demo.html written (${(html.length / 1024).toFixed(0)} KB, ${MANUFACTURERS.length} manufacturers, Sam's reply: ${samOut.status})`);
