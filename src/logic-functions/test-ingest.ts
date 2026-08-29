import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { detectStructure, flatten } from '../lib/flattener';
import { normalizeFields, partition, type DatabaseRule } from '../lib/normalizer';
import { computePayloadHash } from '../lib/idempotency';
import { formatNote } from '../lib/note-formatter';
import { coreApi } from '../lib/rest-client';
import { buildDiff } from '../lib/diff';
import { scoreSpam, describeVerdict } from '../lib/spam';
import { honeypotField, mergePolicy, spamFilterEnabled, spamScoreThreshold } from '../lib/settings';

/**
 * Dry run: what would happen, without it happening.
 *
 * Two things changed in 0.4.0 and both were correctness, not presentation. The
 * preview now loads the same field rules the live pipeline loads — it previously
 * ran with none, so any payload relying on a rule was previewed wrongly. And the
 * result is a structured diff rather than a list of names, so it can be asserted
 * against in a test or read by a deployment check instead of eyeballed.
 */
const handler = async (params: RoutePayload) => {
  const sourceSlug = params.pathParameters?.['slug'];
  if (!sourceSlug) return { statusCode: 400, body: { error: 'Missing source slug' } };

  let rawPayload: Record<string, unknown> = {};
  if (params.body && typeof params.body === 'object' && !Array.isArray(params.body)) {
    rawPayload = params.body as Record<string, unknown>;
  }

  const source = await loadSource(sourceSlug);
  const rules = await loadRules(source?.id);

  const structure = detectStructure(rawPayload);
  const flat = structure.type === 'flat'
    ? structure.data
    : flatten(structure.extra ?? {});

  const normalized = normalizeFields(flat, rules);
  const { crmFields, noteFields, skipped } = partition(normalized);

  const honeypot = source?.honeypotField || honeypotField();
  const verdict = scoreSpam(flat, honeypot);
  const wouldQuarantine = verdict.honeypot
    || (spamFilterEnabled() && verdict.score >= spamScoreThreshold());

  const warnings: string[] = [];
  if (!source) warnings.push(`No source registered with slug "${sourceSlug}" — previewing with default settings. A live request would return 404.`);
  if (source?.status === 'PAUSED') warnings.push('This source is PAUSED — a live request would return 423.');

  const noteOverflow: Record<string, unknown> = {};
  for (const f of noteFields) noteOverflow[f.canonicalName] = f.value;

  // A payload that would be held never reaches the record stages, so describing
  // what it would write would be describing something that will not happen.
  const diff = wouldQuarantine ? null : await buildDiff({
    crmFields,
    noteFields,
    skipped,
    structuredCompany: structure.type === 'structured' ? (structure.company ?? undefined) : undefined,
    structuredPerson: structure.type === 'structured' ? (structure.person ?? undefined) : undefined,
    createOpportunity: source?.createOpportunity ?? true,
    targetObject: (source?.targetObject as 'PERSON' | 'COMPANY' | 'AUTO') ?? 'AUTO',
    policy: parsePolicy(source?.mergePolicy) ?? mergePolicy(),
    warnings,
  });

  return {
    statusCode: 200,
    body: {
      dryRun: true,
      source: source ? { id: source.id, name: source.name, slug: source.slug, status: source.status } : null,
      payloadHash: computePayloadHash(rawPayload),
      payloadStructure: structure.type,

      spam: {
        score: verdict.score,
        threshold: spamScoreThreshold(),
        filterEnabled: spamFilterEnabled(),
        honeypotField: honeypot || null,
        wouldQuarantine,
        signals: verdict.signals,
        reason: verdict.signals.length > 0 ? describeVerdict(verdict) : null,
      },

      mergePolicy: parsePolicy(source?.mergePolicy) ?? mergePolicy(),

      /**
       * Per object: whether it would be created or updated, which record it
       * matched, what each field would do to the value already there, and which
       * fields do not exist yet and would be added to the schema.
       */
      diff,

      note: noteFields.length > 0
        ? { fields: noteFields.map((f) => f.canonicalName), preview: formatNote(source?.name ?? sourceSlug, noteOverflow) }
        : null,

      rulesApplied: rules.length,
      warnings,
      rawFlat: flat,
    },
  };
};

type SourceNode = {
  id: string;
  name: string;
  slug: string;
  status: string;
  targetObject: string;
  createOpportunity: boolean | null;
  honeypotField?: string | null;
  mergePolicy?: string | null;
};

async function loadSource(slug: string): Promise<SourceNode | null> {
  try {
    const res = await coreApi.get<{ data: { intakeSources: { edges: Array<{ node: SourceNode }> } } }>(
      `/intakeSources?filter=slug[eq]:${encodeURIComponent(slug)}&first=1`,
    );
    return res.data?.intakeSources?.edges?.[0]?.node ?? null;
  } catch {
    return null;
  }
}

/** The same query NormalizeStage runs, so the preview sees the same rules. */
async function loadRules(sourceId: string | undefined): Promise<DatabaseRule[]> {
  try {
    const client = new CoreApiClient();
    const filter = sourceId
      ? { or: [{ intakeSource: { id: { eq: sourceId } } }, { intakeSource: { id: { is: 'NULL' } } }] }
      : { intakeSource: { id: { is: 'NULL' } } };

    const result = await client.query({
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
            targetObject: true,
            mergeStrategy: true,
          },
        },
      },
    });

    return (result.intakeFieldRules?.edges ?? []).map((e: { node: DatabaseRule }) => e.node);
  } catch {
    return [];
  }
}

function parsePolicy(raw: string | null | undefined): 'PRESERVE' | 'NEWEST_WINS' | null {
  switch ((raw ?? '').toUpperCase()) {
    case 'PRESERVE': return 'PRESERVE';
    case 'NEWEST_WINS': return 'NEWEST_WINS';
    default: return null;
  }
}

export default defineLogicFunction({
  universalIdentifier: '3f7a9c21-8d4b-4e6f-a1c2-5b8d0f2e7a4c',
  name: 'intake-test',
  description: 'Dry-run: returns a structured diff of what would be created or updated, writing nothing.',
  timeoutSeconds: 20,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/:slug/test',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
