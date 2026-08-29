/**
 * Spam scoring for inbound payloads.
 *
 * Two mechanisms, deliberately separate.
 *
 * The honeypot is deterministic: a field no human can see was filled, so a
 * script filled it. It has no false positives and applies whenever a honeypot
 * key is configured, independent of the score filter.
 *
 * The heuristics are additive and each one is worth points rather than a
 * verdict, because every signal here is individually wrong sometimes. A real
 * lead does occasionally write from a throwaway address. Requiring the score to
 * clear a threshold means one odd-looking signal is never enough on its own.
 *
 * Signals that would score people rather than behaviour are deliberately
 * absent — non-Latin characters in a name, or the presence of words like "SEO"
 * in a message, would quarantine genuine customers.
 */

export type SpamSignal = { reason: string; points: number };

export type SpamVerdict = {
  score: number;
  signals: SpamSignal[];
  /** Set when a honeypot field was filled — an immediate, non-negotiable quarantine. */
  honeypot: boolean;
};

/** The score a honeypot hit reports, far above any reachable threshold. */
export const HONEYPOT_SCORE = 100;

/**
 * Addresses from these domains cannot receive a reply, so a lead arriving from
 * one is unreachable even when it is sincere. Kept short and specific: every
 * entry is a service whose stated purpose is a discardable inbox.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org',
  'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'trashmail.com',
  'dispostable.com', 'getnada.com', 'nada.email', 'fakeinbox.com',
  'maildrop.cc', 'mintemail.com', 'spamgourmet.com', 'mailnesia.com',
  'tempinbox.com', 'emailondeck.com', 'moakt.com', 'mohmal.com',
  'inboxkitten.com', 'mailcatch.com', 'mytemp.email', 'discard.email',
]);

/** Domains reserved by standards or convention — never a real correspondent. */
const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'test.com', 'localhost',
  'domain.com', 'email.com', 'yourdomain.com',
]);

const URL_RE = /https?:\/\/|www\./i;
const GLOBAL_URL_RE = /https?:\/\/[^\s<>"']+/gi;
const MARKUP_RE = /<\s*a\s|<\s*script|\[url[=\]]|\[link[=\]]|\]\(https?:/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Keys whose value is a human's name, where a URL has no business being. */
const NAME_KEYS = new Set([
  'name', 'fullName', 'firstName', 'lastName', 'contact_name', 'your_name',
]);

/** Keys carrying free prose, where several links is the classic link-blast shape. */
const MESSAGE_KEYS = new Set([
  'message', 'description', 'comments', 'notes', 'body', 'details',
  'content', 'text', 'inquiry', 'summary', 'feedback',
]);

/**
 * Score a flattened payload.
 *
 * `honeypotKey` is matched case-insensitively against the payload's own keys so
 * a form field named `website_url_confirm` matches however the sender cased it.
 */
export function scoreSpam(
  flat: Record<string, unknown>,
  honeypotKey?: string | null,
): SpamVerdict {
  const signals: SpamSignal[] = [];

  if (honeypotKey) {
    const hit = Object.entries(flat).find(
      ([k, v]) => k.toLowerCase() === honeypotKey.toLowerCase() && isFilled(v),
    );
    if (hit) {
      return {
        score: HONEYPOT_SCORE,
        signals: [{ reason: `Honeypot field "${hit[0]}" was filled`, points: HONEYPOT_SCORE }],
        honeypot: true,
      };
    }
  }

  const add = (reason: string, points: number) => signals.push({ reason, points });

  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== 'string' || value === '') continue;
    const bare = key.replace(/^(opportunity_|opp_|deal_)/i, '');

    if (NAME_KEYS.has(bare) || NAME_KEYS.has(key)) {
      if (URL_RE.test(value)) add(`Name field "${key}" contains a URL`, 4);
      if (MARKUP_RE.test(value)) add(`Name field "${key}" contains markup or a link tag`, 4);
    }

    if (MESSAGE_KEYS.has(bare) || MESSAGE_KEYS.has(key)) {
      const urls = value.match(GLOBAL_URL_RE) ?? [];
      const distinct = new Set(urls.map((u) => u.toLowerCase()));
      if (distinct.size >= 5) add(`Message field "${key}" contains ${distinct.size} links`, 3);
      if (MARKUP_RE.test(value)) add(`Message field "${key}" contains anchor or BBCode markup`, 2);
    }
  }

  // Email quality. An address that cannot be replied to makes the lead
  // worthless even when the rest of the payload looks ordinary.
  const email = firstEmail(flat);
  if (email !== null) {
    if (!EMAIL_RE.test(email)) {
      add(`Email "${truncate(email)}" is not a valid address`, 3);
    } else {
      const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
      if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
        add(`Email domain "${domain}" is a disposable inbox`, 4);
      } else if (PLACEHOLDER_EMAIL_DOMAINS.has(domain)) {
        add(`Email domain "${domain}" is a placeholder domain`, 3);
      }
    }
  }

  // The same string pasted into every box is a form-filler that did not know
  // what any of the boxes were for.
  const repeated = mostRepeatedValue(flat);
  if (repeated && repeated.count >= 4) {
    add(`The same value appears in ${repeated.count} different fields`, 2);
  }

  const phone = firstPhone(flat);
  if (phone && isImplausiblePhone(phone)) {
    add(`Phone "${truncate(phone)}" is a placeholder number`, 2);
  }

  const score = signals.reduce((sum, s) => sum + s.points, 0);
  return { score, signals, honeypot: false };
}

/** A one-line summary for the log's quarantine reason. */
export function describeVerdict(verdict: SpamVerdict): string {
  return verdict.signals.map((s) => s.reason).join('; ').slice(0, 500);
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'boolean') return value;
  return true;
}

function firstEmail(flat: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== 'string' || value === '') continue;
    if (/mail/i.test(key)) return value.trim();
  }
  return null;
}

function firstPhone(flat: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== 'string' || value === '') continue;
    if (/phone|mobile|tel|cell/i.test(key)) return value.trim();
  }
  return null;
}

/** Repeated digits (5555555555) or a straight run (1234567890). */
function isImplausiblePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return false;
  if (/^(\d)\1+$/.test(digits)) return true;
  const ascending = digits.split('').every((d, i, arr) =>
    i === 0 || Number(d) === (Number(arr[i - 1]) + 1) % 10);
  return ascending;
}

function mostRepeatedValue(
  flat: Record<string, unknown>,
): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const value of Object.values(flat)) {
    if (typeof value !== 'string') continue;
    const v = value.trim();
    // Short values legitimately repeat — a city typed into two address boxes
    // is not evidence of anything.
    if (v.length < 8) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

function truncate(s: string): string {
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}
