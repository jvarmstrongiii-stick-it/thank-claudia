// Warranty confirmation parsing + matching — pure functions, no I/O.
//
// Shared by the `warranty-inbound` Edge Function (Deno) and the Node unit tests in
// tests/warranty-match.test.ts, so it must stay dependency-free and use only
// erasable TypeScript (no enums / namespaces / parameter properties) — Node runs
// the tests with built-in type stripping.
//
// The flow: a customer forwards the manufacturer's "thanks for registering" email to
// the warranty inbox. We parse it, score every open registration against it, and only
// auto-mark a registration as registered when the evidence is strong AND unambiguous.
// Anything else goes to the in-app WARRANTY REVIEW queue for a human.

export const DEFAULT_AUTO_THRESHOLD = 80;

/** Minimum lead the best job must have over the runner-up job to auto-match. */
export const AMBIGUITY_MARGIN = 25;

export const SCORE = {
  token: 45,          // job ref code (warranty+CODE@ address, or "W-CODE" in the text)
  serial: 45,         // the unit's serial number appears in the email
  model: 15,          // the unit's model number appears in the email
  senderEmail: 15,    // forwarded from the customer's email address on file
  brand: 5,           // the manufacturer is named in the email
  customerName: 5,    // the customer's last name appears in the email
  confirmation: 10,   // reads like a registration confirmation
  serialConflict: -30 // the email lists serial numbers, none of them this unit's
} as const;

export interface ParsedEmail {
  fromEmail: string | null;
  tokens: string[];              // upper-case job ref codes found
  labeledSerials: string[];      // normalized values found right after a "Serial" label
  labeledModels: string[];       // normalized values found right after a "Model" label
  wordSet: string[];             // normalized alphanumeric words (for presence checks)
  confirmationNumber: string | null;
  looksLikeConfirmation: boolean;
  brandKeys: string[];           // manufacturers named in the email
  normalizedText: string;        // upper-case text, used for name checks
}

export interface ManufacturerAliasRow {
  brand_key: string;
  display_name?: string | null;
  aliases?: string[] | null;
  email_domains?: string[] | null;
}

export interface Candidate {
  registration_id: string;
  job_id: string | null;
  token: string | null;
  status: string;
  serial: string | null;
  model: string | null;
  brand_key: string | null;
  customer_email: string | null;
  customer_name: string | null;
}

export interface CandidateScore {
  registration_id: string;
  job_id: string | null;
  score: number;
  confidence: number;          // 0..1, score capped at 100
  reasons: string[];
  tokenMatch: boolean;
  serialMatch: boolean;
  conflict: boolean;
  alreadyRegistered: boolean;
}

export interface MatchResult {
  decision: "auto" | "review" | "unmatched";
  /** Registrations to mark registered (only for decision === "auto"). */
  matches: CandidateScore[];
  /** Best candidates, highest first, for the review screen. */
  candidates: CandidateScore[];
  /** Plain-English reason for the decision, shown in the review queue. */
  summary: string;
  confidence: number;
}

// ── normalisation ───────────────────────────────────────────────────────────

/** Upper-case and drop everything that isn't A-Z / 0-9 ("WC-123 45" → "WC12345"). */
export function normId(s: string | null | undefined): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Lower-case, collapse punctuation — for brand / alias comparison. */
export function normBrand(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normEmail(s: string | null | undefined): string | null {
  const m = String(s ?? "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

/** Very small HTML → text fallback for providers that only send HTML. */
export function htmlToText(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// ── parsing ─────────────────────────────────────────────────────────────────

/** Job ref code alphabet: no 0/O/1/I/L so it survives being read aloud or retyped. */
export const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TOKEN_RE_TEXT = /\bW-([A-Z2-9]{6})\b/gi;
const TOKEN_RE_ADDR = /\+([A-Za-z0-9]{6})@/g;

const CONFIRMATION_RES: RegExp[] = [
  /thank(s| you) for registering/i,
  /(registration|product registration|warranty registration)\s+(is\s+)?(complete|confirmed|successful|received)/i,
  /successfully\s+registered/i,
  /(has|have)\s+been\s+(successfully\s+)?registered/i,
  /registration\s+confirmation/i,
  /warranty\s+(certificate|registration)/i,
  /confirmation\s+(number|no\.?|#)/i,
  /your\s+(product|unit|equipment|warranty)\s+(is|has been)\s+registered/i,
];

// (?![a-z]) stops "serialized" / "models" from counting as labels; bare "SN" needs a ":" or "#".
const SERIAL_LABEL_RE = /\b(?:serial(?:\s*(?:number|no\.?|num|#))?|s\/n|sn(?=\s*[:#]))(?![a-z])\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\- ]{3,24}[A-Z0-9])/gi;
const MODEL_LABEL_RE = /\b(?:model(?:\s*(?:number|no\.?|num|#))?|m\/n)(?![a-z])\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/ ]{2,28}[A-Z0-9])/gi;
const CONFIRMATION_NO_RE = /\b(?:confirmation|registration|reference|certificate)\s*(?:number|no\.?|num|#|id|code)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-]{3,29})/i;

function uniq(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)));
}

/** A labeled value can run into the next word ("SERIAL 1234567 MODEL X") — keep the first word,
 *  but also keep the joined form for serials printed with spaces ("1234 5678"). */
function labeledValues(text: string, re: RegExp): string[] {
  const out: string[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim();
    const parts = raw.split(/\s+/);
    const vals = [parts[0]];
    // Only glue two words when both carry digits ("2105 123456"), never "2105123456 MODEL".
    if (parts[1] && /\d/.test(parts[0]) && /\d/.test(parts[1])) vals.push(parts[0] + parts[1]);
    for (const v of vals) {
      const n = normId(v);
      // A real serial/model has at least one digit; this drops label noise like "NUMBER".
      if (n.length >= 4 && /\d/.test(n)) out.push(n);
    }
  }
  return uniq(out);
}

export function parseConfirmationEmail(input: {
  from?: string | null;
  to?: string[] | string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
}, manufacturers: ManufacturerAliasRow[] = []): ParsedEmail {
  const toList = Array.isArray(input.to) ? input.to : input.to ? [input.to] : [];
  const body = (input.text && input.text.trim()) ? input.text : htmlToText(input.html);
  const full = `${input.subject ?? ""}\n${body ?? ""}`;
  const upper = full.toUpperCase();

  const tokens: string[] = [];
  for (const addr of toList) {
    TOKEN_RE_ADDR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE_ADDR.exec(addr)) !== null) tokens.push(m[1].toUpperCase());
  }
  TOKEN_RE_TEXT.lastIndex = 0;
  let t: RegExpExecArray | null;
  while ((t = TOKEN_RE_TEXT.exec(full)) !== null) tokens.push(t[1].toUpperCase());
  // Forwarded mail often quotes the original "To: warranty+CODE@…" header in the body too.
  TOKEN_RE_ADDR.lastIndex = 0;
  while ((t = TOKEN_RE_ADDR.exec(full)) !== null) tokens.push(t[1].toUpperCase());

  const words = uniq(
    (upper.match(/[A-Z0-9][A-Z0-9\-\/]{3,}[A-Z0-9]/g) || [])
      .map(normId)
      .filter((w) => w.length >= 4)
  );

  const confNo = full.match(CONFIRMATION_NO_RE);
  const lowerFull = full.toLowerCase();
  const brandKeys: string[] = [];
  for (const mf of manufacturers) {
    const names = uniq([mf.brand_key, mf.display_name ?? "", ...(mf.aliases ?? [])].map(normBrand));
    const domains = (mf.email_domains ?? []).map((d) => d.toLowerCase());
    const normFull = ` ${normBrand(full)} `;
    const named = names.some((n) => n.length >= 2 && normFull.includes(` ${n} `));
    const byDomain = domains.some((d) => lowerFull.includes(`@${d}`) || lowerFull.includes(`.${d}`));
    if (named || byDomain) brandKeys.push(mf.brand_key);
  }

  return {
    fromEmail: normEmail(input.from),
    tokens: uniq(tokens.filter((x) => [...x].every((c) => TOKEN_ALPHABET.includes(c)))),
    labeledSerials: labeledValues(full, SERIAL_LABEL_RE),
    labeledModels: labeledValues(full, MODEL_LABEL_RE),
    wordSet: words,
    confirmationNumber: confNo ? confNo[1].toUpperCase() : null,
    looksLikeConfirmation: CONFIRMATION_RES.some((re) => re.test(full)),
    brandKeys: uniq(brandKeys),
    normalizedText: upper,
  };
}

// ── scoring ─────────────────────────────────────────────────────────────────

function idPresent(id: string | null, parsed: ParsedEmail, labeled: string[]): boolean {
  const n = normId(id);
  if (n.length < 4) return false; // too short to be meaningful evidence
  return labeled.includes(n) || parsed.wordSet.includes(n);
}

function lastName(name: string | null): string | null {
  const raw = String(name ?? "").trim();
  if (!raw) return null;
  // Claudia stores many names as "Last, First" — prefer the part before the comma.
  const part = raw.includes(",") ? raw.split(",")[0] : raw.split(/\s+/).slice(-1)[0];
  const n = part.toUpperCase().replace(/[^A-Z'-]/g, "");
  return n.length >= 3 ? n : null;
}

export function scoreCandidate(c: Candidate, parsed: ParsedEmail): CandidateScore {
  const reasons: string[] = [];
  let score = 0;

  const tokenMatch = !!c.token && parsed.tokens.includes(c.token.toUpperCase());
  if (tokenMatch) { score += SCORE.token; reasons.push(`job ref W-${c.token!.toUpperCase()} matches`); }

  const serialMatch = idPresent(c.serial, parsed, parsed.labeledSerials);
  if (serialMatch) { score += SCORE.serial; reasons.push(`serial ${c.serial} found`); }

  if (idPresent(c.model, parsed, parsed.labeledModels)) { score += SCORE.model; reasons.push(`model ${c.model} found`); }

  const custEmail = normEmail(c.customer_email);
  if (custEmail && parsed.fromEmail && custEmail === parsed.fromEmail) {
    score += SCORE.senderEmail; reasons.push("sent from the customer's email on file");
  }

  if (c.brand_key && parsed.brandKeys.includes(c.brand_key)) { score += SCORE.brand; reasons.push(`mentions ${c.brand_key}`); }

  const ln = lastName(c.customer_name);
  if (ln && new RegExp(`\\b${ln.replace(/[-']/g, ".")}\\b`).test(parsed.normalizedText)) {
    score += SCORE.customerName; reasons.push("customer name appears");
  }

  if (parsed.looksLikeConfirmation) { score += SCORE.confirmation; reasons.push("reads like a registration confirmation"); }

  const conflict = !serialMatch && !!normId(c.serial) && parsed.labeledSerials.length > 0;
  if (conflict) { score += SCORE.serialConflict; reasons.push("email lists a different serial number"); }

  const capped = Math.max(0, Math.min(score, 100));
  return {
    registration_id: c.registration_id,
    job_id: c.job_id,
    score,
    confidence: Math.round(capped) / 100,
    reasons,
    tokenMatch,
    serialMatch,
    conflict,
    alreadyRegistered: c.status === "registered",
  };
}

/**
 * Decide what to do with one inbound email.
 *
 * Auto-match only when ALL hold, otherwise the email goes to manual review:
 *  - it reads like a registration confirmation;
 *  - the best job's units score >= threshold and have a hard identifier (job ref or serial);
 *  - no serial conflict on the matched unit;
 *  - the best job leads every other job by >= AMBIGUITY_MARGIN;
 *  - on a job with more than one unit, each auto-matched unit's own serial is in the email
 *    (a ref code alone can't say WHICH units the customer registered).
 */
export function matchConfirmation(
  parsed: ParsedEmail,
  candidates: Candidate[],
  opts: { threshold?: number } = {},
): MatchResult {
  const threshold = opts.threshold ?? DEFAULT_AUTO_THRESHOLD;
  const scored = candidates.map((c) => scoreCandidate(c, parsed)).sort((a, b) => b.score - a.score);
  const relevant = scored.filter((s) => s.tokenMatch || s.serialMatch || s.score >= 20);
  const top = relevant.slice(0, 5);

  if (!relevant.length) {
    return {
      decision: "unmatched",
      matches: [],
      candidates: [],
      summary: parsed.looksLikeConfirmation
        ? "Looks like a confirmation, but no ref code, serial or customer matched any equipment."
        : "No ref code, serial or customer matched, and it doesn't read like a registration confirmation.",
      confidence: 0,
    };
  }

  // Best score per job (registrations without a job count as their own group).
  const byJob = new Map<string, CandidateScore[]>();
  for (const s of relevant) {
    const key = s.job_id ?? `reg:${s.registration_id}`;
    if (!byJob.has(key)) byJob.set(key, []);
    byJob.get(key)!.push(s);
  }
  const jobRanks = Array.from(byJob.entries())
    .map(([key, list]) => ({ key, list, best: Math.max(...list.map((x) => x.score)) }))
    .sort((a, b) => b.best - a.best);
  const bestJob = jobRanks[0];
  const runnerUp = jobRanks[1];
  const confidence = Math.max(0, Math.min(bestJob.best, 100)) / 100;

  const review = (summary: string): MatchResult => ({ decision: "review", matches: [], candidates: top, summary, confidence });

  if (!parsed.looksLikeConfirmation) {
    return review("Matched equipment, but the email doesn't read like a registration confirmation.");
  }
  if (runnerUp && bestJob.best - runnerUp.best < AMBIGUITY_MARGIN) {
    return review("More than one job could match this email.");
  }

  const jobUnitCount = candidates.filter((c) => (c.job_id ?? `reg:${c.registration_id}`) === bestJob.key).length;
  const autos = bestJob.list.filter((s) =>
    s.score >= threshold &&
    (s.tokenMatch || s.serialMatch) &&
    !s.conflict &&
    (jobUnitCount === 1 || s.serialMatch)
  );

  if (!autos.length) {
    const b = bestJob.list[0];
    if (b.conflict) return review("The ref code matches, but the email lists a different serial number.");
    if (jobUnitCount > 1 && !bestJob.list.some((s) => s.serialMatch)) {
      return review("The job has several units and the email doesn't say which serial numbers were registered.");
    }
    return review(`Best match is ${Math.round(confidence * 100)}% sure, below the ${threshold}% auto-match bar.`);
  }

  const fresh = autos.filter((a) => !a.alreadyRegistered);
  return {
    decision: "auto",
    matches: autos,
    candidates: top,
    summary: fresh.length
      ? `Auto-matched ${fresh.length} unit${fresh.length > 1 ? "s" : ""} (${Math.round(confidence * 100)}% sure).`
      : "Duplicate confirmation — these units were already registered.",
    confidence,
  };
}
