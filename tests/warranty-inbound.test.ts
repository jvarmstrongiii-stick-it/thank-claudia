// End-to-end tests for the warranty-inbound pipeline (normalize → store → match → auto-register),
// using an in-memory store in place of Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractSecret,
  normalizeInbound,
  processInboundEmail,
  safeEqual,
  type RegistrationRow,
  type WarrantyStore,
} from "../supabase/functions/_shared/warranty-inbound-core.ts";

function fakeStore(regs: RegistrationRow[]) {
  const state = {
    raw: [] as unknown[],
    inbound: [] as Record<string, unknown>[],
    regs: regs.map((r) => ({ ...r })) as (RegistrationRow & Record<string, unknown>)[],
  };
  const store: WarrantyStore = {
    async findInboundByMessageId(id) {
      const hit = state.inbound.find((r) => r.message_id === id);
      return hit ? { id: String(hit.id), status: String(hit.status) } : null;
    },
    async insertRaw(row) { state.raw.push(row); return `raw${state.raw.length}`; },
    async insertInbound(row) { const id = `inb${state.inbound.length + 1}`; state.inbound.push({ id, ...row }); return id; },
    async loadManufacturers() { return [{ brand_key: "daikin", display_name: "Daikin", aliases: [], email_domains: ["goodmanmfg.com"] }]; },
    async loadRegistrations() { return state.regs; },
    async markRegistered(ids, fields) {
      for (const r of state.regs) if (ids.includes(r.id) && r.status !== "registered") Object.assign(r, { status: "registered", ...fields });
    },
  };
  return { store, state };
}

const REG: RegistrationRow = {
  id: "reg-1", job_id: "job-1", email_token: "K7M3QX", status: "sent", brand_key: "daikin",
  equipment: { serial_number: "2105123456", model_number: "DX16SA0361" },
  customers: { name: "Smith, Pat", email: "pat@example.com" },
};

const CONFIRM_TEXT = "Thank you for registering your Daikin product.\nConfirmation Number: DK-88812345\nModel Number: DX16SA0361\nSerial Number: 2105123456";

test("Postmark payload is normalized", () => {
  const e = normalizeInbound({
    From: "Pat <pat@example.com>", FromFull: { Email: "pat@example.com" },
    To: "warranty+K7M3QX@abcmech.com", ToFull: [{ Email: "warranty+K7M3QX@abcmech.com" }],
    Subject: "Fwd: Thanks", TextBody: "hello", HtmlBody: "<p>hello</p>", MessageID: "pm-1",
  });
  assert.equal(e.provider, "postmark");
  assert.equal(e.from, "pat@example.com");
  assert.ok(e.to.includes("warranty+K7M3QX@abcmech.com"));
  assert.equal(e.message_id, "pm-1");
});

test("Mailgun and SendGrid form fields are normalized", () => {
  const mg = normalizeInbound({ sender: "pat@example.com", recipient: "warranty+K7M3QX@abcmech.com", subject: "s", "body-plain": "b", "Message-Id": "<mg-1>" });
  assert.equal(mg.provider, "mailgun");
  assert.equal(mg.text, "b");
  const sg = normalizeInbound({ from: "Pat <pat@example.com>", to: "warranty+K7M3QX@abcmech.com, other@x.com", subject: "s", text: "b", headers: "Received: x\nMessage-ID: <sg-1@mail>\n" });
  assert.equal(sg.provider, "sendgrid");
  assert.equal(sg.message_id, "<sg-1@mail>");
  assert.equal(sg.to.length, 2);
});

test("confident confirmation auto-registers the unit and records the inbound email", async () => {
  const { store, state } = fakeStore([REG]);
  const body = { from: "pat@example.com", to: "warranty+K7M3QX@abcmech.com", subject: "Fwd: Registration", text: CONFIRM_TEXT, message_id: "m-1" };
  const out = await processInboundEmail(store, body, normalizeInbound(body));
  assert.equal(out.status, "auto_matched");
  assert.equal(state.regs[0].status, "registered");
  assert.equal(state.regs[0].confirmation_number, "DK-88812345");
  assert.equal(state.regs[0].matched_inbound_id, "inb1");
  assert.equal(state.inbound[0].status, "auto_matched");
  assert.deepEqual(state.inbound[0].matched_registration_ids, ["reg-1"]);
  assert.equal(state.raw.length, 1);
});

test("uncertain email goes to review and changes nothing", async () => {
  const { store, state } = fakeStore([REG]);
  const body = { from: "pat@example.com", to: "warranty+K7M3QX@abcmech.com", subject: "question", text: "Do I need to register the thermostat too?", message_id: "m-2" };
  const out = await processInboundEmail(store, body, normalizeInbound(body));
  assert.equal(out.status, "needs_review");
  assert.equal(state.regs[0].status, "sent");
  assert.equal((state.inbound[0].candidates as unknown[]).length, 1);
});

test("unrelated email is stored as unmatched", async () => {
  const { store, state } = fakeStore([REG]);
  const body = { from: "promo@ads.com", to: "warranty@abcmech.com", subject: "Sale", text: "50% off", message_id: "m-3" };
  const out = await processInboundEmail(store, body, normalizeInbound(body));
  assert.equal(out.status, "unmatched");
  assert.equal(state.inbound[0].status, "unmatched");
});

test("provider retry with the same Message-ID is not processed twice", async () => {
  const { store, state } = fakeStore([REG]);
  const body = { from: "pat@example.com", to: "warranty+K7M3QX@abcmech.com", text: CONFIRM_TEXT, message_id: "m-dup" };
  await processInboundEmail(store, body, normalizeInbound(body));
  const again = await processInboundEmail(store, body, normalizeInbound(body));
  assert.equal(again.status, "duplicate");
  assert.equal(state.inbound.length, 1);
});

test("snippet is capped and tags stripped", async () => {
  const { store, state } = fakeStore([REG]);
  const body = { from: "a@b.com", html: "<p>" + "x".repeat(5000) + "</p>", message_id: "m-4" };
  await processInboundEmail(store, body, normalizeInbound(body));
  const snip = String(state.inbound[0].snippet);
  assert.equal(snip.length, 1500);
  assert.ok(!snip.includes("<p>"));
});

test("webhook secret: header, ?key= and basic-auth password; constant-time compare", () => {
  const h = (m: Record<string, string>) => ({ get: (n: string) => m[n.toLowerCase()] ?? null });
  assert.equal(extractSecret(h({ "x-warranty-secret": "s3cret" }), new URL("https://x/f")), "s3cret");
  assert.equal(extractSecret(h({}), new URL("https://x/f?key=abc")), "abc");
  assert.equal(extractSecret(h({ authorization: "Basic " + btoa("inbound:pw123") }), new URL("https://x/f")), "pw123");
  assert.equal(extractSecret(h({}), new URL("https://x/f")), null);
  assert.ok(safeEqual("abcdef", "abcdef"));
  assert.ok(!safeEqual("abcdef", "abcdeg"));
  assert.ok(!safeEqual("abc", "abcd"));
});
