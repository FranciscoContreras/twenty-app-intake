import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok, err, ErrorCode } from '../result';
import { assembleComposites } from '../normalizer';
import { formatNote } from '../note-formatter';
import { coreApi, gql } from '../rest-client';

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

    // Build a map of ext field canonical names → their Twenty type for value formatting
    const extFieldTypes = new Map<string, string>();
    for (const f of (ctx.crmFields ?? [])) {
      if (/^ext[A-Z]/.test(f.canonicalName)) extFieldTypes.set(f.canonicalName, f.twentyType);
    }

    try {
      let companyId: string | undefined;
      let personId: string | undefined;

      // ── 1. Upsert Company ──────────────────────────────────────────────
      const needsCompany = rawCompanyName || ctx.source?.targetObject === 'COMPANY';
      if (needsCompany) {
        companyId = await this.upsertCompany(assembled, structuredCompany ?? {}, rawCompanyName, extFieldTypes, ctx);
      }

      // ── 2. Upsert Person ──────────────────────────────────────────────
      const personData = structuredPerson ?? assembled;
      const hasPersonData = personData['emails'] || personData['name'] || assembled['emails'] || assembled['name'];
      if (hasPersonData || ctx.source?.targetObject === 'PERSON') {
        personId = await this.upsertPerson(assembled, structuredPerson, companyId, extFieldTypes, ctx);
      }

      // ── 3. Create Opportunity ─────────────────────────────────────────
      let opportunityId: string | undefined;
      if (ctx.source?.createOpportunity && (personId || companyId)) {
        opportunityId = await this.createOpportunity(assembled, personId, companyId, ctx);
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
    extFieldTypes: Map<string, string>,
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

    // Step 2: PATCH ext fields separately (non-fatal)
    if (Object.keys(structuredCompany).length > 0) {
      const extData: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(assembled)) {
        if (/^ext[A-Z]/.test(k)) extData[k] = formatExtValue(v, extFieldTypes.get(k));
      }
      if (Object.keys(extData).length > 0) {
        await coreApi.patch(`/companies/${companyId}`, extData).catch((e: Error) => {
          ctx.warnings.push(`Could not set ext fields on company: ${e.message.slice(0, 120)}`);
        });
      }
    }

    return companyId;
  }

  private async upsertPerson(
    assembled: Record<string, unknown>,
    structuredPerson: Record<string, unknown> | undefined,
    companyId: string | undefined,
    extFieldTypes: Map<string, string>,
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

    // Step 2: PATCH ext fields for flat/contact-form payloads (non-fatal)
    if (!structuredPerson) {
      const extData: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(assembled)) {
        if (/^ext[A-Z]/.test(k)) extData[k] = formatExtValue(v, extFieldTypes.get(k));
      }
      if (Object.keys(extData).length > 0) {
        await coreApi.patch(`/people/${personId}`, extData).catch((e: Error) => {
          ctx.warnings.push(`Could not set ext fields on person: ${e.message.slice(0, 120)}`);
        });
      }
    }

    return personId;
  }

  private async createOpportunity(
    assembled: Record<string, unknown>,
    personId: string | undefined,
    companyId: string | undefined,
    ctx: PipelineContext,
  ): Promise<string | undefined> {
    try {
      const name = buildOpportunityName(ctx, assembled);
      const stage = process.env['INTAKE_DEFAULT_OPP_STAGE'] ?? 'NEW';
      const data: Record<string, unknown> = { name, stage };
      if (personId) data['pointOfContactId'] = personId;
      if (companyId) data['companyId'] = companyId;

      const created = await coreApi.post<{ data: { createOpportunity: { id: string } } }>('/opportunities', data);
      return created.data.createOpportunity.id;
    } catch {
      ctx.warnings.push('Opportunity creation failed — record was still created');
      return undefined;
    }
  }

  private async createNote(
    overflow: Record<string, unknown>,
    personId: string | undefined,
    companyId: string | undefined,
    ctx: PipelineContext,
  ): Promise<string | undefined> {
    try {
      const markdown = formatNote(ctx.source?.name ?? ctx.sourceSlug, overflow);
      const created = await coreApi.post<{ data: { createNote: { id: string } } }>('/notes', {
        title: `${ctx.source?.name ?? 'Intake'} — Lead`,
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
  const template = ctx.source?.opportunityNameTemplate ?? '{{source}} — {{firstName}} {{lastName}}';
  const name = assembled['name'] as Record<string, string> | undefined;
  return template
    .replace('{{source}}', ctx.source?.name ?? ctx.sourceSlug)
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
  return value;
}
