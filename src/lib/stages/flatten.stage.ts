import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok } from '../result';
import { detectStructure, flatten } from '../flattener';

export class FlattenStage implements PipelineStage {
  readonly name = 'flatten';

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    const structure = detectStructure(ctx.rawPayload);

    if (structure.type === 'structured') {
      // For structured payloads (pipeline app format), company and person are
      // already in Twenty's native format. Only normalize the extra fields
      // (pipeline-specific data: ratings, scores, analysis, etc.)
      const extraFlat = flatten(structure.extra ?? {});

      return ok({
        ...ctx,
        structuredCompany: structure.company ?? undefined,
        structuredPerson: structure.person ?? undefined,
        flat: extraFlat,
      });
    }

    // Flat format — already a top-level key→value record
    return ok({ ...ctx, flat: structure.data });
  }
}
