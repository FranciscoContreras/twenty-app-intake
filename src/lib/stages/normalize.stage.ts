import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok, err, ErrorCode } from '../result';
import { normalizeFields, partition, assembleComposites, type DatabaseRule } from '../normalizer';
import type { CoreApiClient } from 'twenty-client-sdk/core';

export class NormalizeStage implements PipelineStage {
  readonly name = 'normalize';

  constructor(private readonly client: CoreApiClient) {}

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    if (!ctx.flat) {
      return err(ErrorCode.INTERNAL_ERROR, 'FlattenStage must run before NormalizeStage');
    }

    const rules = await this.loadRules(ctx.source?.id);
    const normalized = normalizeFields(ctx.flat, rules);
    const { crmFields, noteFields } = partition(normalized);

    return ok({
      ...ctx,
      normalizedFields: normalized,
      crmFields,
      noteFields,
    });
  }

  private async loadRules(sourceId?: string): Promise<DatabaseRule[]> {
    try {
      const filter = sourceId
        ? { or: [{ intakeSource: { id: { eq: sourceId } } }, { intakeSource: { id: { is: 'NULL' } } }] }
        : { intakeSource: { id: { is: 'NULL' } } };

      const result = await this.client.query({
        intakeFieldRules: {
          __args: {
            filter: { and: [filter, { isActive: { eq: true } }] },
            orderBy: { priority: 'DescNullsLast' },
          },
          edges: {
            node: {
              inputPattern: true,
              canonicalName: true,
              fieldType: true,
              priority: true,
            },
          },
        },
      });

      return (result.intakeFieldRules?.edges ?? []).map((e: { node: DatabaseRule }) => e.node);
    } catch {
      return [];
    }
  }
}
