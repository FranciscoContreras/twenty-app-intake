import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok } from '../result';
import { coreApi } from '../rest-client';

export class WriteLogStage implements PipelineStage {
  readonly name = 'write-log';

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    try {
      const status = ctx.personId || ctx.companyId ? 'SUCCESS' : 'PARTIAL';

      await coreApi.post('/intakeLogs', {
        status,
        payloadHash: ctx.payloadHash ?? '',
        recordId: ctx.personId ?? ctx.companyId ?? null,
        recordType: ctx.recordType ?? null,
        fieldsCreated: ctx.fieldsCreated,
        fieldsMatched: ctx.fieldsMatched,
        overflowCount: ctx.noteFields?.length ?? 0,
        processingMs: Date.now() - ctx.startedAt,
        processedAt: new Date().toISOString(),
      });

      if (ctx.source) {
        await coreApi.patch(`/intakeSources/${ctx.source.id}`, {
          totalIngested: { increment: 1 },
          lastIngestedAt: new Date().toISOString(),
        }).catch(() => null);
      }
    } catch {
      ctx.warnings.push('Intake log write failed');
    }

    return ok(ctx);
  }
}
