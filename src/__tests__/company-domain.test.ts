import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isFreeEmailDomain } from '../constants/free-email-domains';
import { normalizeFields } from '../lib/normalizer';

const posts: Array<{ path: string; body: Record<string, unknown> }> = [];

vi.mock('../lib/rest-client', () => ({
  coreApi: {
    // Nothing is on file, so every lookup misses and the stage takes the
    // create path — which is the path that can invent a junk company.
    get: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async (path: string, body: Record<string, unknown>) => {
      posts.push({ path, body });
      if (path === '/companies') return { data: { createCompany: { id: 'company-1' } } };
      if (path === '/people') return { data: { createPerson: { id: 'person-1' } } };
      if (path === '/opportunities') return { data: { createOpportunity: { id: 'opp-1' } } };
      if (path === '/notes') return { data: { createNote: { id: 'note-1' } } };
      return {};
    }),
    patch: vi.fn(async () => ({})),
  },
  metaApi: { get: vi.fn(async () => []), post: vi.fn(async () => ({})) },
  gql: vi.fn(async () => ({ data: {} })),
}));

const { UpsertRecordStage } = await import('../lib/stages/upsert-record.stage');

const ctxFor = (payload: Record<string, unknown>) => {
  const crmFields = normalizeFields(payload).filter((f) => f.action === 'field')
    .map((f) => ({ ...f, writable: true }));
  return {
    sourceSlug: 'test', rawBody: undefined, rawPayload: payload, headers: {}, startedAt: 0,
    source: {
      id: 's1', name: 'Test', slug: 'test', targetObject: 'AUTO' as const,
      webhookSecret: null, status: 'ACTIVE' as const,
      createOpportunity: true, opportunityNameTemplate: '{{source}}',
    },
    crmFields, noteFields: [], fieldsCreated: 0, fieldsMatched: 0,
    warnings: [] as string[], events: [],
  };
};

const companyPosts = () => posts.filter((p) => p.path === '/companies');

/**
 * Most small-business enquiries arrive from a consumer mailbox. A CRM that turns
 * those into organisations fills its Companies table with mail hosts and files
 * real people under them, which is why an ingestion layer must never read an
 * employer out of an email address.
 */
describe('a consumer email never becomes a company', () => {
  beforeEach(() => { posts.length = 0; });

  it.each([
    'jane@gmail.com',
    'jane@yahoo.com',
    'jane@outlook.com',
    'jane@msn.com',
    'jane@hotmail.com',
    'jane@icloud.com',
  ])('creates no company at all for a lead from %s', async (email) => {
    const res = await new UpsertRecordStage().execute(ctxFor({ name: 'Jane Doe', email }));

    expect(res.ok).toBe(true);
    expect(companyPosts()).toHaveLength(0);
    expect(posts.filter((p) => p.path === '/people')).toHaveLength(1);
  });

  it('creates exactly one company when the payload names a real one', async () => {
    const res = await new UpsertRecordStage().execute(ctxFor({
      name: 'Jane Doe',
      email: 'jane@gmail.com',
      company: 'Acme Roofing',
      website: 'https://acme.com',
    }));

    expect(res.ok).toBe(true);
    expect(companyPosts()).toHaveLength(1);
    expect(companyPosts()[0]?.body['name']).toBe('Acme Roofing');
  });

  it('leaves a mail provider off the company record when it arrives as a website', async () => {
    const ctx = ctxFor({ name: 'Jane Doe', email: 'jane@gmail.com', company: 'Acme Roofing', website: 'https://gmail.com' });
    const res = await new UpsertRecordStage().execute(ctx);

    expect(res.ok).toBe(true);
    expect(companyPosts()).toHaveLength(1);
    expect(companyPosts()[0]?.body['domainName']).toBeUndefined();
    expect(companyPosts()[0]?.body['name']).toBe('Acme Roofing');
    expect(ctx.warnings.join(' ')).toContain('email provider');
  });

  it('keeps a real company domain', async () => {
    await new UpsertRecordStage().execute(ctxFor({
      name: 'Jane Doe', email: 'jane@acme.com', company: 'Acme Roofing', website: 'https://acme.com',
    }));

    expect(companyPosts()[0]?.body['domainName']).toEqual({
      primaryLinkUrl: 'https://acme.com',
      primaryLinkLabel: '',
    });
  });
});

describe('isFreeEmailDomain', () => {
  it.each([
    'gmail.com', 'GMAIL.COM', 'www.gmail.com', 'yahoo.co.uk', 'proton.me',
    'msn.com', 'aol.com', 'icloud.com', 'mailinator.com', 'example.com',
  ])('recognises %s as a mailbox host', (host) => {
    expect(isFreeEmailDomain(host)).toBe(true);
  });

  it.each(['acme.com', 'wearemachina.com', 'gmail.acme.com', 'notgmail.com', ''])(
    'leaves %s alone',
    (host) => { expect(isFreeEmailDomain(host)).toBe(false); },
  );
});
