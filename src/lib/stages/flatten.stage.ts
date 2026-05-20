import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok } from '../result';
import { detectStructure, flatten } from '../flattener';

export class FlattenStage implements PipelineStage {
  readonly name = 'flatten';

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    const structure = detectStructure(ctx.rawPayload);

    if (structure.type === 'structured') {
      // Merge all parts into one flat record for the normalizer.
      // Company fields are prefixed with 'company_' to keep them identifiable
      // when we later route them to the right object.
      const flat: Record<string, unknown> = {};

      if (structure.company) {
        for (const [k, v] of Object.entries(structure.company)) {
          flat[`__company_${k}`] = v;
        }
      }
      if (structure.person) {
        for (const [k, v] of Object.entries(structure.person)) {
          flat[k] = v;
        }
      }
      Object.assign(flat, structure.extra);

      return ok({ ...ctx, flat });
    }

    // Flat format — already a top-level key→value record
    return ok({ ...ctx, flat: structure.data });
  }
}
