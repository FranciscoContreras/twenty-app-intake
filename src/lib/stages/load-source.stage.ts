import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok, err, ErrorCode } from '../result';
import type { MergePolicy } from '../settings';
import type { CoreApiClient } from 'twenty-client-sdk/core';

const BASE_FIELDS = {
  id: true,
  name: true,
  slug: true,
  targetObject: true,
  webhookSecret: true,
  status: true,
  createOpportunity: true,
  opportunityNameTemplate: true,
} as const;

const V4_FIELDS = {
  ...BASE_FIELDS,
  honeypotField: true,
  mergePolicy: true,
} as const;

type SourceNode = {
  id: string;
  name: string;
  slug: string;
  targetObject: string;
  webhookSecret: string | null;
  status: string;
  createOpportunity: boolean | null;
  opportunityNameTemplate: string | null;
  honeypotField?: string | null;
  mergePolicy?: string | null;
};

export class LoadSourceStage implements PipelineStage {
  readonly name = 'load-source';

  constructor(private readonly client: CoreApiClient) {}

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    const node = await this.fetch(ctx.sourceSlug);

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
        honeypotField: node.honeypotField ?? null,
        mergePolicy: parseMergePolicy(node.mergePolicy),
      },
    });
  }

  /**
   * Ask for the 0.4.0 columns, and fall back to the original set if they are not
   * there yet. A workspace that upgraded the package but has not re-synced its
   * schema would otherwise fail the query and reject every request as an unknown
   * source — an upgrade that takes the webhook offline, which is not acceptable
   * for something sitting in front of someone's contact form.
   */
  private async fetch(slug: string): Promise<SourceNode | null> {
    const args = { filter: { slug: { eq: slug } } };

    try {
      const result = await this.client.query({
        intakeSources: { __args: args, edges: { node: V4_FIELDS } },
      });
      return result.intakeSources?.edges?.[0]?.node ?? null;
    } catch {
      try {
        const result = await this.client.query({
          intakeSources: { __args: args, edges: { node: BASE_FIELDS } },
        });
        return result.intakeSources?.edges?.[0]?.node ?? null;
      } catch {
        return null;
      }
    }
  }
}

function parseMergePolicy(raw: string | null | undefined): MergePolicy | null {
  switch ((raw ?? '').toUpperCase()) {
    case 'PRESERVE': return 'PRESERVE';
    case 'NEWEST_WINS': return 'NEWEST_WINS';
    default: return null;
  }
}
