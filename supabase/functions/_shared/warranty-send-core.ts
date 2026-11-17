// Core of the `warranty-send` Edge Function, free of Deno APIs so Node tests can drive it.
//
// The app asks us to send a job's prepared warranty email. We REBUILD the email here from the
// database (equipment, manufacturer, customer) instead of trusting the stored draft, because the
// app's key is public and anyone holding it could otherwise use this function to mail anything to
// anyone. The rebuilt text matches the app's preview (tests/warranty-send.test.ts checks parity).
//
// The tracker: every send carries
//   - Reply-To: warranty+CODE@<inbox domain>   (the job's ref code; survives any mail client)
//   - "[Ref W-CODE]" in the subject              (survives "Re:" and most forwarding)
//   - a Message-ID we choose, stored in warranty_outbound.message_ids together with whatever id
//     the provider reports, so the reply's In-Reply-To / References point straight back here.
//
// Provider is Jack's choice (Postmark, SendGrid, Mailgun or Resend). Until it's set, the function
// runs in TEST mode: it records what it would have sent and emails nobody.

export const SEND_PROVIDERS = ["postmark", "sendgrid", "mailgun", "resend"] as const;
export type SendProvider = typeof SEND_PROVIDERS[number];

export interface SendConfig {
  mode: "test" | "live";
  provider: SendProvider | null;
  apiKey: string | null;
  fromEmail: string | null;      // e.g. warranty@abcmech.com (must be verified with the provider)
  fromName: string;              // shown as the sender name, also the company name in the email
  replyInbox: string | null;     // e.g. warranty@abcmech.com — replies go to warranty+CODE@…
  mailgunDomain: string | null;
  dailyLimit: number;            // hard cap on sends per 24h (abuse guard)
}

export function readSendConfig(env: (k: string) => string | undefined): SendConfig {
  const provider = String(env("WARRANTY_EMAIL_PROVIDER") || "").toLowerCase();
  const limit = Number(env("WARRANTY_DAILY_LIMIT"));
  return {
    mode: String(env("WARRANTY_SEND_MODE") || "test").toLowerCase() === "live" ? "live" : "test",
    provider: (SEND_PROVIDERS as readonly string[]).includes(provider) ? provider as SendProvider : null,
    apiKey: env("WARRANTY_PROVIDER_KEY") || null,
    fromEmail: env("WARRANTY_FROM_EMAIL") || null,
    fromName: env("WARRANTY_FROM_NAME") || "ABC Mechanical",
    replyInbox: env("WARRANTY_REPLY_INBOX") || null,
    mailgunDomain: env("WARRANTY_MAILGUN_DOMAIN") || null,
    dailyLimit: Number.isFinite(limit) && limit > 0 ? limit : 40,
  };
}

// ── email text (mirror of buildWarrantyEmail in claudia.html's WARRANTY-CORE block) ─────────

export interface SendManufacturer {
  brand_key: string;
  display_name: string;
  registration_url: string | null;
  url_verified: boolean;
  window_days: number | null;
}
export interface SendEquipment {
  id: string;
  label: string | null;
  model_number: string | null;
  serial_number: string | null;
  install_date: string | null;
}
export interface BuiltEmail {
  to: string;
  subject: string;
  body: string;
  emailHolds: string[];
  replyTo: string | null;
  units: { equipment_id: string; brand_key: string | null; registration_url: string | null; holds: string[]; status: string }[];
}

export function codedReplyTo(inbox: string | null | undefined, token: string | null | undefined): string | null {
  const m = String(inbox || "").trim().match(/^([^@\s+]+)(?:\+[^@\s]*)?@([^@\s]+\.[^@\s]+)$/);
  if (!m || !token) return null;
  return `${m[1]}+${token}@${m[2]}`;
}

function firstName(customer: string | null | undefined): string {
  const raw = String(customer || "").trim();
  if (!raw) return "";
  const part = raw.includes(",") ? raw.split(",")[1] : raw;
  const first = (part || "").trim().split(/\s+/)[0] || "";
  return first ? first[0].toUpperCase() + first.slice(1).toLowerCase() : "";
}

function fmtDate(iso: string | null | undefined): string {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

function looksLikeEmail(s: unknown): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim());
}

export function unitHolds(eq: SendEquipment, mf: SendManufacturer | null): string[] {
  const holds: string[] = [];
  if (!mf) holds.push("unknown_manufacturer");
  else if (!mf.registration_url) holds.push("no_registration_url");
  else if (!mf.url_verified) holds.push("unverified_url");
  if (!String(eq.serial_number || "").trim()) holds.push("missing_serial");
  if (!String(eq.model_number || "").trim()) holds.push("missing_model");
  return holds;
}

export function buildEmail(args: {
  job: { customer: string | null; email: string | null };
  units: { eq: SendEquipment; mf: SendManufacturer | null }[];
  token: string;
  inbox: string | null;
  company: string;
  today: string;
}): BuiltEmail {
  const { job, token, inbox, company, today } = args;
  const reply = codedReplyTo(inbox, token);
  const to = looksLikeEmail(job && job.email) ? String(job.email).trim() : "";
  const emailHolds: string[] = [];
  if (!to) emailHolds.push("no_customer_email");
  if (!reply) emailHolds.push("inbox_not_set");

  const results = (args.units || []).map(({ eq, mf }) => ({
    eq, mf, holds: unitHolds(eq, mf), status: "",
    equipment_id: eq.id,
    brand_key: mf ? mf.brand_key : null,
    registration_url: mf && mf.registration_url ? mf.registration_url : null,
  }));
  const ready = results.filter((u) => !u.holds.length);
  results.forEach((u) => {
    u.status = (u.holds.length || emailHolds.length || !ready.length) ? "needs_review" : "email_prepared";
  });

  const makers = Array.from(new Set(ready.map((u) => u.mf!.display_name)));
  const windows = ready.map((u) => u.mf!.window_days).filter((n): n is number => Number.isFinite(n) && (n as number) > 0);
  const windowDays = windows.length ? Math.min(...windows) : null;
  const ref = token ? `W-${token}` : "";
  const subject = `Register your new ${makers.length ? makers.join(" & ") + " " : ""}equipment warranty — ${company}${ref ? ` [Ref ${ref}]` : ""}`;

  const first = firstName(job && job.customer);
  const lines: string[] = [];
  lines.push(`Hi ${first || "there"},`);
  lines.push("");
  lines.push(`Thank you for choosing ${company} for your installation. To get the full manufacturer warranty, please register your new equipment with the manufacturer${windowDays ? ` within ${windowDays} days of installation` : " as soon as you can"}. Here are the details you'll need:`);
  for (const u of ready) {
    const installed = fmtDate(u.eq.install_date || today);
    lines.push("");
    lines.push(`${u.eq.label ? u.eq.label + " — " : ""}${u.mf!.display_name}`);
    lines.push(`  Model number: ${String(u.eq.model_number).trim()}`);
    lines.push(`  Serial number: ${String(u.eq.serial_number).trim()}`);
    if (installed) lines.push(`  Installation date: ${installed}`);
    lines.push(`  Register at: ${u.mf!.registration_url}`);
  }
  lines.push("");
  if (reply) {
    lines.push("Once you've registered, just reply to this email and paste in (or attach) the confirmation the manufacturer sends you. That's all we need to record your warranty as registered.");
    lines.push("");
  }
  if (ref) lines.push(`Your reference: ${ref}`);
  lines.push("");
  lines.push("Thank you,");
  lines.push(company);

  return {
    to, subject, body: lines.join("\n"), emailHolds, replyTo: reply,
    units: results.map((u) => ({
      equipment_id: u.equipment_id, brand_key: u.brand_key, registration_url: u.registration_url,
      holds: u.holds.concat(emailHolds), status: u.status,
    })),
  };
}

// ── provider calls ───────────────────────────────────────────────────────────

export interface OutgoingMessage {
  fromEmail: string;
  fromName: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  messageId: string; // without <>
  ref: string;       // W-CODE
}

export function newMessageId(token: string, domain: string, rand: string): string {
  return `warranty.${token}.${rand}@${domain}`.toLowerCase();
}

/** The HTTP request each provider expects. Pure, so tests can check it without the network. */
export function providerRequest(provider: SendProvider, msg: OutgoingMessage, cfg: Pick<SendConfig, "apiKey" | "mailgunDomain">): { url: string; init: RequestInit } {
  const from = `${msg.fromName} <${msg.fromEmail}>`;
  const key = cfg.apiKey || "";
  switch (provider) {
    case "postmark":
      return {
        url: "https://api.postmarkapp.com/email",
        init: {
          method: "POST",
          headers: { "Accept": "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": key },
          body: JSON.stringify({
            From: from, To: msg.to, ReplyTo: msg.replyTo, Subject: msg.subject, TextBody: msg.text,
            MessageStream: "outbound", Headers: [{ Name: "X-Claudia-Ref", Value: msg.ref }],
          }),
        },
      };
    case "sendgrid":
      return {
        url: "https://api.sendgrid.com/v3/mail/send",
        init: {
          method: "POST",
          headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: msg.to }] }],
            from: { email: msg.fromEmail, name: msg.fromName },
            reply_to: { email: msg.replyTo },
            subject: msg.subject,
            content: [{ type: "text/plain", value: msg.text }],
            headers: { "Message-ID": `<${msg.messageId}>`, "X-Claudia-Ref": msg.ref },
          }),
        },
      };
    case "mailgun": {
      const form = new URLSearchParams();
      form.set("from", from); form.set("to", msg.to); form.set("subject", msg.subject); form.set("text", msg.text);
      form.set("h:Reply-To", msg.replyTo); form.set("h:Message-Id", `<${msg.messageId}>`); form.set("h:X-Claudia-Ref", msg.ref);
      return {
        url: `https://api.mailgun.net/v3/${cfg.mailgunDomain}/messages`,
        init: { method: "POST", headers: { "Authorization": `Basic ${btoa(`api:${key}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() },
      };
    }
    case "resend":
      return {
        url: "https://api.resend.com/emails",
        init: {
          method: "POST",
          headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from, to: [msg.to], reply_to: msg.replyTo, subject: msg.subject, text: msg.text,
            headers: { "Message-ID": `<${msg.messageId}>`, "X-Claudia-Ref": msg.ref },
          }),
        },
      };
  }
}

/** Pull the provider's own message id out of its response, so a reply referencing it still matches. */
export async function providerMessageId(provider: SendProvider, res: Response): Promise<string | null> {
  try {
    if (provider === "sendgrid") return res.headers.get("x-message-id");
    const j = await res.json() as Record<string, unknown>;
    const id = provider === "postmark" ? j.MessageID : j.id;
    return typeof id === "string" ? id.replace(/^<|>$/g, "").toLowerCase() : null;
  } catch {
    return null;
  }
}

// ── the send itself ──────────────────────────────────────────────────────────

export interface SendUnitRow {
  registration_id: string;
  status: string;
  equipment: SendEquipment;
  manufacturer: SendManufacturer | null;
}

export interface SendStore {
  /** The job, its customer, and the registrations on it carrying this ref code. */
  loadJob(jobId: string, token: string): Promise<{ customer: string | null; email: string | null; units: SendUnitRow[] } | null>;
  countOutboundSince(sinceIso: string): Promise<number>;
  hasSent(token: string): Promise<boolean>;
  insertOutbound(row: Record<string, unknown>): Promise<string>;
  markSent(registrationIds: string[], fields: { sent_at: string; outbound_id: string }): Promise<void>;
}

export interface SendResult {
  http: number;
  body: { ok: boolean; mode?: "test" | "live"; sent_ids?: string[]; outbound_id?: string; error?: string; holds?: string[] };
}

export async function sendJobWarrantyEmail(
  store: SendStore,
  req: { job_id?: unknown; email_token?: unknown },
  cfg: SendConfig,
  deps: { fetch: typeof fetch; now?: () => Date; rand?: () => string },
): Promise<SendResult> {
  const jobId = typeof req.job_id === "string" ? req.job_id : "";
  const token = typeof req.email_token === "string" ? req.email_token.toUpperCase() : "";
  if (!jobId || !/^[A-Z2-9]{6}$/.test(token)) return { http: 400, body: { ok: false, error: "job_id and email_token are required" } };

  const now = (deps.now ?? (() => new Date()))();
  if (cfg.mode === "live" && await store.hasSent(token)) {
    return { http: 409, body: { ok: false, error: "This warranty email was already sent." } };
  }
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  if (await store.countOutboundSince(since) >= cfg.dailyLimit) {
    return { http: 429, body: { ok: false, error: "Daily warranty email limit reached." } };
  }

  const job = await store.loadJob(jobId, token);
  if (!job || !job.units.length) return { http: 404, body: { ok: false, error: "No prepared warranty email for this job." } };

  const today = now.toISOString().slice(0, 10);
  const built = buildEmail({
    job, token, inbox: cfg.replyInbox, company: cfg.fromName, today,
    units: job.units.map((u) => ({ eq: u.equipment, mf: u.manufacturer })),
  });
  const readyIds = job.units
    .filter((u, i) => built.units[i].status === "email_prepared" && u.status === "email_prepared")
    .map((u) => u.registration_id);
  if (built.emailHolds.length || !readyIds.length) {
    return { http: 422, body: { ok: false, error: "This email is on hold.", holds: built.emailHolds.length ? built.emailHolds : built.units.flatMap((u) => u.holds) } };
  }

  const domain = String(cfg.replyInbox || cfg.fromEmail || "warranty.invalid").split("@").pop() || "warranty.invalid";
  const messageId = newMessageId(token, domain, (deps.rand ?? (() => crypto.randomUUID().replace(/-/g, "").slice(0, 16)))());
  const base = {
    email_token: token, job_id: jobId, registration_ids: readyIds, to_email: built.to, reply_to: built.replyTo,
    subject: built.subject, body: built.body, provider: cfg.mode === "live" ? cfg.provider : "test",
  };

  if (cfg.mode !== "live") {
    const id = await store.insertOutbound({ ...base, status: "test", message_ids: [messageId] });
    return { http: 200, body: { ok: true, mode: "test", outbound_id: id, sent_ids: [] } };
  }
  if (!cfg.provider || !cfg.apiKey || !cfg.fromEmail || (cfg.provider === "mailgun" && !cfg.mailgunDomain)) {
    return { http: 503, body: { ok: false, error: "Email sending isn't configured yet." } };
  }

  const msg: OutgoingMessage = {
    fromEmail: cfg.fromEmail, fromName: cfg.fromName, to: built.to, replyTo: built.replyTo!, subject: built.subject,
    text: built.body, messageId, ref: `W-${token}`,
  };
  const { url, init } = providerRequest(cfg.provider, msg, cfg);
  let res: Response;
  try {
    res = await deps.fetch(url, init);
  } catch (e) {
    await store.insertOutbound({ ...base, status: "failed", message_ids: [messageId], error: String(e).slice(0, 500) });
    return { http: 502, body: { ok: false, error: "Couldn't reach the email service." } };
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    await store.insertOutbound({ ...base, status: "failed", message_ids: [messageId], error: `${res.status} ${detail}` });
    return { http: 502, body: { ok: false, error: `The email service refused the message (${res.status}).` } };
  }
  const providerId = await providerMessageId(cfg.provider, res);
  const sentAt = now.toISOString();
  const outboundId = await store.insertOutbound({
    ...base, status: "sent", sent_at: sentAt, message_ids: providerId ? [messageId, providerId] : [messageId],
  });
  await store.markSent(readyIds, { sent_at: sentAt, outbound_id: outboundId });
  return { http: 200, body: { ok: true, mode: "live", outbound_id: outboundId, sent_ids: readyIds } };
}
