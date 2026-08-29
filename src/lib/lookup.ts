/**
 * Finding the record an incoming payload refers to.
 *
 * Both the live upsert and the dry-run diff need this, and they must agree: a
 * preview that says "update" while the real run creates a second contact is
 * worse than no preview. Sharing the query is what keeps them honest, so the
 * two callers ask the same question of the same endpoint with the same filter.
 *
 * The full record comes back, not just the id, because the merge policy has to
 * compare against what is already written before deciding whether to overwrite.
 */

import { coreApi } from './rest-client';

export type ExistingRecord = Record<string, unknown> & { id: string };

/** Twenty's REST list shape, whatever collection is being read. */
type ListResponse = {
  data?: Record<string, { edges?: Array<{ node?: ExistingRecord }> }>;
};

async function firstMatch(collection: string, query: string): Promise<ExistingRecord | null> {
  try {
    const res = await coreApi.get<ListResponse>(`/${collection}?${query}&first=1`);
    return res.data?.[collection]?.edges?.[0]?.node ?? null;
  } catch {
    // A lookup failure must not stop an ingestion. Treating it as "not found"
    // means the pipeline creates a record instead of dropping the lead; a
    // duplicate contact is recoverable, a lost enquiry is not.
    return null;
  }
}

export async function findPersonByEmail(email: string): Promise<ExistingRecord | null> {
  if (!email) return null;
  return firstMatch('people', `filter=emails.primaryEmail[eq]:${encodeURIComponent(email)}`);
}

export async function findCompanyByDomain(domain: string): Promise<ExistingRecord | null> {
  if (!domain) return null;
  const host = extractHost(domain);
  if (!host) return null;
  return firstMatch(
    'companies',
    `filter=domainName.primaryLinkUrl[like]:%25${encodeURIComponent(host)}%25`,
  );
}

export function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The email an assembled payload will dedupe on, if any. */
export function primaryEmailOf(assembled: Record<string, unknown>): string {
  const emails = assembled['emails'] as Record<string, unknown> | undefined;
  const value = emails?.['primaryEmail'];
  return typeof value === 'string' ? value : '';
}

/** The domain an assembled payload will dedupe on, if any. */
export function primaryDomainOf(standard: Record<string, unknown>): string {
  const domainName = standard['domainName'] as Record<string, unknown> | undefined;
  const value = domainName?.['primaryLinkUrl'];
  return typeof value === 'string' ? value : '';
}
