import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { detectStructure, flatten } from '../lib/flattener';
import { normalizeFields, partition, assembleComposites } from '../lib/normalizer';
import { computePayloadHash } from '../lib/idempotency';
import { formatNote } from '../lib/note-formatter';
import { coreApi } from '../lib/rest-client';

/**
 * Dry-run endpoint — validates a payload and shows exactly what WOULD be created
 * without writing anything to the CRM.
 */
const handler = async (params: RoutePayload) => {
  const sourceSlug = params.pathParameters?.['slug'];
  if (!sourceSlug) {
    return { statusCode: 400, body: { error: 'Missing source slug' } };
  }

  let rawPayload: Record<string, unknown> = {};
  if (params.body && typeof params.body === 'object' && !Array.isArray(params.body)) {
    rawPayload = params.body as Record<string, unknown>;
  }

  // Load source config
  const srcResult = await coreApi.get<{ data: { intakeSources: { edges: Array<{ node: { id: string; name: string; targetObject: string } }> } } }>(
    `/intakeSources?filter=slug[eq]:${encodeURIComponent(sourceSlug)}&first=1`,
  ).catch(() => null);
  const source = srcResult?.data?.intakeSources?.edges?.[0]?.node;

  // Run normalization pipeline (read-only)
  const structure = detectStructure(rawPayload);
  const flat = structure.type === 'flat' ? structure.data
    : flatten(structure.type === 'structured' ? (structure.extra ?? {}) : rawPayload);

  const normalized = normalizeFields(flat);
  const { crmFields, noteFields, skipped } = partition(normalized);
  const { assembled, remainder } = assembleComposites(crmFields);
  for (const f of remainder) assembled[f.canonicalName] = f.value;

  const extFields = Object.keys(assembled).filter(k => /^ext[A-Z]/.test(k));
  const standardFields = Object.keys(assembled).filter(k => !/^ext[A-Z]/.test(k));

  const noteOverflow: Record<string, unknown> = {};
  for (const f of noteFields) noteOverflow[f.canonicalName] = f.value;

  return {
    statusCode: 200,
    body: {
      dryRun: true,
      source: source ? { id: source.id, name: source.name } : null,
      payloadHash: computePayloadHash(rawPayload),
      payloadStructure: structure.type,
      wouldCreate: {
        standardFields,
        customFieldsToCreate: extFields,
        noteFields: noteFields.map(f => f.canonicalName),
        skipped: skipped.map(f => f.originalKey),
      },
      notePreview: noteFields.length > 0 ? formatNote(source?.name ?? sourceSlug, noteOverflow) : null,
      rawFlat: flat,
    },
  };
};

export default defineLogicFunction({
  universalIdentifier: '3f7a9c21-8d4b-4e6f-a1c2-5b8d0f2e7a4c',
  name: 'intake-test',
  description: 'Dry-run: validates a payload and shows what would be created without writing to the CRM.',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/:slug/test',
    httpMethod: 'POST',
    isAuthRequired: false,
  },
});
