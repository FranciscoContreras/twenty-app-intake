import type { PipelineStage, PipelineContext } from '../pipeline';
import type { NormalizedField } from '../normalizer';
import type { Result } from '../result';
import { ok, err, ErrorCode } from '../result';
import { assembleComposites } from '../normalizer';
import { formatNote } from '../note-formatter';
import { coreApi, gql } from '../rest-client';

/** Fields each object accepts directly, so they are never PATCHed as custom fields. */
const STANDARD_BY_OBJECT: Record<'person' | 'company' | 'opportunity', Set<string>> = {
  person: new Set(['name', 'emails', 'phones', 'firstName', 'lastName', 'fullName', 'email', 'phone',
    'linkedInLink', 'xLink', 'jobTitle', 'city', 'companyName', 'domainName', 'address']),
  company: new Set(['name', 'domainName', 'address', 'companyName', 'linkedInLink', 'xLink',
    'employees', 'annualRecurringRevenue', 'idealCustomerProfile', 'city']),
  opportunity: new Set(['name', 'stage', 'amount', 'closeDate']),
};

export class UpsertRecordStage implements PipelineStage {
  readonly name = 'upsert-record';

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    if (!ctx.crmFields) return err(ErrorCode.INTERNAL_ERROR, 'No CRM fields to upsert');

    // Strip internal __company_ routing keys from crmFields before assembly
    const cleanFields = ctx.crmFields.filter(f => !f.originalKey.startsWith('__'));
    const { assembled, remainder } = assembleComposites(cleanFields);
    for (const f of remainder) assembled[f.canonicalName] = f.value;

    // For structured payloads, company/person objects are already in Twenty format
    const structuredCompany = ctx.structuredCompany;
    const structuredPerson = ctx.structuredPerson;

    const rawCompanyName = (structuredCompany?.['name'] as string | undefined)
      ?? (assembled['companyName'] as string | undefined);

    // Custom-field values, grouped by the record SyncSchemaStage resolved them
    // onto. Only fields it marked writable appear here — anything it could not
    // place was already moved into the note, so nothing is silently dropped.
    const customFor = (object: 'person' | 'company' | 'opportunity'): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const f of (ctx.crmFields ?? [])) {
        if (f.targetObject !== object || f.writable === false || f.writable === undefined) continue;
        if (STANDARD_BY_OBJECT[object].has(f.canonicalName)) continue;
        out[f.canonicalName] = formatExtValue(f.value, f.twentyType);
      }
      return out;
    };

    try {
      let companyId: string | undefined;
      let personId: string | undefined;

      // ── 1. Upsert Company ──────────────────────────────────────────────
      const needsCompany = rawCompanyName || ctx.source?.targetObject === 'COMPANY';
      if (needsCompany) {
        companyId = await this.upsertCompany(assembled, structuredCompany ?? {}, rawCompanyName, customFor('company'), ctx);
      }

      // ── 2. Upsert Person ──────────────────────────────────────────────
      const personData = structuredPerson ?? assembled;
      const hasPersonData = personData['emails'] || personData['name'] || assembled['emails'] || assembled['name'];
      if (hasPersonData || ctx.source?.targetObject === 'PERSON') {
        personId = await this.upsertPerson(assembled, structuredPerson, companyId, customFor('person'), ctx);
      }

      // ── 3. Create Opportunity ─────────────────────────────────────────
      let opportunityId: string | undefined;
      if (ctx.source?.createOpportunity && (personId || companyId)) {
        opportunityId = await this.createOpportunity(assembled, personId, companyId, ctx.crmFields ?? [], customFor('opportunity'), ctx);
      }

      // ── 4. Create Note + link targets ─────────────────────────────────
      let noteId: string | undefined;
      const noteFields = ctx.noteFields ?? [];
      if (noteFields.length > 0) {
        const overflow: Record<string, unknown> = {};
        for (const f of noteFields) overflow[f.canonicalName] = f.value;
        noteId = await this.createNote(overflow, personId, companyId, ctx);
      }

      return ok({
        ...ctx,
        personId,
        companyId,
        opportunityId,
        noteId,
        recordType: personId ? 'PERSON' : 'COMPANY',
      });
    } catch (e) {
      return err(ErrorCode.RECORD_UPSERT_FAILED, `Failed to upsert record: ${String(e)}`);
    }
  }

  private async upsertCompany(
    assembled: Record<string, unknown>,
    structuredCompany: Record<string, unknown>,
    companyName: string | undefined,
    customData: Record<string, unknown>,
    ctx: PipelineContext,
  ): Promise<string> {
    // Standard fields only for the initial create/update
    const standard: Record<string, unknown> = { ...structuredCompany };
    if (companyName && !standard['name']) standard['name'] = companyName;
    if (!standard['domainName'] && assembled['domainName']) standard['domainName'] = assembled['domainName'];
    if (!standard['address'] && assembled['address']) standard['address'] = assembled['address'];

    // Dedup by domain
    const domain = (standard['domainName'] as Record<string, unknown> | undefined)?.['primaryLinkUrl'] as string | undefined;
    let companyId: string | undefined;
    if (domain) {
      const host = extractHost(domain);
      try {
        const found = await coreApi.get<{ data: { companies: { edges: Array<{ node: { id: string } }> } } }>(
          `/companies?filter=domainName.primaryLinkUrl[like]:%25${encodeURIComponent(host)}%25&first=1`,
        );
        const existing = found.data?.companies?.edges?.[0]?.node;
        if (existing) {
          await coreApi.patch(`/companies/${existing.id}`, standard);
          companyId = existing.id;
        }
      } catch { /* proceed to create */ }
    }

    if (!companyId) {
      try {
        const created = await coreApi.post<{ data: { createCompany: { id: string } } }>('/companies', standard);
        companyId = created.data.createCompany.id;
      } catch (e) {
        // Duplicate — find by name via GraphQL
        if (String(e).toLowerCase().includes('duplicate') && standard['name']) {
          try {
            const found = await gql<{ data: { companies: { edges: Array<{ node: { id: string } }> } } }>(
              `query FindCompany($name: String!) { companies(filter: { name: { eq: $name } }) { edges { node { id } } } }`,
              { name: String(standard['name']) },
            );
            companyId = found.data?.companies?.edges?.[0]?.node?.id;
          } catch { /* ignore */ }
        }
        if (!companyId) throw e;
      }
    }

    // Step 2: PATCH custom fields separately (non-fatal)
    if (Object.keys(customData).length > 0) {
      await coreApi.patch(`/companies/${companyId}`, customData).catch((e: Error) => {
        ctx.warnings.push(`Could not set custom fields on company: ${e.message.slice(0, 120)}`);
      });
    }

    return companyId;
  }

  private async upsertPerson(
    assembled: Record<string, unknown>,
    structuredPerson: Record<string, unknown> | undefined,
    companyId: string | undefined,
    customData: Record<string, unknown>,
    ctx: PipelineContext,
  ): Promise<string> {
    // Standard fields only for initial create/update
    const standard: Record<string, unknown> = structuredPerson ? { ...structuredPerson } : {};
    if (!standard['name'] && assembled['name']) standard['name'] = assembled['name'];
    if (!standard['emails'] && assembled['emails']) standard['emails'] = assembled['emails'];
    if (!standard['phones'] && assembled['phones']) standard['phones'] = assembled['phones'];
    if (companyId) standard['companyId'] = companyId;

    // Dedup by email
    const emails = (standard['emails'] ?? assembled['emails']) as Record<string, string> | undefined;
    const email = emails?.['primaryEmail'];
    let personId: string | undefined;
    if (email) {
      try {
        const found = await coreApi.get<{ data: { people: { edges: Array<{ node: { id: string } }> } } }>(
          `/people?filter=emails.primaryEmail[eq]:${encodeURIComponent(email)}&first=1`,
        );
        const existing = found.data?.people?.edges?.[0]?.node;
        if (existing) {
          await coreApi.patch(`/people/${existing.id}`, standard);
          personId = existing.id;
        }
      } catch { /* proceed to create */ }
    }

    if (!personId) {
      const created = await coreApi.post<{ data: { createPerson: { id: string } } }>('/people', standard);
      personId = created.data.createPerson.id;
    }

    // Step 2: PATCH custom fields separately (non-fatal)
    if (Object.keys(customData).length > 0) {
      await coreApi.patch(`/people/${personId}`, customData).catch((e: Error) => {
        ctx.warnings.push(`Could not set custom fields on person: ${e.message.slice(0, 120)}`);
      });
    }

    return personId;
  }

  private async createOpportunity(
    assembled: Record<string, unknown>,
    personId: string | undefined,
    companyId: string | undefined,
    crmFields: NormalizedField[],
    customData: Record<string, unknown>,
    ctx: PipelineContext,
  ): Promise<string | undefined> {
    let opportunityId: string | undefined;
    try {
      const name = buildOpportunityName(ctx, assembled);
      const stage = process.env['INTAKE_DEFAULT_OPP_STAGE'] ?? 'NEW';
      const data: Record<string, unknown> = { name, stage };
      if (personId) data['pointOfContactId'] = personId;
      if (companyId) data['companyId'] = companyId;

      // Standard deal fields a rule can target by name — `amount` is what makes
      // a stated budget show up in pipeline totals rather than sitting in text.
      for (const f of crmFields) {
        if (f.targetObject !== 'opportunity' || !f.writable) continue;
        if (f.canonicalName === 'amount' || f.canonicalName === 'closeDate') {
          data[f.canonicalName] = formatExtValue(f.value, f.twentyType);
        }
      }

      const created = await coreApi.post<{ data: { createOpportunity: { id: string } } }>('/opportunities', data);
      opportunityId = created.data.createOpportunity.id;
    } catch {
      ctx.warnings.push('Opportunity creation failed — record was still created');
      return undefined;
    }

    // Custom fields go on in a second call, the same way person and company do:
    // a rejected custom field must not cost us the opportunity itself.
    if (Object.keys(customData).length > 0) {
      await coreApi.patch(`/opportunities/${opportunityId}`, customData).catch((e: Error) => {
        ctx.warnings.push(`Could not set custom fields on opportunity: ${e.message.slice(0, 120)}`);
      });
    }

    return opportunityId;
  }

  private async createNote(
    overflow: Record<string, unknown>,
    personId: string | undefined,
    companyId: string | undefined,
    ctx: PipelineContext,
  ): Promise<string | undefined> {
    try {
      const markdown = formatNote(ctx.source?.name ?? ctx.sourceSlug, overflow);
      const appLabel = process.env['INTAKE_APP_LABEL'] ?? 'Intake';
      const created = await coreApi.post<{ data: { createNote: { id: string } } }>('/notes', {
        title: `${ctx.source?.name ?? appLabel} — Lead`,
        bodyV2: { markdown },
      });
      const noteId = created.data.createNote.id;

      if (personId) {
        await coreApi.post('/noteTargets', { noteId, personId }).catch(() => null);
      }
      if (companyId) {
        await coreApi.post('/noteTargets', { noteId, companyId }).catch(() => null);
      }
      return noteId;
    } catch {
      ctx.warnings.push('Note creation failed — record was still created');
      return undefined;
    }
  }
}

function buildOpportunityName(ctx: PipelineContext, assembled: Record<string, unknown>): string {
  const appLabel = process.env['INTAKE_APP_LABEL'] ?? 'Intake';
  const defaultTemplate = `{{source}} — {{firstName}} {{lastName}}`;
  const template = ctx.source?.opportunityNameTemplate ?? defaultTemplate;
  const name = assembled['name'] as Record<string, string> | undefined;
  return template
    .replace('{{source}}', ctx.source?.name ?? appLabel)
    .replace('{{firstName}}', name?.['firstName'] ?? '')
    .replace('{{lastName}}', name?.['lastName'] ?? '')
    .replace('{{email}}', (assembled['emails'] as Record<string, string> | undefined)?.['primaryEmail'] ?? '')
    .replace('{{company}}', assembled['companyName'] as string ?? '')
    .trim().replace(/\s+/g, ' ').replace(/\s*—\s*$/, '');
}

function extractHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

/** Format a custom field value to match Twenty's expected composite types. */
function formatExtValue(value: unknown, type?: string): unknown {
  if (type === 'LINKS' && typeof value === 'string') {
    return { primaryLinkUrl: value, primaryLinkLabel: '' };
  }
  if (type === 'CURRENCY') {
    // Twenty stores currency in micros. Accept a bare number or a written
    // amount ("$5,000/mo") and take the first figure in it.
    const amount = typeof value === 'number'
      ? value
      : Number(String(value ?? '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    return { amountMicros: Math.round(amount * 1_000_000), currencyCode: 'USD' };
  }
  return value;
}
