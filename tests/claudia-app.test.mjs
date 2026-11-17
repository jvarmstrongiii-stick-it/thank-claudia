// Boots the real claudia.html in jsdom (mock Supabase) and clicks through it, checking that
// the warranty workflow works AND that existing flows still behave as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootClaudia, loadHtml, tick, findByText, click } from "./helpers/boot-claudia.mjs";

// CLAUDIA_HTML lets the "existing" tests run against another copy (e.g. main) for comparison.
const HTML = loadHtml(process.env.CLAUDIA_HTML || new URL("../claudia.html", import.meta.url));
const U = { id: "11111111-1111-1111-1111-111111111111", name: "Jack", role: "hnic", status: "active" };
const TYLER = { id: "22222222-2222-2222-2222-222222222222", name: "Tyler", role: "office", status: "active" };
const STORAGE = { abc_device_auth: "ABCmech", abc_current_user: JSON.stringify(U) };
const MFS = [
  { id: "m1", brand_key: "goodman", display_name: "Goodman", aliases: ["goodman manufacturing"], email_domains: [], registration_url: "https://warranty.goodmanmfg.com/newregistration/", url_verified: true, window_days: 60 },
  { id: "m2", brand_key: "comfortmaker", display_name: "Comfortmaker", aliases: [], email_domains: [], registration_url: "https://productregistration2.icpusa.com", url_verified: false, window_days: null },
];

function fixture({ type = "New Install", email = "pat@example.com", equipment } = {}) {
  return {
    users: [U, TYLER],
    customers: [{ id: "c1", name: "Smith, Pat", email, phone: "215-555-0100", address: "1 Main St" }],
    jobs: [{ id: "j1", customer_id: "c1", flow_type: type, current_status: "In Progress", value: 9000, created_at: "2026-11-10T12:00:00Z" }],
    equipment: equipment ?? [
      { id: "e1", customer_id: "c1", job_id: "j1", label: "Outdoor Unit", brand: "Goodman", model_number: "GSXC160361", serial_number: "2105123456", created_at: "2026-11-10", warranty_status: "not_sent" },
      { id: "e2", customer_id: "c1", job_id: "j1", label: "Furnace", brand: "Comfortmaker", model_number: "N9MSE0802714A", serial_number: "A123456789", created_at: "2026-11-10", warranty_status: "not_sent" },
    ],
    job_notes: [], chores: [], warranty_manufacturers: MFS, warranty_registrations: [], warranty_inbound: [],
  };
}

const text = (w) => w.document.getElementById("root").textContent;
// Close the jsdom window even when an assertion fails, so a failed test can't hang the run.
async function boot(t, opts) {
  const app = await bootClaudia(opts);
  t.after(() => app.window.close());
  return app;
}
// jsdom arrays come from another realm; copy before deepEqual.
const plain = (v) => JSON.parse(JSON.stringify(v));
// The equipment list starts collapsed ("▶ THIS JOB (n)").
async function expandEquipment(window) {
  const hdr = Array.from(window.document.querySelectorAll("button, div")).filter((el) => /^▶\s*THIS JOB \(/.test(el.textContent.trim()))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0];
  if (hdr) await click(window, hdr, 300);
}
// The hamburger button is three empty bars (no text).
const findBurger = (w) => Array.from(w.document.querySelectorAll("button")).find((b) => b.textContent.trim() === "" && b.querySelectorAll("span").length === 3);
const realErrors = (errs) => errs.filter((e) => !e.includes("deoptimised the styling"));

async function openJob(window) {
  await click(window, findByText(window, "BROWSE", "button"), 500);
  await click(window, findByText(window, "Smith, Pat", "div"), 600);
}
// Finishing a job drops back to the dashboard (existing behaviour), so reopen it from the list.
async function reopenJob(window) {
  await click(window, findByText(window, "Smith, Pat", "button"), 600);
}
async function setStatus(window, status) {
  await click(window, findByText(window, "UPDATE STATUS", "button"), 300);
  const opt = Array.from(window.document.querySelectorAll("button"))
    .filter((b) => b.textContent.trim().toLowerCase() === status.toLowerCase() || b.textContent.includes(status))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0];
  await click(window, opt, 1200);
}

test("app boots to the clock-in screen with no errors", async (t) => {
  const { window, errors } = await boot(t, { html: HTML, tables: fixture(), storage: STORAGE });
  await tick(window, 600);
  assert.match(text(window), /CLOCK IN/);
  assert.match(text(window), /BROWSE/);
  assert.deepEqual(realErrors(errors), []);
});

test("existing: dashboard and job detail render; completing a job still spawns Tyler's billing chore", async (t) => {
  const { window, errors, log, db } = await boot(t, { html: HTML, tables: fixture({ type: "Service Call" }), storage: STORAGE });
  await openJob(window);
  assert.match(text(window), /JOB DETAIL/);
  assert.match(text(window), /pat@example\.com/);
  await setStatus(window, "Completed/Needs Billing");
  const chore = db.chores.find((c) => c.job_id === "j1");
  assert.ok(chore, "billing chore created");
  assert.equal(chore.assigned_to, TYLER.id);
  assert.equal(db.jobs[0].current_status, "Completed/Needs Billing");
  assert.ok(db.job_notes.some((n) => /Job status → Completed\/Needs Billing/.test(n.content)), "status note written");
  // Service calls never prepare warranty emails.
  assert.equal(log.filter((l) => l.table === "warranty_registrations").length, 0);
  assert.deepEqual(realErrors(errors), []);
});

test("install completion prepares warranty rows: verified maker held only for inbox, unverified maker held", async (t) => {
  const { window, errors, db } = await boot(t, { html: HTML, tables: fixture(), storage: STORAGE });
  await openJob(window);
  await setStatus(window, "Completed/Needs Billing");
  await tick(window, 500);
  const regs = db.warranty_registrations;
  assert.equal(regs.length, 2);
  const goodman = regs.find((r) => r.equipment_id === "e1");
  const cm = regs.find((r) => r.equipment_id === "e2");
  assert.equal(goodman.brand_key, "goodman");
  assert.equal(goodman.registration_url, "https://warranty.goodmanmfg.com/newregistration/");
  assert.deepEqual(plain(goodman.hold_reasons), ["inbox_not_set"]); // ships with WARRANTY_INBOX = null
  assert.equal(goodman.status, "needs_review");
  assert.deepEqual(plain(cm.hold_reasons), ["unverified_url", "inbox_not_set"]);
  assert.equal(goodman.email_token, cm.email_token, "one ref code per job");
  assert.match(goodman.email_body, /Serial number: 2105123456/);
  assert.match(goodman.email_body, /Model number: GSXC160361/);
  assert.doesNotMatch(goodman.email_body, /icpusa/, "unverified link never in the customer email");
  // Install date filled in on completion (was empty).
  assert.ok(db.equipment.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.install_date)));
  // Billing chore still created alongside.
  assert.ok(db.chores.some((c) => c.job_id === "j1"));
  assert.deepEqual(realErrors(errors), []);
});

test("re-saving a completed install doesn't duplicate or re-prepare rows", async (t) => {
  const { window, db } = await boot(t, { html: HTML, tables: fixture(), storage: STORAGE });
  await openJob(window);
  await setStatus(window, "Completed/Needs Billing");
  await tick(window, 400);
  const first = db.warranty_registrations.map((r) => r.prepared_at).join();
  await reopenJob(window);
  await setStatus(window, "Completed/Paid");
  await tick(window, 400);
  assert.equal(db.warranty_registrations.length, 2);
  assert.equal(db.warranty_registrations.map((r) => r.prepared_at).join(), first);
});

test("before the 0006 migration runs: completion still works, warranty quietly stands down", async (t) => {
  const { window, errors, db } = await boot(t, {
    html: HTML, tables: fixture(), storage: STORAGE,
    missingTables: ["warranty_manufacturers", "warranty_registrations", "warranty_inbound"],
  });
  await openJob(window);
  await setStatus(window, "Completed/Needs Billing");
  await tick(window, 400);
  assert.equal(db.jobs[0].current_status, "Completed/Needs Billing");
  assert.ok(db.chores.some((c) => c.job_id === "j1"));
  assert.deepEqual(realErrors(errors), [], "no alerts or console errors");
  await reopenJob(window);
  await expandEquipment(window);
  // The warranty sheet falls back to the original Daikin button.
  await click(window, findByText(window, "register warranty", "button"), 600);
  assert.match(text(window), /OPEN DAIKIN REGISTRATION/);
  assert.match(text(window), /MARK AS REGISTERED/);
});

function sheetFixture() {
  const tb = fixture();
  tb.warranty_registrations = [
    { id: "r1", equipment_id: "e1", job_id: "j1", customer_id: "c1", brand_key: "goodman", email_token: "K7M3QX", status: "email_prepared", hold_reasons: [],
      registration_url: "https://warranty.goodmanmfg.com/newregistration/", email_to: "pat@example.com", email_subject: "Register your new Goodman equipment warranty", email_body: "Hi Pat,\nSerial number: 2105123456" },
  ];
  tb.equipment[0].warranty_status = "email_prepared";
  tb.equipment[0].install_date = "2026-11-16";
  return tb;
}

test("warranty sheet: SEND EMAIL calls warranty-send and shows the unit as sent", async (t) => {
  // Stand-in for the Edge Function in live mode: it marks the job's prepared rows sent.
  const fetchHandler = (url, init, db) => {
    if (!url.endsWith("/functions/v1/warranty-send")) return { status: 404, body: {} };
    const req = JSON.parse(init.body);
    const rows = db.warranty_registrations.filter((r) => r.job_id === req.job_id && r.email_token === req.email_token && r.status === "email_prepared");
    rows.forEach((r) => Object.assign(r, { status: "sent", sent_at: "2026-11-17T12:00:00Z", outbound_id: "o1" }));
    return { status: 200, body: { ok: true, mode: "live", sent_ids: rows.map((r) => r.id) } };
  };
  const { window, errors, db } = await boot(t, { html: HTML, tables: sheetFixture(), storage: STORAGE, fetchHandler });
  await openJob(window);
  await expandEquipment(window);
  assert.match(text(window), /WARRANTY EMAIL: EMAIL READY/);
  await click(window, findByText(window, "WARRANTY EMAIL: EMAIL READY", "button"), 600);
  assert.match(text(window), /OPEN GOODMAN REGISTRATION/);
  assert.doesNotMatch(text(window), /UNVERIFIED/);
  assert.equal(Array.from(window.document.querySelectorAll("a")).filter((a) => a.href.includes("subject=")).length, 0, "no mailto: sending around the tracker");
  await click(window, findByText(window, "SEND EMAIL TO PAT@EXAMPLE.COM", "button"), 600);
  const call = window.__fetchCalls.find((c) => c.url.endsWith("/functions/v1/warranty-send"));
  assert.ok(call, "warranty-send called");
  assert.deepEqual(JSON.parse(call.init.body), { job_id: "j1", email_token: "K7M3QX" });
  assert.equal(db.warranty_registrations[0].status, "sent");
  assert.match(text(window), /WAITING FOR THE CUSTOMER'S REPLY/);
  assert.match(text(window), /Their reply will be matched automatically/);
  assert.deepEqual(realErrors(errors), []);
});

test("warranty sheet: test mode says nothing was emailed and leaves the unit ready", async (t) => {
  const fetchHandler = () => ({ status: 200, body: { ok: true, mode: "test", sent_ids: [] } });
  const { window, db } = await boot(t, { html: HTML, tables: sheetFixture(), storage: STORAGE, fetchHandler });
  await openJob(window);
  await expandEquipment(window);
  await click(window, findByText(window, "WARRANTY EMAIL: EMAIL READY", "button"), 600);
  await click(window, findByText(window, "SEND EMAIL TO PAT@EXAMPLE.COM", "button"), 600);
  assert.match(text(window), /Test mode: recorded, but no email was actually sent/);
  assert.equal(db.warranty_registrations[0].status, "email_prepared");
});

test("warranty sheet: a send the server refuses shows its reason", async (t) => {
  const fetchHandler = () => ({ status: 422, body: { ok: false, error: "This email is on hold." } });
  const { window, db } = await boot(t, { html: HTML, tables: sheetFixture(), storage: STORAGE, fetchHandler });
  await openJob(window);
  await expandEquipment(window);
  await click(window, findByText(window, "WARRANTY EMAIL: EMAIL READY", "button"), 600);
  await click(window, findByText(window, "SEND EMAIL TO PAT@EXAMPLE.COM", "button"), 600);
  assert.match(text(window), /This email is on hold/);
  assert.equal(db.warranty_registrations[0].status, "email_prepared");
});

test("manual MARK AS REGISTERED still works and also closes the registration row", async (t) => {
  const tb = fixture();
  tb.warranty_registrations = [{ id: "r1", equipment_id: "e1", job_id: "j1", customer_id: "c1", brand_key: "goodman", email_token: "K7M3QX", status: "sent", hold_reasons: [] }];
  tb.equipment[0].install_date = "2026-11-16";
  const { window, db } = await boot(t, { html: HTML, tables: tb, storage: STORAGE });
  await openJob(window);
  await expandEquipment(window);
  await click(window, findByText(window, "register warranty (", "button"), 600);
  await click(window, findByText(window, "MARK AS REGISTERED", "button"), 600);
  assert.equal(db.equipment[0].warranty_registered, true);
  assert.equal(db.warranty_registrations[0].status, "registered");
  assert.equal(db.warranty_registrations[0].registered_via, "manual");
});

test("menu keeps every existing item and adds WARRANTY REVIEW; review queue matches an uncertain email", async (t) => {
  const tb = fixture();
  tb.warranty_registrations = [
    { id: "r1", equipment_id: "e1", job_id: "j1", customer_id: "c1", brand_key: "goodman", email_token: "K7M3QX", status: "sent", hold_reasons: [], created_at: "2026-11-16" },
    { id: "r2", equipment_id: "e2", job_id: "j1", customer_id: "c1", brand_key: "comfortmaker", email_token: "K7M3QX", status: "needs_review", hold_reasons: ["unverified_url"], created_at: "2026-11-16" },
  ];
  tb.warranty_inbound = [{
    id: "in1", status: "needs_review", received_at: "2026-11-16T20:00:00Z", from_email: "pat@example.com", subject: "Fwd: Your registration",
    snippet: "Thank you for registering", parsed: { tokens: ["K7M3QX"], serials: [], models: [], confirmation_number: "DK-1", reply_to_tokens: ["K7M3QX"] },
    confidence: 0.7, summary: "The job has several units and the email doesn't say which serial numbers were registered.",
    candidates: [{ registration_id: "r1", confidence: 0.7, reasons: ["job ref W-K7M3QX matches"] }],
  }];
  const { window, errors, db } = await boot(t, { html: HTML, tables: tb, storage: STORAGE });
  await click(window, findByText(window, "BROWSE", "button"), 500);
  const burger = findBurger(window);
  assert.ok(burger, "menu button");
  await click(window, burger, 300);
  for (const item of ["REFRESH", "HOURS REPORT", "CALENDAR", "BALANCES", "WARRANTY REVIEW", "MATERIALS", "CAP CALCULATOR", "SETTINGS", "SWITCH USER", "LOCK"]) {
    assert.ok(text(window).includes(item), `menu has ${item}`);
  }
  await click(window, findByText(window, "WARRANTY REVIEW", "button"), 600);
  assert.match(text(window), /REPLIES TO REVIEW \(1\)/);
  assert.match(text(window), /REPLY TO OUR EMAIL W-K7M3QX/);
  assert.match(text(window), /EMAILS ON HOLD \(1\)/);
  assert.match(text(window), /Registration link not verified/);
  // Pick the candidate and confirm.
  await click(window, findByText(window, "Smith, Pat — Outdoor Unit", "button"), 200);
  await click(window, findByText(window, "MARK 1 REGISTERED", "button"), 600);
  assert.equal(db.warranty_registrations.find((r) => r.id === "r1").status, "registered");
  assert.equal(db.warranty_registrations.find((r) => r.id === "r1").registered_via, "manual_review");
  assert.equal(db.warranty_registrations.find((r) => r.id === "r1").confirmation_number, "DK-1");
  assert.equal(db.warranty_inbound[0].status, "resolved_matched");
  assert.equal(db.warranty_inbound[0].reviewed_by, U.id);
  assert.match(text(window), /REPLIES TO REVIEW \(0\)/);
  assert.deepEqual(realErrors(errors), []);
});

test("existing screens still open: Hours report and Balances", async (t) => {
  const { window, errors } = await boot(t, { html: HTML, tables: fixture(), storage: STORAGE });
  await click(window, findByText(window, "BROWSE", "button"), 500);
  const burger = findBurger(window);
  await click(window, burger, 300);
  await click(window, findByText(window, "HOURS REPORT", "button"), 600);
  assert.match(text(window), /HOURS/);
  await click(window, findByText(window, "‹", "button"), 300);
  await click(window, findBurger(window), 300);
  await click(window, findByText(window, "BALANCES", "button"), 600);
  assert.match(text(window), /BALANCES/);
  assert.deepEqual(realErrors(errors), []);
});
