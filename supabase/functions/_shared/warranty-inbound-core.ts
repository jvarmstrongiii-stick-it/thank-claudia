// Provider-agnostic core of the `warranty-inbound` Edge Function, kept free of Deno APIs so the
// Node tests can drive it end-to-end with an in-memory store (tests/warranty-inbound.test.ts).
//
// Customers REPLY to the warranty email we sent (warranty-send). The reply is tied back to that
// exact send by the tracker: its In-Reply-To / References headers carry our Message-ID, and the
// coded Reply-To address (warranty+CODE@…) carries the job's ref code.
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
  /** Message-IDs this email replies to (In-Reply-To + References), lower-case, no <>. */
  thread_ids: string[];
}

/** One email we sent (warranty_outbound). */
export interface OutboundRow {
  id: string;
  email_token: string;
  to_email: string | null;
  message_ids: string[] | null;
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
  /** Our sends whose Message-ID is in threadIds, or whose ref code is in tokens. */
  findOutbound(q: { threadIds: string[]; tokens: string[] }): Promise<OutboundRow[]>;
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

/** "<a@x> <b@y>" or ["<a@x>"] → ["a@x", "b@y"] */
export function parseMessageIds(...vals: unknown[]): string[] {
  const out: string[] = [];
  for (const v of vals) {
    const list = Array.isArray(v) ? v : [v];
    for (const item of list) {
      if (typeof item !== "string") continue;
      const bracketed = item.match(/<[^<>\s]+>/g);
      const ids = bracketed ? bracketed.map((x) => x.slice(1, -1)) : item.split(/[\s,]+/);
      for (const id of ids) if (id && id.includes("@")) out.push(id.toLowerCase());
    }
  }
  return Array.from(new Set(out));
}

function headerFromBlob(blob: string, name: string): string | null {
  // Unfold continuation lines, then pick the header.
  const unfolded = blob.replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : null;
}

function headerFromList(list: unknown, name: string): string | null {
  if (!Array.isArray(list)) return null;
  for (const h of list) {
    if (Array.isArray(h) && String(h[0]).toLowerCase() === name.toLowerCase()) return String(h[1]);
    if (h && typeof h === "object" && "Name" in h && String((h as { Name: unknown }).Name).toLowerCase() === name.toLowerCase()) {
      return String((h as { Value: unknown }).Value);
    }
  }
  return null;
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
      thread_ids: parseMessageIds(headerFromList(body.Headers, "In-Reply-To"), headerFromList(body.Headers, "References")),
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
      thread_ids: (() => {
        let mh: unknown = body["message-headers"];
        if (typeof mh === "string") { try { mh = JSON.parse(mh); } catch { mh = null; } }
        return parseMessageIds(body["In-Reply-To"], body.References, headerFromList(mh, "In-Reply-To"), headerFromList(mh, "References"));
      })(),
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
    thread_ids: parseMessageIds(
      body.in_reply_to, body.inReplyTo, body.references,
      headers ? headerFromBlob(headers, "In-Reply-To") : null,
      headers ? headerFromBlob(headers, "References") : null,
    ),
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

  // The tracker: which of our sends is this a reply to?
  const addressTokens = Array.from(new Set(email.to.flatMap((a) => Array.from(a.matchAll(/\+([A-Za-z0-9]{6})@/g), (m) => m[1].toUpperCase()))));
  const outbound = (email.thread_ids.length || addressTokens.length)
    ? await store.findOutbound({
      threadIds: Array.from(new Set(email.thread_ids.concat(email.thread_ids.map((t) => t.split("@")[0])))),
      tokens: addressTokens,
    })
    : [];
  const sender = normEmail(email.from);
  const repliedTo = outbound.filter((o) =>
    // Stored ids are ours ("warranty.CODE.x@domain") plus the provider's, which may lack a domain
    // (Postmark returns a bare UUID), so also compare against the part before the "@".
    (o.message_ids ?? []).some((raw) => {
      const id = String(raw).toLowerCase().replace(/^<|>$/g, "");
      return email.thread_ids.some((t) => t === id || t.split("@")[0] === id);
    }) ||
    (addressTokens.includes(String(o.email_token).toUpperCase()) && !!sender && normEmail(o.to_email) === sender)
  );
  const replyTokens = Array.from(new Set(repliedTo.map((o) => String(o.email_token).toUpperCase())));

  const parsed = parseConfirmationEmail({ ...email, replyTokens }, manufacturers);
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
      reply_to_tokens: replyTokens,
    },
    outbound_id: repliedTo.length ? repliedTo[0].id : null,
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
