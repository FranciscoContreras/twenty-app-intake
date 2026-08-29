/**
 * One way to run an ingestion, shared by every entry point.
 *
 * The webhook, a replay, a retry and a quarantine release all run the same
 * pipeline and all have to deal with the same terminal outcomes. Keeping that in
 * one place is what stops the endpoints drifting apart — before this, only the
 * happy path wrote an IntakeLog, so a rejected signature or a failed record
 * write left nothing behind at all and `totalFailed` never moved off zero.
 */

import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { createPipeline } from './pipeline-factory';
import type { PipelineContext } from './pipeline';
import type { AppError } from './result';
import { writeIntakeLog, bumpSourceCounters, type LogStatus } from './intake-log-writer';

export type IngestOptions = {
  sourceSlug: string;
  rawPayload: Record<string, unknown>;
  rawBody?: string | undefined;
  headers?: Record<string, string | undefined>;
  idempotencyKey?: string | undefined;
  skipDedup?: boolean;
  skipSpamFilter?: boolean;
  replayOfLogId?: string | undefined;
};

export type IngestOutcome =
  | { ok: true; ctx: PipelineContext }
  | { ok: false; error: AppError; ctx: PipelineContext };

export async function runIngestion(options: IngestOptions): Promise<IngestOutcome> {
  const ctx: PipelineContext = {
    sourceSlug: options.sourceSlug,
    rawBody: options.rawBody,
    rawPayload: options.rawPayload,
    headers: options.headers ?? {},
    startedAt: Date.now(),
    fieldsCreated: 0,
    fieldsMatched: 0,
    warnings: [],
    events: [],
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options.skipDedup ? { skipDedup: true } : {}),
    ...(options.skipSpamFilter ? { skipSpamFilter: true } : {}),
    ...(options.replayOfLogId ? { replayOfLogId: options.replayOfLogId } : {}),
  };

  const pipeline = createPipeline(new CoreApiClient(), new MetadataApiClient());
  const result = await pipeline.run(ctx);

  if (result.ok) return { ok: true, ctx: result.value };

  await recordFailure(ctx, result.error);
  return { ok: false, error: result.error, ctx };
}

/**
 * Log a terminal outcome.
 *
 * Two cases deliberately write nothing. An unknown slug has no source to attach
 * a log to, and logging it anyway would let anyone fill the workspace with rows
 * by POSTing to invented URLs. A duplicate is already represented by the log of
 * the request that succeeded; recording the retry as well would double-count
 * every ingestion in the dashboard.
 */
async function recordFailure(ctx: PipelineContext, error: AppError): Promise<void> {
  if (error.code === 'SOURCE_NOT_FOUND') return;
  if (error.code === 'DUPLICATE_PAYLOAD') return;

  const details = (error.details ?? {}) as { spamScore?: number; reason?: string };
  const quarantined = error.code === 'QUARANTINED';
  const status: LogStatus = quarantined ? 'QUARANTINED' : 'FAILED';

  await writeIntakeLog({
    ctx,
    status,
    error: `${error.code}: ${error.message}`,
    spamScore: details.spamScore ?? null,
    quarantineReason: quarantined ? (details.reason ?? error.message) : null,
  });

  // A quarantine is the filter working, not the source breaking. Counting it as
  // a failure would make a well-defended form look like a broken one.
  if (ctx.source && !quarantined) await bumpSourceCounters(ctx.source.id, 'failed');
}

/**
 * The HTTP status for a terminal error.
 *
 * A quarantine answers 202: the request was well-formed and has been accepted
 * for review. Returning an error instead would tell a bot which of its attempts
 * were detected, and would show a real person a failure on a form that in fact
 * went through and is waiting for someone to look at it.
 */
export function statusCodeFor(code: string): number {
  switch (code) {
    case 'INVALID_SIGNATURE': return 401;
    case 'SOURCE_NOT_FOUND': return 404;
    case 'SOURCE_PAUSED': return 423;
    case 'DUPLICATE_PAYLOAD': return 200;
    case 'QUARANTINED': return 202;
    case 'NO_STORED_PAYLOAD': return 400;
    default: return 500;
  }
}

/** Pull a caller-supplied idempotency key off the header or the body. */
export function idempotencyKeyFrom(
  headers: Record<string, string | undefined> | undefined,
  body: Record<string, unknown>,
): string | undefined {
  const header = headers?.['idempotency-key'] ?? headers?.['Idempotency-Key'];
  const fromBody = body['idempotencyKey'];
  const key = header ?? (typeof fromBody === 'string' ? fromBody : undefined);
  const trimmed = key?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 255);
}

/** The success body shared by the webhook and every replay-shaped endpoint. */
export function successBody(ctx: PipelineContext, startedAt: number): Record<string, unknown> {
  return {
    success: true,
    recordId: ctx.personId ?? ctx.companyId,
    recordType: ctx.recordType,
    personId: ctx.personId,
    companyId: ctx.companyId,
    opportunityId: ctx.opportunityId,
    noteId: ctx.noteId,
    fieldsCreated: ctx.fieldsCreated,
    fieldsMatched: ctx.fieldsMatched,
    overflowCount: ctx.noteFields?.length ?? 0,
    spamScore: ctx.spam?.score ?? null,
    mergeDecisions: ctx.mergeDecisions ?? null,
    processingMs: Date.now() - startedAt,
    warnings: ctx.warnings,
  };
}
