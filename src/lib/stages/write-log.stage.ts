import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok } from '../result';
import { coreApi, gql } from '../rest-client';

export class WriteLogStage implements PipelineStage {
  readonly name = 'write-log';

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    try {
      const status = ctx.personId || ctx.companyId ? 'SUCCESS' : 'PARTIAL';

      await coreApi.post('/intakeLogs', {
        intakeSourceId: ctx.source?.id ?? null,
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
    } catch {
      ctx.warnings.push('Intake log write failed');
    }

    // Update source counters (non-fatal)
    if (ctx.source) {
      try {
        const current = await coreApi.get<{ data: { intakeSource: { totalIngested: number } } }>(
          `/intakeSources/${ctx.source.id}`,
        );
        const current_count = current.data?.intakeSource?.totalIngested ?? 0;
        await coreApi.patch(`/intakeSources/${ctx.source.id}`, {
          totalIngested: current_count + 1,
          lastIngestedAt: new Date().toISOString(),
        });
      } catch { /* non-fatal */ }
    }

    return ok(ctx);
  }
}
