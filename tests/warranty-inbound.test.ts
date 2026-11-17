// End-to-end tests for the warranty-inbound pipeline (normalize → store → match → auto-register),
// using an in-memory store in place of Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractSecret,
  normalizeInbound,
  processInboundEmail,
  safeEqual,
  type OutboundRow,
  type RegistrationRow,
  type WarrantyStore,
} from "../supabase/functions/_shared/warranty-inbound-core.ts";

function fakeStore(regs: RegistrationRow[], outbound: OutboundRow[] = []) {
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
    async findOutbound({ threadIds, tokens }) {
      return outbound.filter((o) => (o.message_ids ?? []).some((id) => threadIds.includes(id)) || tokens.includes(o.email_token));
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

// ── replies to the email we sent (the tracker) ──────────────────────────────

const SENT: OutboundRow = { id: "out-1", email_token: "K7M3QX", to_email: "pat@example.com", message_ids: ["warranty.k7m3qx.ab12@abcmech.com", "pm-uuid-777"] };
const REPLY_WORDS = "Hi, I registered it this morning. Confirmation number: DK-55501234\n\n> On Mon, ABC Mechanical wrote:\n> Register your new Goodman equipment warranty";

test("a reply that threads to our send (In-Reply-To) is tied to it and auto-registers", async () => {
  const { store, state } = fakeStore([REG], [SENT]);
  const body = {
    from: "Pat Smith <pat@example.com>", to: "warranty@abcmech.com", subject: "Re: Register your new Goodman equipment warranty",
    text: REPLY_WORDS, message_id: "r-1", in_reply_to: "<warranty.k7m3qx.ab12@abcmech.com>",
  };
  const email = normalizeInbound(body);
  assert.deepEqual(email.thread_ids, ["warranty.k7m3qx.ab12@abcmech.com"]);
  const out = await processInboundEmail(store, body, email);
  assert.equal(out.status, "auto_matched");
  assert.equal(state.regs[0].status, "registered");
  assert.equal(state.regs[0].confirmation_number, "DK-55501234");
  assert.equal(state.inbound[0].outbound_id, "out-1");
  assert.deepEqual((state.inbound[0].parsed as { reply_to_tokens: string[] }).reply_to_tokens, ["K7M3QX"]);
});

test("a reply to the coded Reply-To address from the address we sent to counts, even with no headers", async () => {
  const { store, state } = fakeStore([REG], [SENT]);
  const body = { from: "pat@example.com", to: "warranty+K7M3QX@abcmech.com", subject: "Re: warranty", text: "Done, we have registered it. Thanks!", message_id: "r-2" };
  const out = await processInboundEmail(store, body, normalizeInbound(body));
  assert.equal(out.status, "auto_matched");
  assert.equal(state.regs[0].status, "registered");
});

test("the coded address from a DIFFERENT sender is not treated as the customer's reply", async () => {
  const { store, state } = fakeStore([REG], [SENT]);
  const body = { from: "someone@else.com", to: "warranty+K7M3QX@abcmech.com", subject: "hello", text: "I registered it", message_id: "r-3" };
  const out = await processInboundEmail(store, body, normalizeInbound(body));
  assert.equal(out.status, "needs_review");
  assert.equal(state.regs[0].status, "sent");
  assert.deepEqual((state.inbound[0].parsed as { reply_to_tokens: string[] }).reply_to_tokens, []);
});

test("a tracked reply that isn't a confirmation goes to review, still tied to the send", async () => {
  const { store, state } = fakeStore([REG], [SENT]);
  const body = { from: "pat@example.com", to: "warranty+K7M3QX@abcmech.com", subject: "Re: warranty", text: "Do I need to register the thermostat too?", message_id: "r-4" };
  const out = await processInboundEmail(store, body, normalizeInbound(body));
  assert.equal(out.status, "needs_review");
  assert.equal(state.inbound[0].outbound_id, "out-1");
});

test("Postmark inbound headers: In-Reply-To with the provider's own id (bare UUID stored) still matches", async () => {
  const { store, state } = fakeStore([REG], [SENT]);
  const body = {
    From: "pat@example.com", FromFull: { Email: "pat@example.com" }, To: "warranty@abcmech.com", Subject: "Re: Register",
    TextBody: REPLY_WORDS, MessageID: "pm-in-1",
    Headers: [{ Name: "In-Reply-To", Value: "<pm-uuid-777@mtasv.net>" }, { Name: "References", Value: "<pm-uuid-777@mtasv.net>" }],
  };
  const email = normalizeInbound(body);
  assert.deepEqual(email.thread_ids, ["pm-uuid-777@mtasv.net"]);
  const out = await processInboundEmail(store, body, email);
  assert.equal(out.status, "auto_matched");
  assert.equal(state.inbound[0].outbound_id, "out-1");
});

test("SendGrid/Mailgun reply headers are read (folded References, message-headers JSON)", () => {
  const sg = normalizeInbound({ from: "a@b.com", to: "w@x.com", text: "x", headers: "Message-ID: <in@b>\nIn-Reply-To: <one@abc>\nReferences: <zero@abc>\n <one@abc>\n" });
  assert.deepEqual(sg.thread_ids.sort(), ["one@abc", "zero@abc"]);
  const mg = normalizeInbound({ sender: "a@b.com", "body-plain": "x", "Message-Id": "<m@b>", "message-headers": JSON.stringify([["In-Reply-To", "<one@abc>"]]) });
  assert.deepEqual(mg.thread_ids, ["one@abc"]);
});
