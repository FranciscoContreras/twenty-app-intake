import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok, err, ErrorCode } from '../result';
import { assembleComposites } from '../normalizer';
import { formatNote } from '../note-formatter';
import type { CoreApiClient } from 'twenty-client-sdk/core';

export class UpsertRecordStage implements PipelineStage {
  readonly name = 'upsert-record';

  constructor(private readonly client: CoreApiClient) {}

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    if (!ctx.crmFields) return err(ErrorCode.INTERNAL_ERROR, 'No CRM fields to upsert');

    const { assembled, remainder } = assembleComposites(ctx.crmFields);
    for (const f of remainder) {
      assembled[f.canonicalName] = f.value;
    }

    const companyName = ctx.flat?.['__company_name'] as string | undefined
      ?? assembled['companyName'] as string | undefined;

    let companyId: string | undefined;
    let personId: string | undefined;

    try {
      // ── 1. Upsert Company ──────────────────────────────────────────────
      if (companyName || ctx.source?.targetObject === 'COMPANY') {
        companyId = await this.upsertCompany(assembled, companyName, ctx);
      }

      // ── 2. Upsert Person ──────────────────────────────────────────────
      const hasPersonFields = assembled['emails'] || assembled['name'] || assembled['phones'];
      if (hasPersonFields || ctx.source?.targetObject === 'PERSON') {
        personId = await this.upsertPerson(assembled, companyId, ctx);
      }

      // ── 3. Create Opportunity ──────────────────────────────────────────
      let opportunityId: string | undefined;
      if (ctx.source?.createOpportunity && (personId || companyId)) {
        opportunityId = await this.createOpportunity(assembled, personId, companyId, ctx);
      }

      // ── 4. Create Note + NoteTargets ──────────────────────────────────
      let noteId: string | undefined;
      const noteFields = ctx.noteFields ?? [];
      if (noteFields.length > 0) {
        const noteOverflow: Record<string, unknown> = {};
        for (const f of noteFields) {
          noteOverflow[f.canonicalName] = f.value;
        }
        noteId = await this.createNote(noteOverflow, personId, companyId, ctx);
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
    companyName: string | undefined,
    ctx: PipelineContext,
  ): Promise<string> {
    const companyData: Record<string, unknown> = {};

    if (companyName) companyData['name'] = companyName;
    if (assembled['domainName']) companyData['domainName'] = assembled['domainName'];
    if (assembled['address']) companyData['address'] = assembled['address'];
    if (assembled['linkedInLink']) companyData['linkedInLink'] = { primaryLinkUrl: assembled['linkedInLink'] };

    // Copy ext_ fields
    for (const [k, v] of Object.entries(assembled)) {
      if (k.startsWith('ext_')) companyData[k] = v;
    }

    // Try to find existing by domain first, then name
    const domain = (assembled['domainName'] as Record<string, unknown> | undefined)?.['primaryLinkUrl'] as string | undefined;
    if (domain) {
      const found = await this.client.query({
        companies: {
          __args: { filter: { domainName: { primaryLinkUrl: { like: `%${extractDomain(domain)}%` } } }, first: 1 },
          edges: { node: { id: true } },
        },
      });
      const existing = found.companies?.edges?.[0]?.node;
      if (existing) {
        await this.client.mutation({
          updateOneCompany: { __args: { id: existing.id, data: companyData }, id: true },
        });
        return existing.id as string;
      }
    }

    const created = await this.client.mutation({
      createOneCompany: { __args: { data: companyData }, id: true },
    });
    return created.createOneCompany.id as string;
  }

  private async upsertPerson(
    assembled: Record<string, unknown>,
    companyId: string | undefined,
    ctx: PipelineContext,
  ): Promise<string> {
    const email = (assembled['emails'] as Record<string, string> | undefined)?.['primaryEmail'];

    const personData: Record<string, unknown> = {};
    if (assembled['name']) personData['name'] = assembled['name'];
    if (assembled['emails']) personData['emails'] = assembled['emails'];
    if (assembled['phones']) personData['phones'] = assembled['phones'];
    if (companyId) personData['company'] = { connect: { id: companyId } };

    for (const [k, v] of Object.entries(assembled)) {
      if (k.startsWith('ext_')) personData[k] = v;
    }

    // Dedup by email
    if (email) {
      const found = await this.client.query({
        people: {
          __args: { filter: { emails: { primaryEmail: { eq: email } } }, first: 1 },
          edges: { node: { id: true } },
        },
      });
      const existing = found.people?.edges?.[0]?.node;
      if (existing) {
        await this.client.mutation({
          updateOnePerson: { __args: { id: existing.id, data: personData }, id: true },
        });
        return existing.id as string;
      }
    }

    const created = await this.client.mutation({
      createOnePerson: { __args: { data: personData }, id: true },
    });
    return created.createOnePerson.id as string;
  }

  private async createOpportunity(
    assembled: Record<string, unknown>,
    personId: string | undefined,
    companyId: string | undefined,
    ctx: PipelineContext,
  ): Promise<string | undefined> {
    try {
      const name = buildOpportunityName(ctx, assembled);
      const data: Record<string, unknown> = { name, stage: 'NEW' };
      if (personId) data['pointOfContactId'] = personId;
      if (companyId) data['companyId'] = companyId;

      const created = await this.client.mutation({
        createOneOpportunity: { __args: { data }, id: true },
      });
      return created.createOneOpportunity.id as string;
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
      const created = await this.client.mutation({
        createOneNote: {
          __args: {
            data: {
              title: `${ctx.source?.name ?? 'Intake'} — Lead`,
              bodyV2: { markdown },
            },
          },
          id: true,
        },
      });
      const noteId = created.createOneNote.id as string;

      // Link note to person
      if (personId) {
        await this.client.mutation({
          createOneNoteTarget: {
            __args: { data: { noteId, targetPersonId: personId } },
            id: true,
          },
        });
      }
      // Link note to company
      if (companyId) {
        await this.client.mutation({
          createOneNoteTarget: {
            __args: { data: { noteId, targetCompanyId: companyId } },
            id: true,
          },
        });
      }

      return noteId;
    } catch {
      ctx.warnings.push('Note creation failed — record was still created');
      return undefined;
    }
  }
}

function buildOpportunityName(
  ctx: PipelineContext,
  assembled: Record<string, unknown>,
): string {
  const template = ctx.source?.opportunityNameTemplate
    ?? '{{source}} — {{firstName}} {{lastName}}';
  const name = assembled['name'] as Record<string, string> | undefined;

  return template
    .replace('{{source}}', ctx.source?.name ?? ctx.sourceSlug)
    .replace('{{firstName}}', name?.['firstName'] ?? '')
    .replace('{{lastName}}', name?.['lastName'] ?? '')
    .replace('{{email}}', (assembled['emails'] as Record<string, string> | undefined)?.['primaryEmail'] ?? '')
    .replace('{{company}}', assembled['companyName'] as string ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*—\s*$/, '');
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
