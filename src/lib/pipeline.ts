import type { Result, AppError } from './result';
import type { NormalizedField } from './normalizer';

export type PipelineContext = {
  // ── Entry ──────────────────────────────────────────────────────────────
  sourceSlug: string;
  rawBody: string | undefined;
  rawPayload: Record<string, unknown>;
  headers: Record<string, string | undefined>;
  startedAt: number;

  // ── Resolved source config ─────────────────────────────────────────────
  source?: {
    id: string;
    name: string;
    slug: string;
    targetObject: 'PERSON' | 'COMPANY' | 'AUTO';
    webhookSecret: string | null;
    status: 'ACTIVE' | 'PAUSED';
    createOpportunity: boolean;
    opportunityNameTemplate: string;
  };

  // ── Idempotency ────────────────────────────────────────────────────────
  payloadHash?: string;

  // ── Transformation ─────────────────────────────────────────────────────
  flat?: Record<string, unknown>;
  structuredCompany?: Record<string, unknown>;
  structuredPerson?: Record<string, unknown>;
  normalizedFields?: NormalizedField[];
  crmFields?: NormalizedField[];
  noteFields?: NormalizedField[];

  // ── Schema sync ────────────────────────────────────────────────────────
  fieldsCreated: number;
  fieldsMatched: number;

  // ── Output ─────────────────────────────────────────────────────────────
  personId?: string;
  companyId?: string;
  opportunityId?: string;
  noteId?: string;
  recordType?: 'PERSON' | 'COMPANY';

  // ── Flags ──────────────────────────────────────────────────────────────
  skipDedup?: boolean;

  // ── Diagnostics ────────────────────────────────────────────────────────
  warnings: string[];
  events: PipelineEvent[];
};

export type PipelineEvent = {
  stage: string;
  message: string;
  data?: unknown;
};

export interface PipelineStage {
  readonly name: string;
  execute(ctx: PipelineContext): Promise<Result<PipelineContext>>;
}

export class Pipeline {
  private readonly stages: PipelineStage[] = [];

  use(stage: PipelineStage): this {
    this.stages.push(stage);
    return this;
  }

  async run(initial: PipelineContext): Promise<Result<PipelineContext, AppError>> {
    let ctx = initial;

    for (const stage of this.stages) {
      const result = await stage.execute(ctx);

      if (!result.ok) {
        return {
          ok: false,
          error: { ...result.error, stage: stage.name },
        };
      }

      ctx = result.value;
      ctx.events.push({ stage: stage.name, message: 'completed' });
    }

    return { ok: true, value: ctx };
  }
}
