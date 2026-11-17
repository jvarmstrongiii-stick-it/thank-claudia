// Tests for the warranty-send core: the server-side rebuild of the email (and its parity with
// the app's preview), the reply tracker, test mode, the provider request, and the abuse guards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildEmail,
  providerRequest,
  readSendConfig,
  sendJobWarrantyEmail,
  type SendConfig,
  type SendStore,
  type SendUnitRow,
} from "../supabase/functions/_shared/warranty-send-core.ts";

// The app's own builder, extracted from claudia.html exactly as shipped.
const html = readFileSync(new URL("../claudia.html", import.meta.url), "utf8");
const appCore = new Function(`${html.slice(html.indexOf("// WARRANTY-CORE-BEGIN"), html.indexOf("// WARRANTY-CORE-END"))}
  return { buildWarrantyEmail };`)() as { buildWarrantyEmail: (a: unknown) => Record<string, unknown> };

const GOODMAN = { brand_key: "goodman", display_name: "Goodman", registration_url: "https://warranty.goodmanmfg.com/newregistration/", url_verified: true, window_days: 60 };
const CM = { brand_key: "comfortmaker", display_name: "Comfortmaker", registration_url: "https://productregistration2.icpusa.com", url_verified: false, window_days: null };
const EQ1 = { id: "e1", label: "Outdoor Unit", model_number: "GSXC160361", serial_number: "2105123456", install_date: "2026-11-16" };
const EQ2 = { id: "e2", label: "Furnace", model_number: "N9MSE0802714A", serial_number: "A123456789", install_date: "2026-11-16" };

test("server-built email is identical to the app's preview (no drift between the two copies)", () => {
  for (const inbox of ["warranty@abcmech.com", null]) {
    for (const units of [[{ eq: EQ1, mf: GOODMAN }], [{ eq: EQ1, mf: GOODMAN }, { eq: EQ2, mf: CM }], [{ eq: EQ2, mf: null }]]) {
      const job = { customer: "Smith, Pat", email: "pat@example.com" };
      const server = buildEmail({ job, units, token: "K7M3QX", inbox, company: "ABC Mechanical", today: "2026-11-16" });
      const app = appCore.buildWarrantyEmail({ job, units, token: "K7M3QX", inbox, company: "ABC Mechanical", today: "2026-11-16" });
      assert.equal(server.subject, app.subject);
      assert.equal(server.body, app.body);
      assert.equal(server.replyTo, app.replyTo);
      assert.deepEqual(server.emailHolds, [...(app.emailHolds as string[])]);
      assert.deepEqual(server.units, JSON.parse(JSON.stringify(app.units)));
    }
  }
});

function cfg(over: Partial<SendConfig> = {}): SendConfig {
  return { mode: "test", provider: null, apiKey: null, fromEmail: null, fromName: "ABC Mechanical", replyInbox: "warranty@abcmech.com", mailgunDomain: null, dailyLimit: 40, ...over };
}

function fakeStore(units: SendUnitRow[], opts: { sentToday?: number; alreadySent?: boolean; email?: string | null } = {}) {
  const state = { outbound: [] as Record<string, unknown>[], marked: [] as { ids: string[]; fields: unknown }[] };
  const store: SendStore = {
    async loadJob() { return { customer: "Smith, Pat", email: opts.email === undefined ? "pat@example.com" : opts.email, units }; },
    async countOutboundSince() { return opts.sentToday ?? 0; },
    async hasSent() { return !!opts.alreadySent; },
    async insertOutbound(row) { state.outbound.push(row); return `out-${state.outbound.length}`; },
    async markSent(ids, fields) { state.marked.push({ ids, fields }); },
  };
  return { store, state };
}

const UNITS: SendUnitRow[] = [
  { registration_id: "r1", status: "email_prepared", equipment: EQ1, manufacturer: GOODMAN },
  { registration_id: "r2", status: "needs_review", equipment: EQ2, manufacturer: CM },
];
const noFetch = (async () => { throw new Error("must not call the network"); }) as unknown as typeof fetch;

test("TEST mode (the default) records the send with its tracker and emails nobody", async () => {
  assert.equal(readSendConfig(() => undefined).mode, "test");
  const { store, state } = fakeStore(UNITS);
  const out = await sendJobWarrantyEmail(store, { job_id: "j1", email_token: "K7M3QX" }, cfg(), { fetch: noFetch, rand: () => "ab12" });
  assert.equal(out.http, 200);
  assert.equal(out.body.mode, "test");
  assert.equal(state.outbound[0].status, "test");
  assert.equal(state.outbound[0].reply_to, "warranty+K7M3QX@abcmech.com");
  assert.deepEqual(state.outbound[0].message_ids, ["warranty.k7m3qx.ab12@abcmech.com"]);
  assert.deepEqual(state.outbound[0].registration_ids, ["r1"], "held unit isn't part of the send");
  assert.doesNotMatch(String(state.outbound[0].body), /icpusa/, "unverified link never sent");
  assert.equal(state.marked.length, 0, "nothing marked sent in test mode");
});

test("LIVE mode sends through the provider with Reply-To + ref, stores both message ids, marks units sent", async () => {
  const { store, state } = fakeStore(UNITS);
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ MessageID: "PM-UUID-777", ErrorCode: 0 }), { status: 200 });
  }) as unknown as typeof fetch;
  const live = cfg({ mode: "live", provider: "postmark", apiKey: "pm-key", fromEmail: "warranty@abcmech.com" });
  const out = await sendJobWarrantyEmail(store, { job_id: "j1", email_token: "k7m3qx" }, live, { fetch: fakeFetch, rand: () => "ab12", now: () => new Date("2026-11-17T12:00:00Z") });
  assert.equal(out.http, 200);
  assert.deepEqual(out.body.sent_ids, ["r1"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.postmarkapp.com/email");
  const sent = JSON.parse(String(calls[0].init.body));
  assert.equal(sent.To, "pat@example.com");
  assert.equal(sent.ReplyTo, "warranty+K7M3QX@abcmech.com");
  assert.match(sent.Subject, /\[Ref W-K7M3QX\]/);
  assert.match(sent.TextBody, /just reply to this email/);
  assert.deepEqual(state.outbound[0].message_ids, ["warranty.k7m3qx.ab12@abcmech.com", "pm-uuid-777"]);
  assert.equal(state.outbound[0].status, "sent");
  assert.deepEqual(state.marked[0], { ids: ["r1"], fields: { sent_at: "2026-11-17T12:00:00.000Z", outbound_id: "out-1" } });
});

test("every provider gets Reply-To and the ref; SendGrid/Mailgun/Resend also get our Message-ID", () => {
  const msg = { fromEmail: "w@abc.com", fromName: "ABC", to: "pat@example.com", replyTo: "w+K7M3QX@abc.com", subject: "S", text: "T", messageId: "warranty.k7m3qx.ab12@abc.com", ref: "W-K7M3QX" };
  const sg = JSON.parse(String(providerRequest("sendgrid", msg, { apiKey: "k", mailgunDomain: null }).init.body));
  assert.equal(sg.reply_to.email, "w+K7M3QX@abc.com");
  assert.equal(sg.headers["Message-ID"], "<warranty.k7m3qx.ab12@abc.com>");
  const mg = providerRequest("mailgun", msg, { apiKey: "k", mailgunDomain: "mg.abc.com" });
  assert.equal(mg.url, "https://api.mailgun.net/v3/mg.abc.com/messages");
  const form = new URLSearchParams(String(mg.init.body));
  assert.equal(form.get("h:Reply-To"), "w+K7M3QX@abc.com");
  assert.equal(form.get("h:Message-Id"), "<warranty.k7m3qx.ab12@abc.com>");
  const rs = JSON.parse(String(providerRequest("resend", msg, { apiKey: "k", mailgunDomain: null }).init.body));
  assert.equal(rs.reply_to, "w+K7M3QX@abc.com");
});

test("held emails are refused (422) and nothing is recorded", async () => {
  const { store, state } = fakeStore(UNITS, { email: "" });
  const out = await sendJobWarrantyEmail(store, { job_id: "j1", email_token: "K7M3QX" }, cfg(), { fetch: noFetch });
  assert.equal(out.http, 422);
  assert.deepEqual(out.body.holds, ["no_customer_email"]);
  assert.equal(state.outbound.length, 0);
  const noInbox = fakeStore(UNITS);
  const out2 = await sendJobWarrantyEmail(noInbox.store, { job_id: "j1", email_token: "K7M3QX" }, cfg({ replyInbox: null }), { fetch: noFetch });
  assert.equal(out2.http, 422);
  assert.deepEqual(out2.body.holds, ["inbox_not_set"]);
});

test("abuse guards: bad input 400, daily cap 429, double send 409, missing provider setup 503", async () => {
  const a = fakeStore(UNITS);
  assert.equal((await sendJobWarrantyEmail(a.store, { job_id: "j1", email_token: "nope!" }, cfg(), { fetch: noFetch })).http, 400);
  const b = fakeStore(UNITS, { sentToday: 40 });
  assert.equal((await sendJobWarrantyEmail(b.store, { job_id: "j1", email_token: "K7M3QX" }, cfg(), { fetch: noFetch })).http, 429);
  const c = fakeStore(UNITS, { alreadySent: true });
  assert.equal((await sendJobWarrantyEmail(c.store, { job_id: "j1", email_token: "K7M3QX" }, cfg({ mode: "live" }), { fetch: noFetch })).http, 409);
  const d = fakeStore(UNITS);
  assert.equal((await sendJobWarrantyEmail(d.store, { job_id: "j1", email_token: "K7M3QX" }, cfg({ mode: "live", provider: "postmark" }), { fetch: noFetch })).http, 503);
});

test("a provider error is recorded as failed and nothing is marked sent", async () => {
  const { store, state } = fakeStore(UNITS);
  const failing = (async () => new Response("Sender signature not confirmed", { status: 422 })) as unknown as typeof fetch;
  const live = cfg({ mode: "live", provider: "postmark", apiKey: "k", fromEmail: "warranty@abcmech.com" });
  const out = await sendJobWarrantyEmail(store, { job_id: "j1", email_token: "K7M3QX" }, live, { fetch: failing });
  assert.equal(out.http, 502);
  assert.equal(state.outbound[0].status, "failed");
  assert.match(String(state.outbound[0].error), /Sender signature/);
  assert.equal(state.marked.length, 0);
});
