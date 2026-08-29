/**
 * Writing the IntakeLog.
 *
 * This used to live inside WriteLogStage, which only ever ran when the pipeline
 * reached the end of its stages. Anything that failed earlier — a bad signature,
 * a rejected record, and now a quarantine — returned an error to the caller and
 * left no trace in the workspace at all. The object is described as a full audit
 * trail of every payload received, and a trail that records only the successes
 * is the exact shape of the problem this release is trying to fix: you cannot
 * notice a failure you were never told about.
 *
 * Pulling the write out here lets the terminal error paths record too, using the
 * same fields and the same retention rules.
 */

import { coreApi } from './rest-client';
import type { PipelineContext } from './pipeline';
import { prepareForStorage } from './retention';

export type LogStatus =
  | 'SUCCESS'
  | 'PARTIAL'
  | 'FAILED'
  | 'DUPLICATE'
  | 'QUARANTINED'
  | 'DISCARDED';

export type LogWriteInput = {
  ctx: PipelineContext;
  status: LogStatus;
  error?: string | null;
  spamScore?: number | null;
  quarantineReason?: string | null;
};

/**
 * Persist one IntakeLog. Never throws: a failure to write the audit record must
 * not turn a successful ingestion into a reported failure.
 */
export async function writeIntakeLog(input: LogWriteInput): Promise<string | null> {
  const { ctx, status } = input;

  const retained = prepareForStorage(ctx.rawPayload);
  if (retained.warning) ctx.warnings.push(retained.warning);

  try {
    const created = await coreApi.post<{ data: { createIntakeLog: { id: string } } }>('/intakeLogs', {
      intakeSourceId: ctx.source?.id ?? null,
      status,
      payloadHash: ctx.payloadHash ?? '',
      idempotencyKey: ctx.idempotencyKey ?? null,
      rawPayload: retained.stored,
      recordId: ctx.personId ?? ctx.companyId ?? null,
      recordType: ctx.recordType ?? null,
      fieldsCreated: ctx.fieldsCreated,
      fieldsMatched: ctx.fieldsMatched,
      overflowCount: ctx.noteFields?.length ?? 0,
      processingMs: Date.now() - ctx.startedAt,
      processedAt: new Date().toISOString(),
      error: input.error ?? null,
      spamScore: input.spamScore ?? ctx.spam?.score ?? null,
      quarantineReason: input.quarantineReason ?? null,
      replayOfLogId: ctx.replayOfLogId ?? null,
    });
    return created.data?.createIntakeLog?.id ?? null;
  } catch {
    ctx.warnings.push('Intake log write failed');
    return null;
  }
}

/**
 * Move a source's counters. Read-then-write, so it races under concurrent
 * ingestion — the counters are a dashboard convenience, and `lastIngestedAt`,
 * which silence detection actually depends on, is a plain timestamp that a lost
 * race still sets correctly.
 */
export async function bumpSourceCounters(
  sourceId: string,
  outcome: 'ingested' | 'failed',
): Promise<void> {
  try {
    const current = await coreApi.get<{
      data: { intakeSource: { totalIngested: number | null; totalFailed: number | null } };
    }>(`/intakeSources/${sourceId}`);

    const node = current.data?.intakeSource;
    const patch: Record<string, unknown> = {};

    if (outcome === 'ingested') {
      patch['totalIngested'] = (node?.totalIngested ?? 0) + 1;
      patch['lastIngestedAt'] = new Date().toISOString();
      // Anything arriving is proof the source is not silent.
      patch['healthStatus'] = 'HEALTHY';
      patch['silentSince'] = null;
    } else {
      patch['totalFailed'] = (node?.totalFailed ?? 0) + 1;
    }

    await coreApi.patch(`/intakeSources/${sourceId}`, patch);
  } catch {
    /* non-fatal */
  }
}
