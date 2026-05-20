import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok } from '../result';
import { metaApi } from '../rest-client';

const STANDARD_FIELDS = new Set([
  'name', 'emails', 'phones', 'domainName', 'address',
  'linkedInLink', 'xLink', 'companyName', 'firstName', 'lastName', 'fullName',
  'jobTitle', 'city', 'employees', 'annualRecurringRevenue', 'idealCustomerProfile',
]);

export class SyncSchemaStage implements PipelineStage {
  readonly name = 'sync-schema';

  private objectCache = new Map<string, { id: string; fields: Set<string>; at: number }>();
  private readonly TTL = 5 * 60 * 1000;

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    if (!ctx.crmFields || ctx.crmFields.length === 0) return ok(ctx);

    const targets = this.targetObjects(ctx);
    let fieldsCreated = 0;
    let fieldsMatched = 0;

    for (const objectName of targets) {
      const meta = await this.getObjectMeta(objectName);
      if (!meta) continue;

      for (const field of ctx.crmFields) {
        if (STANDARD_FIELDS.has(field.canonicalName)) { fieldsMatched++; continue; }
        if (!/^ext[A-Z]/.test(field.canonicalName)) { fieldsMatched++; continue; }

        if (meta.fields.has(field.canonicalName)) { fieldsMatched++; continue; }

        const created = await this.createField(meta.id, field.canonicalName, field.twentyType);
        if (created) {
          meta.fields.add(field.canonicalName);
          this.objectCache.get(objectName)?.fields.add(field.canonicalName);
          fieldsCreated++;
        } else {
          ctx.warnings.push(`Could not create field "${field.canonicalName}" on ${objectName} — will go to note`);
        }
      }
    }

    return ok({ ...ctx, fieldsCreated, fieldsMatched });
  }

  private targetObjects(ctx: PipelineContext): string[] {
    const t = ctx.source?.targetObject ?? 'AUTO';
    if (t === 'PERSON') return ['person'];
    if (t === 'COMPANY') return ['company'];

    // For structured payloads (pipeline app), extras are company-level data
    if (ctx.structuredCompany) return ['company'];

    // For flat payloads, extras belong on the primary record (person if available)
    const hasPersonData = ctx.crmFields?.some(f =>
      ['firstName', 'lastName', 'email', 'phone', 'fullName', 'emails', 'phones', 'name'].includes(f.canonicalName));
    const hasCompanyData = ctx.crmFields?.some(f =>
      ['companyName', 'domainName'].includes(f.canonicalName));

    const out: string[] = [];
    if (hasPersonData) out.push('person');
    else if (hasCompanyData) out.push('company');
    return out.length > 0 ? out : ['person'];
  }

  private async getObjectMeta(objectName: string): Promise<{ id: string; fields: Set<string> } | null> {
    const cached = this.objectCache.get(objectName);
    if (cached && Date.now() - cached.at < this.TTL) return cached;

    try {
      // Metadata API returns all objects — filter client-side by nameSingular
      const res = await metaApi.get<Array<{ id: string; nameSingular: string; fields: Array<{ name: string }> }>>('/objects');
      const objects = Array.isArray(res) ? res : (res as { data: typeof res }).data ?? [];
      const node = (objects as Array<{ id: string; nameSingular: string; fields: Array<{ name: string }> }>)
        .find(o => o.nameSingular === objectName);
      if (!node) return null;
      const fields = new Set<string>((node.fields ?? []).map((f: { name: string }) => f.name));
      const entry = { id: node.id, fields, at: Date.now() };
      this.objectCache.set(objectName, entry);
      return entry;
    } catch {
      return null;
    }
  }

  private async createField(objectMetadataId: string, name: string, type: string): Promise<boolean> {
    try {
      await metaApi.post('/fields', {
        objectMetadataId,
        name,
        label: toLabel(name),
        type,
        description: 'Auto-created by Intake',
        icon: 'IconPlug',
      });
      return true;
    } catch {
      return false;
    }
  }
}

function toLabel(name: string): string {
  return name.replace(/^ext_/, '').replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1').split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ').trim();
}
