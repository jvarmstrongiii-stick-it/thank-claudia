// Unit tests for the WARRANTY-CORE block inside claudia.html — extracted from the shipped file
// itself, so what's tested is exactly what deploys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../claudia.html", import.meta.url), "utf8");
const begin = html.indexOf("// WARRANTY-CORE-BEGIN");
const end = html.indexOf("// WARRANTY-CORE-END");
assert.ok(begin > 0 && end > begin, "WARRANTY-CORE markers present in claudia.html");
const core = new Function(`${html.slice(begin, end)}
  return { WARRANTY_INBOX, isWarrantyInstallJob, shouldPrepareWarranty, resolveWarrantyManufacturer, newWarrantyToken,
           warrantyInboxAddress, warrantyFirstName, buildWarrantyEmail, warrantyUnitHolds, WARRANTY_TOKEN_ALPHABET };`)();

const MFS = [
  { brand_key: "daikin", display_name: "Daikin", aliases: ["daikin comfort"], registration_url: "https://warranty.goodmanmfg.com/newregistration/", url_verified: true, window_days: null },
  { brand_key: "goodman", display_name: "Goodman", aliases: ["goodman manufacturing"], registration_url: "https://warranty.goodmanmfg.com/newregistration/", url_verified: true, window_days: 60 },
  { brand_key: "american_standard", display_name: "American Standard", aliases: ["american standard"], registration_url: "https://www.americanstandardair.com/resources/warranty-and-registration/", url_verified: true, window_days: 60 },
  { brand_key: "trane", display_name: "Trane", aliases: [], registration_url: "https://www.trane.com/residential/en/resources/warranty-and-registration/", url_verified: true, window_days: 60 },
  { brand_key: "rheem", display_name: "Rheem", aliases: [], registration_url: "https://rheem.registermyunit.com/en-US/warranty/brand?brand=rheem", url_verified: true, window_days: null },
  { brand_key: "comfortmaker", display_name: "Comfortmaker", aliases: [], registration_url: "https://productregistration2.icpusa.com", url_verified: false, window_days: null },
  { brand_key: "aaon", display_name: "AAON", aliases: [], registration_url: null, url_verified: false, window_days: null },
  { brand_key: "bradford_white", display_name: "Bradford White", aliases: ["bradford white corporation"], registration_url: "https://warrantycenter.bradfordwhite.com/", url_verified: true, window_days: null },
];

const JOB = { id: "job-1", type: "New Install", customer: "Smith, Pat", email: "pat@example.com" };
const EQ = { id: "eq-1", label: "Outdoor Unit", brand: "Goodman", model_number: "GSXC160361", serial_number: "2105123456", install_date: "2026-11-16" };

test("the forwarding inbox is not chosen yet (default ships as null)", () => {
  assert.equal(core.WARRANTY_INBOX, null);
});

test("only New Install / Replacement jobs reaching Completed/Needs Billing trigger prep", () => {
  assert.equal(core.shouldPrepareWarranty({ type: "New Install" }, "Completed/Needs Billing"), true);
  assert.equal(core.shouldPrepareWarranty({ type: "Replacement" }, "Completed/Needs Billing"), true);
  assert.equal(core.shouldPrepareWarranty({ type: "Service Call" }, "Completed/Needs Billing"), false);
  assert.equal(core.shouldPrepareWarranty({ type: "New Install" }, "Completed/Paid"), false);
  assert.equal(core.shouldPrepareWarranty(null, "Completed/Needs Billing"), false);
});

test("brand resolution handles live nameplate spellings", () => {
  const r = (b) => core.resolveWarrantyManufacturer(b, MFS)?.brand_key ?? null;
  assert.equal(r("Daikin"), "daikin");
  assert.equal(r("DAIKIN COMFORT"), "daikin");
  assert.equal(r("American Standard / Trane"), "american_standard"); // longest alias wins
  assert.equal(r("GE/Rheem"), "rheem");
  assert.equal(r("Bradford White Corporation"), "bradford_white");
  assert.equal(r("Interlink"), null);
  assert.equal(r(""), null);
  assert.equal(r(null), null);
});

test("ref tokens use the unambiguous alphabet", () => {
  for (let i = 0; i < 200; i++) {
    const t = core.newWarrantyToken();
    assert.equal(t.length, 6);
    for (const c of t) assert.ok(core.WARRANTY_TOKEN_ALPHABET.includes(c), `bad char ${c}`);
  }
  assert.equal(core.newWarrantyToken([0, 1, 2, 3, 4, 5]), "ABCDEF");
});

test("inbox address gets the plus-code", () => {
  assert.equal(core.warrantyInboxAddress("warranty@abcmech.com", "K7M3QX"), "warranty+K7M3QX@abcmech.com");
  assert.equal(core.warrantyInboxAddress("warranty+old@abcmech.com", "K7M3QX"), "warranty+K7M3QX@abcmech.com");
  assert.equal(core.warrantyInboxAddress(null, "K7M3QX"), null);
  assert.equal(core.warrantyInboxAddress("not-an-email", "K7M3QX"), null);
});

test("first name from 'Last, First' and 'First Last'", () => {
  assert.equal(core.warrantyFirstName("Smith, PAT J"), "Pat");
  assert.equal(core.warrantyFirstName("pat smith"), "Pat");
  assert.equal(core.warrantyFirstName(""), "");
});

test("ready email contains manufacturer, model, serial, verified URL, reply instructions and ref", () => {
  const r = core.buildWarrantyEmail({ job: JOB, units: [{ eq: EQ, mf: MFS[1] }], token: "K7M3QX", inbox: "warranty@abcmech.com", today: "2026-11-16" });
  assert.equal(r.to, "pat@example.com");
  assert.equal(r.replyTo, "warranty+K7M3QX@abcmech.com", "coded Reply-To is the tracker");
  assert.deepEqual(r.emailHolds, []);
  assert.equal(r.units[0].status, "email_prepared");
  assert.match(r.subject, /Goodman/);
  assert.match(r.subject, /\[Ref W-K7M3QX\]/);
  for (const s of ["Hi Pat,", "Goodman", "Model number: GSXC160361", "Serial number: 2105123456", "Installation date: 11/16/2026",
    "Register at: https://warranty.goodmanmfg.com/newregistration/", "just reply to this email", "within 60 days", "W-K7M3QX"]) {
    assert.ok(r.body.includes(s), `body missing: ${s}`);
  }
});

test("no inbox chosen yet → email is built but held for review", () => {
  const r = core.buildWarrantyEmail({ job: JOB, units: [{ eq: EQ, mf: MFS[1] }], token: "K7M3QX", inbox: null, today: "2026-11-16" });
  assert.deepEqual(r.emailHolds, ["inbox_not_set"]);
  assert.equal(r.units[0].status, "needs_review");
  assert.ok(r.units[0].holds.includes("inbox_not_set"));
  assert.ok(!r.body.includes("reply to this email"));
  assert.equal(r.replyTo, null);
});

test("missing customer email holds the whole email", () => {
  const r = core.buildWarrantyEmail({ job: { ...JOB, email: "" }, units: [{ eq: EQ, mf: MFS[1] }], token: "K7M3QX", inbox: "w@abc.com" });
  assert.ok(r.emailHolds.includes("no_customer_email"));
  assert.equal(r.units[0].status, "needs_review");
});

test("unverified link / unknown maker / no registration program / missing serial are each held and left out of the email", () => {
  const units = [
    { eq: { ...EQ, id: "ok" }, mf: MFS[1] },
    { eq: { ...EQ, id: "unverified", brand: "Comfortmaker" }, mf: MFS[5] },
    { eq: { ...EQ, id: "unknown", brand: "Interlink" }, mf: null },
    { eq: { ...EQ, id: "commercial", brand: "AAON" }, mf: MFS[6] },
    { eq: { ...EQ, id: "noserial", serial_number: "" }, mf: MFS[1] },
  ];
  const r = core.buildWarrantyEmail({ job: JOB, units, token: "K7M3QX", inbox: "w@abc.com", today: "2026-11-16" });
  const by = Object.fromEntries(r.units.map((u) => [u.equipment_id, u]));
  assert.equal(by.ok.status, "email_prepared");
  assert.deepEqual(by.unverified.holds, ["unverified_url"]);
  assert.deepEqual(by.unknown.holds, ["unknown_manufacturer"]);
  assert.deepEqual(by.commercial.holds, ["no_registration_url"]);
  assert.deepEqual(by.noserial.holds, ["missing_serial"]);
  for (const id of ["unverified", "unknown", "commercial", "noserial"]) assert.equal(by[id].status, "needs_review");
  assert.ok(!r.body.includes("icpusa.com"), "unverified link must never reach the customer");
  assert.equal((r.body.match(/Register at:/g) || []).length, 1);
});

test("two makers on one job → one email listing both", () => {
  const r = core.buildWarrantyEmail({
    job: JOB, token: "K7M3QX", inbox: "w@abc.com", today: "2026-11-16",
    units: [{ eq: EQ, mf: MFS[1] }, { eq: { ...EQ, id: "wh", label: "Water Heater", brand: "Bradford White", model_number: "RG240T6N", serial_number: "XJ1234567" }, mf: MFS[7] }],
  });
  assert.match(r.subject, /Goodman & Bradford White/);
  assert.equal((r.body.match(/Register at:/g) || []).length, 2);
});

