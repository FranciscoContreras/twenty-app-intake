import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok } from '../result';
import type { CoreApiClient } from 'twenty-client-sdk/core';

export class WriteLogStage implements PipelineStage {
  readonly name = 'write-log';

  constructor(private readonly client: CoreApiClient) {}

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    try {
      const status = ctx.personId || ctx.companyId ? 'SUCCESS' : 'PARTIAL';

      await this.client.mutation({
        createOneIntakeLog: {
          __args: {
            data: {
              intakeSource: ctx.source ? { connect: { id: ctx.source.id } } : undefined,
              status,
              payloadHash: ctx.payloadHash ?? '',
              recordId: ctx.personId ?? ctx.companyId ?? null,
              recordType: ctx.recordType ?? null,
              fieldsCreated: ctx.fieldsCreated,
              fieldsMatched: ctx.fieldsMatched,
              overflowCount: ctx.noteFields?.length ?? 0,
              processingMs: Date.now() - ctx.startedAt,
              processedAt: new Date().toISOString(),
            },
          },
          id: true,
        },
      });

      // Update source counters
      if (ctx.source) {
        await this.client.mutation({
          updateOneIntakeSource: {
            __args: {
              id: ctx.source.id,
              data: {
                totalIngested: { increment: 1 },
                lastIngestedAt: new Date().toISOString(),
              },
            },
            id: true,
          },
        });
      }
    } catch {
      // Non-fatal — log failure doesn't break the ingestion
      ctx.warnings.push('Intake log write failed');
    }

    return ok(ctx);
  }
}
