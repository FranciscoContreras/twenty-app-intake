import type { PipelineStage, PipelineContext } from '../pipeline';
import type { NormalizedField, TargetObject } from '../normalizer';
import type { Result } from '../result';
import { ok } from '../result';
import { metaApi } from '../rest-client';
import { FIELD_MAP } from '../../constants/field-map';

/**
 * Names the app already knows how to place on a person or company.
 *
 * Two groups, and both matter. The literals are the Twenty field names written
 * directly. The FIELD_MAP values are the *pre-composite* canonical names —
 * `email`, `phone`, `addressCity` — which never appear on the object because
 * assembleComposites folds them into `emails`, `phones` and `address` later.
 * Deriving them from the map rather than restating them is what stops a new
 * built-in mapping from being mistaken for an unknown field and diverted into
 * the note, which would quietly create people with no email address.
 */
const STANDARD_FIELDS = new Set<string>([
  'name', 'emails', 'phones', 'domainName', 'address',
  'linkedInLink', 'xLink', 'companyName', 'firstName', 'lastName', 'fullName',
  'jobTitle', 'city', 'employees', 'annualRecurringRevenue', 'idealCustomerProfile',
  ...Object.values(FIELD_MAP).map((e) => e.canonicalName),
]);

/** Standard Opportunity fields the upsert stage writes directly. */
const STANDARD_OPPORTUNITY_FIELDS = new Set(['name', 'stage', 'amount', 'closeDate']);

const EXT_RE = /^ext[A-Z]/;

export class SyncSchemaStage implements PipelineStage {
  readonly name = 'sync-schema';

  private objectCache = new Map<string, { id: string; fields: Set<string>; at: number }>();
  private readonly TTL = 5 * 60 * 1000;

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    if (!ctx.crmFields || ctx.crmFields.length === 0) return ok(ctx);

    const primary = this.primaryTarget(ctx);
    const creationEnabled = process.env['INTAKE_FIELD_CREATION_ENABLED'] !== 'false';
    if (!creationEnabled) {
      ctx.warnings.push('Field creation disabled by INTAKE_FIELD_CREATION_ENABLED setting — ext fields skipped');
    }

    // Resolve every field's destination up front, so the rest of the pipeline
    // never has to re-derive it. `auto` collapses onto the primary record.
    const resolved: NormalizedField[] = ctx.crmFields.map((f) => ({
      ...f,
      targetObject: this.resolveTarget(f.targetObject, primary, ctx),
    }));

    let fieldsCreated = 0;
    let fieldsMatched = 0;
    const demoted: NormalizedField[] = [];

    for (const objectName of this.targetObjects(resolved)) {
      const fields = resolved.filter((f) => f.targetObject === objectName);
      if (fields.length === 0) continue;

      const standardForObject = objectName === 'opportunity'
        ? STANDARD_OPPORTUNITY_FIELDS
        : STANDARD_FIELDS;

      const meta = await this.getObjectMeta(objectName);
      if (!meta) {
        for (const f of fields) {
          if (standardForObject.has(f.canonicalName)) { f.writable = true; fieldsMatched++; continue; }
          ctx.warnings.push(`Could not read schema for ${objectName} — "${f.canonicalName}" goes to note`);
          demoted.push(f);
        }
        continue;
      }

      const maxExt = parseInt(process.env['INTAKE_MAX_EXT_FIELDS'] ?? '50', 10);
      let extCount = [...meta.fields].filter((f) => EXT_RE.test(f)).length;

      for (const field of fields) {
        const name = field.canonicalName;

        // Standard fields are written by the upsert stage directly.
        if (standardForObject.has(name)) { field.writable = true; fieldsMatched++; continue; }

        // Already on the object — whether an ext field from an earlier run or a
        // field created by hand that a rule now points at.
        if (meta.fields.has(name)) { field.writable = true; fieldsMatched++; continue; }

        // Not present. Only ext-prefixed names are auto-created: minting a field
        // for any name a rule happens to contain would turn a typo into a
        // permanent schema change.
        if (!EXT_RE.test(name)) {
          ctx.warnings.push(
            `Field "${name}" does not exist on ${objectName} and is not ext-prefixed — value routed to note. ` +
            `Create the field in Twenty first, or rename the rule's canonical name to ext${name.charAt(0).toUpperCase()}${name.slice(1)}.`,
          );
          demoted.push(field);
          continue;
        }

        if (!creationEnabled) { demoted.push(field); continue; }

        if (extCount >= maxExt) {
          ctx.warnings.push(`ext field limit (${maxExt}) reached for ${objectName} — "${name}" goes to note`);
          demoted.push(field);
          continue;
        }

        const created = await this.createField(meta.id, name, field.twentyType);
        if (created) {
          meta.fields.add(name);
          this.objectCache.get(objectName)?.fields.add(name);
          extCount++;
          fieldsCreated++;
          field.writable = true;
        } else {
          ctx.warnings.push(`Could not create field "${name}" on ${objectName} — will go to note`);
          demoted.push(field);
        }
      }
    }

    // A field we cannot write is not "matched" — it is note overflow. Moving it
    // here is what keeps the value from disappearing between the two stages.
    const demotedSet = new Set(demoted);
    return ok({
      ...ctx,
      crmFields: resolved.filter((f) => !demotedSet.has(f)),
      noteFields: [...(ctx.noteFields ?? []), ...demoted],
      fieldsCreated,
      fieldsMatched,
    });
  }

  /** Where an `auto` field lands: the person, or the company for company-only payloads. */
  private primaryTarget(ctx: PipelineContext): 'person' | 'company' {
    const t = ctx.source?.targetObject ?? 'AUTO';
    if (t === 'PERSON') return 'person';
    if (t === 'COMPANY') return 'company';

    // For structured payloads (pipeline app), extras are company-level data
    if (ctx.structuredCompany) return 'company';

    const hasPersonData = ctx.crmFields?.some((f) =>
      ['firstName', 'lastName', 'email', 'phone', 'fullName', 'emails', 'phones', 'name'].includes(f.canonicalName));
    const hasCompanyData = ctx.crmFields?.some((f) =>
      ['companyName', 'domainName'].includes(f.canonicalName));

    if (hasPersonData) return 'person';
    if (hasCompanyData) return 'company';
    return 'person';
  }

  private resolveTarget(
    target: TargetObject,
    primary: 'person' | 'company',
    ctx: PipelineContext,
  ): TargetObject {
    if (target === 'auto') return primary;
    // A field routed to the deal has nowhere to go when the source does not open
    // one, so it falls back to the primary record instead of being lost.
    if (target === 'opportunity' && !ctx.source?.createOpportunity) {
      ctx.warnings.push('Field routed to opportunity but this source does not create opportunities — written to the primary record instead');
      return primary;
    }
    return target;
  }

  private targetObjects(fields: NormalizedField[]): string[] {
    const seen = new Set<string>();
    for (const f of fields) if (f.targetObject !== 'auto') seen.add(f.targetObject);
    return [...seen];
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
