import type { Result, AppError } from './result';
import type { NormalizedField } from './normalizer';
import type { MergePolicy } from './settings';
import type { SpamVerdict } from './spam';
import type { MergeDecision } from './merge';

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
    /** Per-source honeypot key. Falls back to INTAKE_HONEYPOT_FIELD. */
    honeypotField: string | null;
    /** Per-source merge policy. Null inherits INTAKE_MERGE_POLICY. */
    mergePolicy: MergePolicy | null;
  };

  // ── Idempotency ────────────────────────────────────────────────────────
  payloadHash?: string;
  /**
   * Client-supplied key from the Idempotency-Key header or an `idempotencyKey`
   * body field. Unlike the content hash it is honoured with no time limit —
   * the caller has promised these are the same submission, so a retry an hour
   * later is still that one submission.
   */
  idempotencyKey?: string;

  // ── Spam ───────────────────────────────────────────────────────────────
  spam?: SpamVerdict;

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
  /**
   * Set when an operator releases a quarantined payload. The scoring still runs
   * and is still recorded, but a human has overruled it.
   */
  skipSpamFilter?: boolean;
  /** The log this run was replayed from, for lineage on the new log. */
  replayOfLogId?: string;

  // ── Diagnostics ────────────────────────────────────────────────────────
  /** What the merge policy did to each field, keyed by object then field. */
  mergeDecisions?: Record<string, Record<string, MergeDecision>>;
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
