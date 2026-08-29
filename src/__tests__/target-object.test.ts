import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeFields, type DatabaseRule } from '../lib/normalizer';

describe('normalizeFields — target routing', () => {
  it('defaults every built-in field to auto', () => {
    const [result] = normalizeFields({ email: 'x@x.com' });
    expect(result?.targetObject).toBe('auto');
  });

  it('defaults an unknown field to auto', () => {
    const [result] = normalizeFields({ referral_code: 'ABC' });
    expect(result?.canonicalName).toBe('extReferralCode');
    expect(result?.targetObject).toBe('auto');
  });

  it.each(['opportunity_budget', 'opp_budget', 'deal_budget'])(
    'routes %s to the opportunity and strips the prefix',
    (key) => {
      const [result] = normalizeFields({ [key]: '5000' });
      expect(result?.targetObject).toBe('opportunity');
      expect(result?.canonicalName).toBe('extBudget');
    },
  );

  it('takes the target from a rule', () => {
    const rules: DatabaseRule[] = [{
      inputPattern: 'service',
      canonicalName: 'machinaService',
      fieldType: 'TEXT',
      action: 'field',
      priority: 10,
      targetObject: 'OPPORTUNITY',
    }];
    const [result] = normalizeFields({ service: 'Email Marketing' }, rules);
    expect(result?.canonicalName).toBe('machinaService');
    expect(result?.targetObject).toBe('opportunity');
  });

  it('treats an unrecognised rule target as auto rather than throwing', () => {
    const rules: DatabaseRule[] = [{
      inputPattern: 'service', canonicalName: 'machinaService', fieldType: 'TEXT',
      action: 'field', priority: 10, targetObject: 'NONSENSE',
    }];
    const [result] = normalizeFields({ service: 'SEO' }, rules);
    expect(result?.targetObject).toBe('auto');
  });
});

// ── Schema sync ──────────────────────────────────────────────────────────────
// The stage talks to the metadata API, so the API is faked. What is under test
// is the decision it makes about each field, not the HTTP call it makes.

const objects = [
  { id: 'person-obj', nameSingular: 'person', fields: [{ name: 'name' }, { name: 'emails' }] },
  {
    id: 'opp-obj', nameSingular: 'opportunity',
    fields: [{ name: 'name' }, { name: 'stage' }, { name: 'machinaService' }],
  },
];

const createdFields: Array<{ objectMetadataId: string; name: string }> = [];

vi.mock('../lib/rest-client', () => ({
  metaApi: {
    get: vi.fn(async () => objects),
    post: vi.fn(async (_path: string, body: { objectMetadataId: string; name: string }) => {
      // Only the placement decision is under test — not the label/icon/type
      // that createField fills in around it.
      createdFields.push({ objectMetadataId: body.objectMetadataId, name: body.name });
      return {};
    }),
  },
  coreApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  gql: vi.fn(),
}));

const { SyncSchemaStage } = await import('../lib/stages/sync-schema.stage');

const baseCtx = (fields: ReturnType<typeof normalizeFields>) => ({
  sourceSlug: 'test', rawBody: undefined, rawPayload: {}, headers: {}, startedAt: 0,
  source: {
    id: 's1', name: 'Test', slug: 'test', targetObject: 'AUTO' as const,
    webhookSecret: null, status: 'ACTIVE' as const,
    createOpportunity: true, opportunityNameTemplate: '{{source}}',
  },
  crmFields: fields, noteFields: [], fieldsCreated: 0, fieldsMatched: 0,
  warnings: [] as string[], events: [],
});

describe('SyncSchemaStage — field placement', () => {
  beforeEach(() => { createdFields.length = 0; });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('creates an ext field on the opportunity rather than the person', async () => {
    const fields = normalizeFields({ email: 'a@b.com', opportunity_budget: '5000' });
    const res = await new SyncSchemaStage().execute(baseCtx(fields));
    expect(res.ok).toBe(true);
    expect(createdFields).toEqual([{ objectMetadataId: 'opp-obj', name: 'extBudget' }]);
  });

  it('writes to an existing custom field a rule names, without creating anything', async () => {
    const rules: DatabaseRule[] = [{
      inputPattern: 'service', canonicalName: 'machinaService', fieldType: 'TEXT',
      action: 'field', priority: 10, targetObject: 'OPPORTUNITY',
    }];
    const fields = normalizeFields({ email: 'a@b.com', service: 'SEO' }, rules);
    const res = await new SyncSchemaStage().execute(baseCtx(fields));

    const svc = res.ok ? res.value.crmFields?.find(f => f.canonicalName === 'machinaService') : undefined;
    expect(svc?.writable).toBe(true);
    expect(svc?.targetObject).toBe('opportunity');
    expect(createdFields).toEqual([]);
  });

  it('demotes a rule field that does not exist to the note instead of dropping it', async () => {
    const rules: DatabaseRule[] = [{
      inputPattern: 'service', canonicalName: 'notAFieldHere', fieldType: 'TEXT',
      action: 'field', priority: 10, targetObject: 'OPPORTUNITY',
    }];
    const fields = normalizeFields({ email: 'a@b.com', service: 'SEO' }, rules);
    const res = await new SyncSchemaStage().execute(baseCtx(fields));
    if (!res.ok) throw new Error('expected ok');

    // Not silently counted as matched, and the value survives in the note.
    expect(res.value.crmFields?.some(f => f.canonicalName === 'notAFieldHere')).toBe(false);
    expect(res.value.noteFields?.some(f => f.canonicalName === 'notAFieldHere')).toBe(true);
    expect(res.value.fieldsMatched).toBe(1); // the email only
    expect(res.value.warnings.join(' ')).toContain('does not exist on opportunity');
  });

  it('honours INTAKE_FIELD_CREATION_ENABLED=false by sending ext fields to the note', async () => {
    vi.stubEnv('INTAKE_FIELD_CREATION_ENABLED', 'false');
    const fields = normalizeFields({ email: 'a@b.com', opportunity_budget: '5000' });
    const res = await new SyncSchemaStage().execute(baseCtx(fields));
    if (!res.ok) throw new Error('expected ok');

    expect(createdFields).toEqual([]);
    expect(res.value.noteFields?.some(f => f.canonicalName === 'extBudget')).toBe(true);
  });

  it('falls back to the primary record when the source opens no opportunity', async () => {
    const ctx = baseCtx(normalizeFields({ email: 'a@b.com', opportunity_budget: '5000' }));
    ctx.source.createOpportunity = false;
    const res = await new SyncSchemaStage().execute(ctx);
    if (!res.ok) throw new Error('expected ok');

    expect(createdFields).toEqual([{ objectMetadataId: 'person-obj', name: 'extBudget' }]);
    expect(res.value.warnings.join(' ')).toContain('does not create opportunities');
  });
});
