/**
 * Re-running a payload that was already received.
 *
 * The problem this solves is a mapping added too late. A field arrives for weeks
 * with no rule to place it, goes into the overflow note, and the day someone
 * writes the rule it only applies to what comes next — everything already in the
 * CRM has to be repaired by hand from note text, if it can be repaired at all.
 * Replay runs the stored payloads back through the rules as they exist now, so
 * the fix reaches the records that needed it.
 *
 * Distinct from retry, which exists for failures and refuses a log that already
 * succeeded. Replay is for logs that succeeded: the run worked, the mapping was
 * simply not there yet.
 */

import { coreApi } from './rest-client';
import { runIngestion } from './ingest';
import { replayMaxBatch } from './settings';

export type StoredLog = {
  id: string;
  status: string;
  rawPayload: string | null;
  intakeSourceId: string | null;
  processedAt: string | null;
};

export type ReplayResult = {
  logId: string;
  ok: boolean;
  reason?: string;
  recordId?: string | undefined;
  personId?: string | undefined;
  companyId?: string | undefined;
  opportunityId?: string | undefined;
  fieldsCreated?: number;
  warnings?: string[];
};

export async function loadLog(logId: string): Promise<StoredLog | null> {
  try {
    const res = await coreApi.get<{ data: { intakeLog: StoredLog } }>(`/intakeLogs/${logId}`);
    return res.data?.intakeLog ?? null;
  } catch {
    return null;
  }
}

export async function slugForSource(sourceId: string | null): Promise<string | null> {
  if (!sourceId) return null;
  try {
    const res = await coreApi.get<{ data: { intakeSource: { slug: string } } }>(`/intakeSources/${sourceId}`);
    return res.data?.intakeSource?.slug ?? null;
  } catch {
    return null;
  }
}

/**
 * Replay one stored log.
 *
 * Deduplication is bypassed, because the payload is by definition one we have
 * seen — that is the whole point. Spam scoring is not bypassed: a payload that
 * would be quarantined today should still be quarantined when it is replayed.
 */
export async function replayLog(log: StoredLog): Promise<ReplayResult> {
  if (!log.rawPayload) {
    return {
      logId: log.id,
      ok: false,
      reason: 'No stored payload — retention was off, or the payload exceeded the size cap when it arrived',
    };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(log.rawPayload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { logId: log.id, ok: false, reason: 'Stored payload is not a JSON object' };
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return { logId: log.id, ok: false, reason: 'Stored payload is not valid JSON' };
  }

  const slug = await slugForSource(log.intakeSourceId);
  if (!slug) {
    return { logId: log.id, ok: false, reason: 'The source for this log no longer exists' };
  }

  const outcome = await runIngestion({
    sourceSlug: slug,
    rawPayload: payload,
    // The signature was checked when the payload first arrived; there is no body
    // to re-verify against and the request is now coming from an authenticated
    // operator rather than the network.
    skipDedup: true,
    replayOfLogId: log.id,
  });

  if (!outcome.ok) {
    return { logId: log.id, ok: false, reason: `${outcome.error.code}: ${outcome.error.message}` };
  }

  return {
    logId: log.id,
    ok: true,
    recordId: outcome.ctx.personId ?? outcome.ctx.companyId,
    personId: outcome.ctx.personId,
    companyId: outcome.ctx.companyId,
    opportunityId: outcome.ctx.opportunityId,
    fieldsCreated: outcome.ctx.fieldsCreated,
    warnings: outcome.ctx.warnings,
  };
}

export type BulkQuery = {
  sourceSlug?: string | undefined;
  status?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  limit?: number | undefined;
};

/**
 * Select logs for a bulk replay.
 *
 * Capped by INTAKE_REPLAY_MAX_BATCH, and the cap is not negotiable from the
 * request: a replay writes to the CRM for every log it touches, and an
 * unbounded one aimed at a year of history would rewrite a workspace in a single
 * call. Callers wanting more run several batches and can see what each one did.
 */
export async function selectLogs(query: BulkQuery): Promise<StoredLog[]> {
  const max = replayMaxBatch();
  const limit = Math.min(query.limit ?? max, max);

  const filters: string[] = [];
  if (query.status) filters.push(`status[eq]:${encodeURIComponent(query.status)}`);
  if (query.since) filters.push(`processedAt[gte]:${encodeURIComponent(query.since)}`);
  if (query.until) filters.push(`processedAt[lte]:${encodeURIComponent(query.until)}`);

  if (query.sourceSlug) {
    const sourceId = await idForSlug(query.sourceSlug);
    if (!sourceId) return [];
    filters.push(`intakeSourceId[eq]:${sourceId}`);
  }

  const qs = [
    filters.length > 0 ? `filter=${filters.join(',')}` : '',
    `orderBy=processedAt[AscNullsLast]`,
    `limit=${limit}`,
  ].filter(Boolean).join('&');

  try {
    const res = await coreApi.get<{ data: { intakeLogs: { edges: Array<{ node: StoredLog }> } } }>(
      `/intakeLogs?${qs}`,
    );
    return (res.data?.intakeLogs?.edges ?? []).map((e) => e.node);
  } catch {
    return [];
  }
}

async function idForSlug(slug: string): Promise<string | null> {
  try {
    const res = await coreApi.get<{ data: { intakeSources: { edges: Array<{ node: { id: string } }> } } }>(
      `/intakeSources?filter=slug[eq]:${encodeURIComponent(slug)}&first=1`,
    );
    return res.data?.intakeSources?.edges?.[0]?.node?.id ?? null;
  } catch {
    return null;
  }
}
