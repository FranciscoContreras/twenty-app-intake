import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok } from '../result';
import { writeIntakeLog, bumpSourceCounters } from '../intake-log-writer';

export class WriteLogStage implements PipelineStage {
  readonly name = 'write-log';

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    const status = ctx.personId || ctx.companyId ? 'SUCCESS' : 'PARTIAL';

    await writeIntakeLog({ ctx, status });

    if (ctx.source) await bumpSourceCounters(ctx.source.id, 'ingested');

    return ok(ctx);
  }
}
