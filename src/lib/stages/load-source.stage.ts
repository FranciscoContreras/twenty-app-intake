import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok, err, ErrorCode } from '../result';
import type { CoreApiClient } from 'twenty-client-sdk/core';

export class LoadSourceStage implements PipelineStage {
  readonly name = 'load-source';

  constructor(private readonly client: CoreApiClient) {}

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    const result = await this.client.query({
      intakeSources: {
        __args: { filter: { slug: { eq: ctx.sourceSlug } } },
        edges: {
          node: {
            id: true,
            name: true,
            slug: true,
            targetObject: true,
            webhookSecret: true,
            status: true,
            createOpportunity: true,
            opportunityNameTemplate: true,
          },
        },
      },
    });

    const node = result.intakeSources?.edges?.[0]?.node;

    if (!node) {
      return err(ErrorCode.SOURCE_NOT_FOUND, `No Intake source found with slug "${ctx.sourceSlug}"`);
    }

    if (node.status === 'PAUSED') {
      return err(ErrorCode.SOURCE_PAUSED, `Source "${node.name}" is paused`);
    }

    return ok({
      ...ctx,
      source: {
        id: node.id,
        name: node.name,
        slug: node.slug,
        targetObject: node.targetObject as 'PERSON' | 'COMPANY' | 'AUTO',
        webhookSecret: node.webhookSecret ?? null,
        status: node.status as 'ACTIVE' | 'PAUSED',
        createOpportunity: node.createOpportunity ?? true,
        opportunityNameTemplate: node.opportunityNameTemplate ?? '{{source}} — {{firstName}} {{lastName}}',
      },
    });
  }
}
