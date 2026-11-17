// Unit tests for supabase/functions/_shared/warranty-match.ts (parsing + matching).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchConfirmation,
  normId,
  parseConfirmationEmail,
  scoreCandidate,
  type Candidate,
} from "../supabase/functions/_shared/warranty-match.ts";

const MFS = [
  { brand_key: "daikin", display_name: "Daikin", aliases: ["daikin comfort"], email_domains: ["daikincomfort.com", "goodmanmfg.com"] },
  { brand_key: "carrier", display_name: "Carrier", aliases: [], email_domains: ["carrier.com"] },
  { brand_key: "lg", display_name: "LG", aliases: ["lg electronics"], email_domains: ["lghvac.com"] },
];

function cand(over: Partial<Candidate>): Candidate {
  return {
    registration_id: "r1", job_id: "j1", token: "K7M3QX", status: "sent",
    serial: "2105123456", model: "DX16SA0361", brand_key: "daikin",
    customer_email: "pat@example.com", customer_name: "Smith, Pat", ...over,
  };
}

const DAIKIN_CONFIRM = `---------- Forwarded message ---------
From: Daikin Product Registration <noreply@goodmanmfg.com>
Subject: Thank you for registering your Daikin product
To: Pat Smith <pat@example.com>

Dear Pat Smith,
Thank you for registering your product. Your registration is complete.
Confirmation Number: DK-88812345
Model Number: DX16SA0361
Serial Number: 2105123456
`;

test("normId strips punctuation and case", () => {
  assert.equal(normId(" dx-16sa/0361 "), "DX16SA0361");
  assert.equal(normId(null), "");
});

test("parses ref code from plus-address, serial/model labels, confirmation number, brand", () => {
  const p = parseConfirmationEmail({
    from: "Pat Smith <Pat@Example.com>",
    to: ["warranty+k7m3qx@abcmech.com"],
    subject: "Fwd: Thank you for registering your Daikin product",
    text: DAIKIN_CONFIRM,
  }, MFS);
  assert.equal(p.fromEmail, "pat@example.com");
  assert.deepEqual(p.tokens, ["K7M3QX"]);
  assert.ok(p.labeledSerials.includes("2105123456"));
  assert.ok(p.labeledModels.includes("DX16SA0361"));
  assert.equal(p.confirmationNumber, "DK-88812345");
  assert.equal(p.looksLikeConfirmation, true);
  assert.deepEqual(p.brandKeys, ["daikin"]);
});

test("ref code in the body text (W-XXXXXX) is found; ambiguous letters are rejected", () => {
  const p = parseConfirmationEmail({ text: "Your reference: W-K7M3QX and also W-OOOOOO" }, MFS);
  assert.deepEqual(p.tokens, ["K7M3QX"]);
});

test("labels don't fire inside other words ('serialized', 'models')", () => {
  const p = parseConfirmationEmail({ text: "All units are serialized 2020 and our models 2019 vary." }, MFS);
  assert.deepEqual(p.labeledSerials, []);
  assert.deepEqual(p.labeledModels, []);
});

test("serial printed with a space is still matched via labeled join", () => {
  const p = parseConfirmationEmail({ text: "Serial #: 2105 123456\nThank you for registering" }, MFS);
  assert.ok(p.labeledSerials.includes("2105123456"));
});

test("HTML-only bodies are converted to text", () => {
  const p = parseConfirmationEmail({ html: "<p>Thank you for registering!</p><table><tr><td>Serial Number:</td><td>2105123456</td></tr></table>" }, MFS);
  assert.equal(p.looksLikeConfirmation, true);
  assert.ok(p.wordSet.includes("2105123456"));
});

test("strong match (ref + serial + model + sender + confirmation) auto-matches", () => {
  const p = parseConfirmationEmail({ from: "pat@example.com", to: ["warranty+K7M3QX@abcmech.com"], text: DAIKIN_CONFIRM }, MFS);
  const r = matchConfirmation(p, [cand({}), cand({ registration_id: "r9", job_id: "j9", token: "ZZZZZZ", serial: "999888777", model: "CA15NA024", brand_key: "carrier", customer_email: "x@y.com", customer_name: "Jones, Al" })]);
  assert.equal(r.decision, "auto");
  assert.deepEqual(r.matches.map((m) => m.registration_id), ["r1"]);
  assert.equal(r.confidence, 1);
});

test("serial-only match (customer typed the address without the code) still auto-matches", () => {
  const p = parseConfirmationEmail({ from: "pat@example.com", to: ["warranty@abcmech.com"], text: DAIKIN_CONFIRM }, MFS);
  const r = matchConfirmation(p, [cand({})]);
  assert.equal(r.decision, "auto");
});

test("not a confirmation (customer just replied 'thanks') → review, never auto", () => {
  const p = parseConfirmationEmail({ from: "pat@example.com", to: ["warranty+K7M3QX@abcmech.com"], text: "Thanks, will do this weekend!" }, MFS);
  const r = matchConfirmation(p, [cand({})]);
  assert.equal(r.decision, "review");
  assert.match(r.summary, /doesn't read like/);
});

test("ref code matches but email lists a different serial → review (conflict)", () => {
  const p = parseConfirmationEmail({
    from: "pat@example.com", to: ["warranty+K7M3QX@abcmech.com"],
    text: "Thank you for registering. Serial Number: 7777777777 Model Number: DX16SA0361",
  }, MFS);
  const r = matchConfirmation(p, [cand({})]);
  assert.equal(r.decision, "review");
  assert.ok(r.candidates[0].conflict);
});

test("multi-unit job with ref code but no serials → review (can't tell which units)", () => {
  const p = parseConfirmationEmail({ from: "pat@example.com", to: ["warranty+K7M3QX@abcmech.com"], text: "Thank you for registering your Daikin system!" }, MFS);
  const r = matchConfirmation(p, [cand({}), cand({ registration_id: "r2", serial: "2105999999", model: "FTXS12" })]);
  assert.equal(r.decision, "review");
  assert.match(r.summary, /several units/);
});

test("multi-unit job: only units whose serial appears are auto-matched", () => {
  const p = parseConfirmationEmail({ from: "pat@example.com", to: ["warranty+K7M3QX@abcmech.com"], text: DAIKIN_CONFIRM }, MFS);
  const r = matchConfirmation(p, [cand({}), cand({ registration_id: "r2", serial: "2105999999", model: "FTXS12" })]);
  assert.equal(r.decision, "auto");
  assert.deepEqual(r.matches.map((m) => m.registration_id), ["r1"]);
});

test("two jobs equally plausible → review (ambiguous)", () => {
  // Same serial on two different jobs (e.g. the unit was moved / duplicate record).
  const p = parseConfirmationEmail({ from: "someone@else.com", text: "Thank you for registering. Serial Number: 2105123456" }, MFS);
  const r = matchConfirmation(p, [cand({ customer_email: null }), cand({ registration_id: "r2", job_id: "j2", token: "AAAAAA", customer_email: null })]);
  assert.equal(r.decision, "review");
  assert.match(r.summary, /More than one job/);
});

test("weak evidence (only sender email + confirmation wording) stays below threshold", () => {
  const p = parseConfirmationEmail({ from: "pat@example.com", text: "Thank you for registering your product." }, MFS);
  const r = matchConfirmation(p, [cand({})]);
  assert.equal(r.decision, "review");
});

test("nothing matches → unmatched", () => {
  const p = parseConfirmationEmail({ from: "spam@ads.com", text: "Huge sale on gutters this weekend" }, MFS);
  const r = matchConfirmation(p, [cand({})]);
  assert.equal(r.decision, "unmatched");
  assert.equal(r.candidates.length, 0);
});

test("duplicate confirmation for an already-registered unit is recognised, not re-queued", () => {
  const p = parseConfirmationEmail({ from: "pat@example.com", to: ["warranty+K7M3QX@abcmech.com"], text: DAIKIN_CONFIRM }, MFS);
  const r = matchConfirmation(p, [cand({ status: "registered" })]);
  assert.equal(r.decision, "auto");
  assert.match(r.summary, /already registered/);
});

test("custom threshold is honoured", () => {
  const p = parseConfirmationEmail({ to: ["warranty+K7M3QX@abcmech.com"], text: "Thank you for registering." }, MFS);
  // token 45 + confirmation 10 = 55
  assert.equal(matchConfirmation(p, [cand({ customer_email: null })], { threshold: 80 }).decision, "review");
  assert.equal(matchConfirmation(p, [cand({ customer_email: null })], { threshold: 50 }).decision, "auto");
});

test("short / missing serials are not treated as evidence", () => {
  const p = parseConfirmationEmail({ text: "Thank you for registering. Serial: 123" }, MFS);
  const s = scoreCandidate(cand({ serial: "123", token: null, customer_email: null }), p);
  assert.equal(s.serialMatch, false);
});

test("customer name is matched from 'Last, First' format", () => {
  const p = parseConfirmationEmail({ text: "Dear Pat Smith, thank you for registering" }, MFS);
  const s = scoreCandidate(cand({ token: null, serial: null, model: null, customer_email: null }), p);
  assert.ok(s.reasons.includes("customer name appears"));
});
