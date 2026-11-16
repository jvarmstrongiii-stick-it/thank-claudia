// Provider-agnostic core of the `warranty-inbound` Edge Function, kept free of Deno APIs so the
// Node tests can drive it end-to-end with an in-memory store (tests/warranty-inbound.test.ts).
//
// Any inbound-email provider works as long as it can POST the message to the function URL:
//   - Postmark inbound webhook (JSON: From, To, Subject, TextBody, HtmlBody, MessageID)
//   - SendGrid Inbound Parse (multipart form: from, to, subject, text, html, headers)
//   - Mailgun routes (form: sender/from, recipient/To, subject, body-plain, body-html, Message-Id)
//   - Cloudflare Email Routing → small Email Worker that POSTs generic JSON
//   - generic JSON: { from, to, subject, text, html, message_id }
// The provider choice (and the inbox address) is Jack's decision — see the PR description.

import {
  DEFAULT_AUTO_THRESHOLD,
  matchConfirmation,
  normEmail,
  parseConfirmationEmail,
  type Candidate,
  type ManufacturerAliasRow,
  type MatchResult,
} from "./warranty-match.ts";

export interface NormalizedEmail {
  provider: string;
  message_id: string | null;
  from: string | null;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
}

export interface RegistrationRow {
  id: string;
  job_id: string | null;
  email_token: string | null;
  status: string;
  brand_key: string | null;
  equipment: { serial_number: string | null; model_number: string | null } | null;
  customers: { name: string | null; email: string | null } | null;
}

/** The handful of database operations the function needs — Supabase in prod, a fake in tests. */
export interface WarrantyStore {
  findInboundByMessageId(messageId: string): Promise<{ id: string; status: string } | null>;
  insertRaw(row: { provider: string; message_id: string | null; payload: unknown }): Promise<string | null>;
  insertInbound(row: Record<string, unknown>): Promise<string>;
  loadManufacturers(): Promise<ManufacturerAliasRow[]>;
  loadRegistrations(): Promise<RegistrationRow[]>;
  markRegistered(ids: string[], fields: { confirmation_number: string | null; matched_inbound_id: string }): Promise<void>;
}

const SNIPPET_CHARS = 1500;

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function splitAddresses(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.flatMap((x) => (typeof x === "string" ? splitAddresses(x) : x && typeof x === "object" && "Email" in x ? [String((x as { Email: unknown }).Email)] : []));
  }
  if (typeof v !== "string") return [];
  return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

/** Map whatever the provider sent into one shape. `body` is parsed JSON or form fields. */
export function normalizeInbound(body: Record<string, unknown>): NormalizedEmail {
  // Postmark: capitalised keys
  if ("TextBody" in body || "HtmlBody" in body || "MessageID" in body) {
    return {
      provider: "postmark",
      message_id: firstString(body.MessageID),
      from: firstString((body.FromFull as { Email?: string } | undefined)?.Email, body.From),
      to: splitAddresses(body.ToFull ?? body.To).concat(splitAddresses(body.OriginalRecipient)),
      subject: firstString(body.Subject),
      text: firstString(body.TextBody),
      html: firstString(body.HtmlBody),
    };
  }
  // Mailgun routes
  if ("body-plain" in body || "body-html" in body || "Message-Id" in body) {
    return {
      provider: "mailgun",
      message_id: firstString(body["Message-Id"]),
      from: firstString(body.sender, body.from, body.From),
      to: splitAddresses(body.recipient).concat(splitAddresses(body.To)),
      subject: firstString(body.subject, body.Subject),
      text: firstString(body["body-plain"]),
      html: firstString(body["body-html"]),
    };
  }
  // SendGrid Inbound Parse puts the Message-ID inside the raw headers blob.
  const headers = typeof body.headers === "string" ? body.headers : "";
  const hdrId = headers.match(/^Message-ID:\s*(.+)$/im);
  return {
    provider: headers ? "sendgrid" : "generic",
    message_id: firstString(body.message_id, body.messageId, hdrId ? hdrId[1] : null),
    from: firstString(body.from),
    to: splitAddresses(body.to).concat(splitAddresses(body.envelope_to)),
    subject: firstString(body.subject),
    text: firstString(body.text),
    html: firstString(body.html),
  };
}

export function toCandidates(rows: RegistrationRow[]): Candidate[] {
  return rows.map((r) => ({
    registration_id: r.id,
    job_id: r.job_id,
    token: r.email_token,
    status: r.status,
    serial: r.equipment?.serial_number ?? null,
    model: r.equipment?.model_number ?? null,
    brand_key: r.brand_key,
    customer_email: r.customers?.email ?? null,
    customer_name: r.customers?.name ?? null,
  }));
}

export interface ProcessOutcome {
  inbound_id: string | null;
  duplicate: boolean;
  status: "auto_matched" | "needs_review" | "unmatched" | "duplicate";
  result?: MatchResult;
}

/**
 * Store the email, match it, and auto-register only when the matcher is sure.
 * Never throws for "bad" mail — anything odd lands in the review queue.
 */
export async function processInboundEmail(
  store: WarrantyStore,
  rawPayload: unknown,
  email: NormalizedEmail,
  opts: { threshold?: number } = {},
): Promise<ProcessOutcome> {
  if (email.message_id) {
    const existing = await store.findInboundByMessageId(email.message_id);
    if (existing) return { inbound_id: existing.id, duplicate: true, status: "duplicate" };
  }

  const rawId = await store.insertRaw({ provider: email.provider, message_id: email.message_id, payload: rawPayload });
  const [manufacturers, registrations] = await Promise.all([store.loadManufacturers(), store.loadRegistrations()]);

  const parsed = parseConfirmationEmail(email, manufacturers);
  const result = matchConfirmation(parsed, toCandidates(registrations), { threshold: opts.threshold ?? DEFAULT_AUTO_THRESHOLD });

  const status = result.decision === "auto" ? "auto_matched" : result.decision === "review" ? "needs_review" : "unmatched";
  const bodyText = (email.text && email.text.trim()) ? email.text : (email.html ?? "");
  const inboundId = await store.insertInbound({
    raw_id: rawId,
    provider: email.provider,
    message_id: email.message_id,
    from_email: normEmail(email.from),
    to_addresses: email.to,
    subject: email.subject,
    snippet: bodyText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, SNIPPET_CHARS),
    parsed: {
      tokens: parsed.tokens,
      serials: parsed.labeledSerials,
      models: parsed.labeledModels,
      brands: parsed.brandKeys,
      confirmation_number: parsed.confirmationNumber,
      looks_like_confirmation: parsed.looksLikeConfirmation,
    },
    status,
    confidence: result.confidence,
    summary: result.summary,
    candidates: result.candidates,
    matched_registration_ids: result.matches.map((m) => m.registration_id),
  });

  if (result.decision === "auto") {
    const toMark = result.matches.filter((m) => !m.alreadyRegistered).map((m) => m.registration_id);
    if (toMark.length) {
      await store.markRegistered(toMark, { confirmation_number: parsed.confirmationNumber, matched_inbound_id: inboundId });
    }
  }

  return { inbound_id: inboundId, duplicate: false, status, result };
}

/** Constant-time string compare for the shared webhook secret. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Secret can arrive as a header, ?key=, or HTTP basic-auth password (SendGrid/Mailgun URLs). */
export function extractSecret(headers: { get(name: string): string | null }, url: URL): string | null {
  const h = headers.get("x-warranty-secret");
  if (h) return h;
  const q = url.searchParams.get("key");
  if (q) return q;
  const auth = headers.get("authorization") || "";
  const m = auth.match(/^Basic\s+(.+)$/i);
  if (m) {
    try {
      const decoded = atob(m[1]);
      const idx = decoded.indexOf(":");
      return idx >= 0 ? decoded.slice(idx + 1) : decoded;
    } catch {
      return null;
    }
  }
  return null;
}
