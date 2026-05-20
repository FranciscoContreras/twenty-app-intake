import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok, err, ErrorCode } from '../result';
import { computePayloadHash, withinWindow } from '../idempotency';
import type { CoreApiClient } from 'twenty-client-sdk/core';

export class IdempotencyStage implements PipelineStage {
  readonly name = 'idempotency';

  constructor(private readonly client: CoreApiClient) {}

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    const hash = computePayloadHash(ctx.rawPayload);

    // Check if we've seen this payload recently
    const existing = await this.client.query({
      intakeLogs: {
        __args: {
          filter: { payloadHash: { eq: hash } },
          orderBy: { processedAt: 'DescNullsLast' },
          first: 1,
        },
        edges: {
          node: {
            id: true,
            status: true,
            recordId: true,
            processedAt: true,
          },
        },
      },
    });

    const prior = existing.intakeLogs?.edges?.[0]?.node;

    const windowMins = parseInt(process.env['INTAKE_DEDUP_WINDOW_MINUTES'] ?? '5', 10);
    if (prior && withinWindow(new Date(prior.processedAt), windowMins * 60 * 1000)) {
      return err(
        ErrorCode.DUPLICATE_PAYLOAD,
        `Duplicate payload — already processed ${prior.status.toLowerCase()} (log ${prior.id})`,
        { priorLogId: prior.id, priorRecordId: prior.recordId },
      );
    }

    return ok({ ...ctx, payloadHash: hash });
  }
}
