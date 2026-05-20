type NoteField = { label: string; value: unknown };

/**
 * Format the overflow data as a readable markdown note body.
 *
 * Output example:
 * **Source:** contact-form
 * **Message:** Need a new website, SEO help
 * **UTM Source:** google
 * **Marketing Score:** 72
 */
export function formatNote(
  sourceName: string,
  fields: Record<string, unknown>,
): string {
  const lines: string[] = [];

  lines.push(`**Source:** ${sourceName}`);

  const entries = buildEntries(fields);

  for (const { label, value } of entries) {
    const formatted = formatValue(value);
    if (formatted !== null) {
      lines.push(`**${label}:** ${formatted}`);
    }
  }

  return lines.join('\n');
}

function buildEntries(fields: Record<string, unknown>): NoteField[] {
  return Object.entries(fields).map(([key, value]) => ({
    label: toLabel(key),
    value,
  }));
}

function toLabel(key: string): string {
  return key
    .replace(/^ext_/, '')
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
