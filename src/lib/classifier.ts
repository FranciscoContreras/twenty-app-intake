const PROSE_KEYS = new Set([
  'message', 'description', 'analysis', 'notes', 'comments',
  'summary', 'inquiry', 'body', 'details', 'content', 'text',
  'feedback', 'about', 'additional_info', 'info', 'context',
  'requirements', 'goals', 'challenges', 'question', 'request',
]);

const NOTE_KEY_PREFIXES = ['utm_', 'ga_', 'fb_', 'gclid', 'msclkid'];

const SENTENCE_RE = /[.!?]\s+[A-Z]/g;
const LINE_BREAK_RE = /\n|\r/;

export type Classification = 'field' | 'note' | 'skip';

/**
 * Decide whether a key+value pair belongs in a CRM field or the overflow note.
 *
 * Rules (in priority order):
 * 1. Arrays / objects → note  (can't be a single field)
 * 2. Known note key names → note
 * 3. UTM / tracking prefix → note
 * 4. Contains line breaks → note
 * 5. Looks like prose (2+ sentences) → note
 * 6. Everything else → field
 */
export function classify(key: string, value: unknown): Classification {
  const normKey = key.toLowerCase().replace(/[-\s]/g, '_');

  if (Array.isArray(value)) return 'note';
  if (value !== null && typeof value === 'object') return 'note';

  if (PROSE_KEYS.has(normKey)) return 'note';
  if (NOTE_KEY_PREFIXES.some((p) => normKey.startsWith(p))) return 'note';

  if (typeof value === 'string') {
    if (LINE_BREAK_RE.test(value)) return 'note';
    const matches = value.match(SENTENCE_RE);
    if (matches && matches.length >= 2) return 'note';
  }

  return 'field';
}
