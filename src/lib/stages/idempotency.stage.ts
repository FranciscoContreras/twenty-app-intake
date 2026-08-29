import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok, err, ErrorCode } from '../result';
import { computePayloadHash, withinWindow } from '../idempotency';
import { dedupWindowMinutes } from '../settings';
import type { CoreApiClient } from 'twenty-client-sdk/core';

/**
 * Two mechanisms, answering two different questions.
 *
 * The content hash asks "did we just see this exact body?" and only trusts the
 * answer for a few minutes, because two genuine enquiries with identical content
 * are possible and a form that is legitimately submitted twice a week is not a
 * duplicate.
 *
 * An idempotency key asks something stronger: the caller states that this is one
 * submission, whatever the retry schedule looks like. That claim gets no time
 * window at all. A double-tapped submit button, a client retry after a timeout,
 * a queue redelivering an hour later — all of them carry the same key and all of
 * them resolve to the record made the first time, rather than a second
 * opportunity in someone's pipeline.
 */
export class IdempotencyStage implements PipelineStage {
  readonly name = 'idempotency';

  constructor(private readonly client: CoreApiClient) {}

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    const hash = computePayloadHash(ctx.rawPayload);
    const next = { ...ctx, payloadHash: hash };

    // Replay and retry deliberately re-run a payload that has been seen.
    if (ctx.skipDedup) return ok(next);

    if (ctx.idempotencyKey) {
      const prior = await this.findByKey(ctx.idempotencyKey);
      if (prior) {
        return err(
          ErrorCode.DUPLICATE_PAYLOAD,
          `Idempotency key already processed (log ${prior.id})`,
          { priorLogId: prior.id, priorRecordId: prior.recordId, idempotencyKey: ctx.idempotencyKey },
        );
      }
    }

    const windowMins = dedupWindowMinutes();
    if (windowMins <= 0) return ok(next);

    const prior = await this.findByHash(hash);
    if (prior?.processedAt && withinWindow(new Date(prior.processedAt), windowMins * 60 * 1000)) {
      return err(
        ErrorCode.DUPLICATE_PAYLOAD,
        `Duplicate payload — already processed ${String(prior.status).toLowerCase()} (log ${prior.id})`,
        { priorLogId: prior.id, priorRecordId: prior.recordId },
      );
    }

    return ok(next);
  }

  private async findByKey(key: string): Promise<PriorLog | null> {
    try {
      const res = await this.client.query({
        intakeLogs: {
          __args: {
            filter: { idempotencyKey: { eq: key } },
            orderBy: { processedAt: 'DescNullsLast' },
            first: 1,
          },
          edges: { node: { id: true, status: true, recordId: true, processedAt: true } },
        },
      });
      const node = res.intakeLogs?.edges?.[0]?.node ?? null;
      // A payload that was held or thrown away was never acted on, so the key
      // has not really been used and the caller deserves a fresh attempt.
      if (node && (node.status === 'QUARANTINED' || node.status === 'DISCARDED')) return null;
      return node;
    } catch {
      // The field is missing on workspaces that installed before 0.4.0 and have
      // not re-synced. Falling through to hash dedup keeps them working exactly
      // as they did, rather than failing every request.
      return null;
    }
  }

  private async findByHash(hash: string): Promise<PriorLog | null> {
    try {
      const res = await this.client.query({
        intakeLogs: {
          __args: {
            filter: { payloadHash: { eq: hash } },
            orderBy: { processedAt: 'DescNullsLast' },
            first: 1,
          },
          edges: { node: { id: true, status: true, recordId: true, processedAt: true } },
        },
      });
      return res.intakeLogs?.edges?.[0]?.node ?? null;
    } catch {
      return null;
    }
  }
}

type PriorLog = {
  id: string;
  status: string;
  recordId: string | null;
  processedAt: string;
};
