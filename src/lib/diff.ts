/**
 * What an ingestion would do, worked out without doing it.
 *
 * The old dry-run answered in prose: a list of field names and a rendered note.
 * It read well and could not be acted on — nothing in it distinguished a field
 * that would be created from one that already existed, or a new contact from an
 * update to somebody's existing record, which are the two questions worth asking
 * before pointing live traffic at a source.
 *
 * This returns the same decisions the pipeline makes, as data. The lookups are
 * the ones the upsert stage uses, so a preview that says "update" is describing
 * the record the real run would actually touch, and the merge policy is applied
 * to the values it finds, so a preview can show that an incoming name is going
 * to be refused because a better one is already there.
 *
 * Read-only throughout: no field is created, no record is written.
 */

import type { NormalizedField } from './normalizer';
import { assembleComposites } from './normalizer';
import { mergePatch, type FieldMergeStrategy } from './merge';
import type { MergePolicy } from './settings';
import { findPersonByEmail, findCompanyByDomain, primaryEmailOf, primaryDomainOf, isCompanyDomain, extractHost } from './lookup';
import { metaApi } from './rest-client';

export type DiffFieldStatus =
  | 'create'      // written to a brand new record
  | 'fill-empty'  // the record exists and this field is blank
  | 'overwrite'   // the record exists, holds a different value, and policy allows replacing it
  | 'preserved'   // the record exists, holds a value, and policy keeps it
  | 'unchanged';  // already exactly this value

export type DiffField = {
  name: string;
  from: 'builtin' | 'rule' | 'passthrough' | 'derived';
  incoming: unknown;
  existing?: unknown;
  status: DiffFieldStatus;
  /** True when the field itself does not exist on the object yet. */
  fieldWouldBeCreated: boolean;
  twentyType?: string;
};

export type DiffObject = {
  object: 'person' | 'company' | 'opportunity' | 'note';
  operation: 'create' | 'update' | 'skip';
  recordId: string | null;
  matchedBy: { field: string; value: string } | null;
  fields: DiffField[];
  fieldsToCreate: Array<{ name: string; type: string }>;
};

export type IntakeDiff = {
  objects: DiffObject[];
  noteFields: string[];
  skipped: string[];
  warnings: string[];
};

export type DiffInput = {
  crmFields: NormalizedField[];
  noteFields: NormalizedField[];
  skipped: NormalizedField[];
  structuredCompany?: Record<string, unknown> | undefined;
  structuredPerson?: Record<string, unknown> | undefined;
  createOpportunity: boolean;
  targetObject: 'PERSON' | 'COMPANY' | 'AUTO';
  policy: MergePolicy;
  warnings: string[];
};

const STANDARD_BY_OBJECT: Record<string, Set<string>> = {
  person: new Set(['name', 'emails', 'phones', 'firstName', 'lastName', 'fullName', 'email', 'phone',
    'linkedInLink', 'xLink', 'jobTitle', 'city', 'companyName', 'domainName', 'address']),
  company: new Set(['name', 'domainName', 'address', 'companyName', 'linkedInLink', 'xLink',
    'employees', 'annualRecurringRevenue', 'idealCustomerProfile', 'city']),
  opportunity: new Set(['name', 'stage', 'amount', 'closeDate']),
};

export async function buildDiff(input: DiffInput): Promise<IntakeDiff> {
  const clean = input.crmFields.filter((f) => !f.originalKey.startsWith('__'));
  const { assembled, remainder } = assembleComposites(clean);
  for (const f of remainder) assembled[f.canonicalName] = f.value;

  const objects: DiffObject[] = [];
  const existingFields = await objectFieldNames();

  const strategyFor = (field: string): FieldMergeStrategy =>
    clean.find((f) => f.canonicalName === field)?.mergeStrategy ?? 'INHERIT';

  // ── Company ──────────────────────────────────────────────────────────────
  const companyName = (input.structuredCompany?.['name'] as string | undefined)
    ?? (assembled['companyName'] as string | undefined);

  if (companyName || input.targetObject === 'COMPANY') {
    const standard: Record<string, unknown> = { ...(input.structuredCompany ?? {}) };
    if (companyName && !standard['name']) standard['name'] = companyName;
    if (!standard['domainName'] && assembled['domainName']) standard['domainName'] = assembled['domainName'];
    if (!standard['address'] && assembled['address']) standard['address'] = assembled['address'];

    // The same refusal UpsertRecordStage makes, made here too. A preview that
    // showed a company the live run declines to create is a preview nobody can
    // gate a deployment on.
    const proposedDomain = primaryDomainOf(standard);
    if (proposedDomain && !isCompanyDomain(proposedDomain)) {
      delete standard['domainName'];
      input.warnings.push(
        `"${extractHost(proposedDomain)}" is an email provider, not a company domain — ` +
        `it was left off the company record.`,
      );
    }

    if (!standard['name'] && !standard['domainName']) {
      input.warnings.push('No company name or domain in this payload — no company was created.');
    } else {
      const domain = primaryDomainOf(standard);
      const existing = domain ? await findCompanyByDomain(domain) : null;

      objects.push(describe(
        'company',
        existing,
        domain ? { field: 'domainName', value: domain } : null,
        { ...standard, ...customFor(clean, 'company') },
        clean,
        existingFields['company'] ?? new Set(),
        input.policy,
        strategyFor,
      ));
    }
  }

  // ── Person ───────────────────────────────────────────────────────────────
  const hasPersonData = assembled['emails'] || assembled['name'] || input.structuredPerson;
  if (hasPersonData || input.targetObject === 'PERSON') {
    const standard: Record<string, unknown> = { ...(input.structuredPerson ?? {}) };
    if (!standard['name'] && assembled['name']) standard['name'] = assembled['name'];
    if (!standard['emails'] && assembled['emails']) standard['emails'] = assembled['emails'];
    if (!standard['phones'] && assembled['phones']) standard['phones'] = assembled['phones'];

    const email = primaryEmailOf(standard) || primaryEmailOf(assembled);
    const existing = email ? await findPersonByEmail(email) : null;

    objects.push(describe(
      'person',
      existing,
      email ? { field: 'emails.primaryEmail', value: email } : null,
      { ...standard, ...customFor(clean, 'person') },
      clean,
      existingFields['person'] ?? new Set(),
      input.policy,
      strategyFor,
    ));
  }

  // ── Opportunity ──────────────────────────────────────────────────────────
  // Always created when the source is configured to, never matched against an
  // existing deal — the pipeline does not dedupe opportunities, and a preview
  // that implied otherwise would be lying about what happens next.
  if (input.createOpportunity && objects.some((o) => o.operation !== 'skip')) {
    const oppCustom = customFor(clean, 'opportunity');
    const oppStandard: Record<string, unknown> = {};
    for (const f of clean) {
      if (f.targetObject === 'opportunity' && (f.canonicalName === 'amount' || f.canonicalName === 'closeDate')) {
        oppStandard[f.canonicalName] = f.value;
      }
    }
    objects.push(describe(
      'opportunity',
      null,
      null,
      { ...oppStandard, ...oppCustom },
      clean,
      existingFields['opportunity'] ?? new Set(),
      input.policy,
      strategyFor,
    ));
  }

  return {
    objects,
    noteFields: input.noteFields.map((f) => f.canonicalName),
    skipped: input.skipped.map((f) => f.originalKey),
    warnings: input.warnings,
  };
}

function customFor(fields: NormalizedField[], object: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const target = f.targetObject === 'auto' ? impliedPrimary(fields) : f.targetObject;
    if (target !== object) continue;
    if (STANDARD_BY_OBJECT[object]?.has(f.canonicalName)) continue;
    out[f.canonicalName] = f.value;
  }
  return out;
}

/** Mirrors SyncSchemaStage's primaryTarget for fields still marked `auto`. */
function impliedPrimary(fields: NormalizedField[]): 'person' | 'company' {
  const hasPerson = fields.some((f) =>
    ['firstName', 'lastName', 'email', 'phone', 'fullName', 'emails', 'phones', 'name'].includes(f.canonicalName));
  return hasPerson ? 'person' : 'company';
}

function describe(
  object: DiffObject['object'],
  existing: Record<string, unknown> | null,
  matchedBy: { field: string; value: string } | null,
  incoming: Record<string, unknown>,
  normalized: NormalizedField[],
  objectFields: Set<string>,
  policy: MergePolicy,
  strategyFor: (field: string) => FieldMergeStrategy,
): DiffObject {
  const { decisions } = existing
    ? mergePatch(existing, incoming, policy, strategyFor)
    : { decisions: {} as Record<string, { write: boolean; status: string }> };

  const fields: DiffField[] = [];
  const fieldsToCreate: Array<{ name: string; type: string }> = [];

  for (const [name, value] of Object.entries(incoming)) {
    const source = normalized.find((f) => f.canonicalName === name);
    const isStandard = STANDARD_BY_OBJECT[object]?.has(name) ?? false;
    const wouldCreate = !isStandard && !objectFields.has(name);

    if (wouldCreate) fieldsToCreate.push({ name, type: source?.twentyType ?? 'TEXT' });

    let status: DiffFieldStatus = 'create';
    if (existing) {
      const decided = decisions[name]?.status;
      status = decided === 'filled-empty' ? 'fill-empty'
        : decided === 'unchanged' ? 'unchanged'
        : decided === 'set' ? 'overwrite'
        : 'preserved';
    }

    fields.push({
      name,
      from: source?.source ?? 'derived',
      incoming: value,
      ...(existing ? { existing: existing[name] } : {}),
      status,
      fieldWouldBeCreated: wouldCreate,
      twentyType: source?.twentyType,
    });
  }

  return {
    object,
    operation: existing ? 'update' : 'create',
    recordId: (existing?.['id'] as string | undefined) ?? null,
    matchedBy,
    fields,
    fieldsToCreate,
  };
}

/**
 * Which fields each object already has. One metadata read serves every object in
 * the diff; a failure degrades to "assume nothing exists", which overstates the
 * fields that would be created rather than hiding any.
 */
export async function objectFieldNames(): Promise<Record<string, Set<string>>> {
  try {
    const res = await metaApi.get<Array<{ nameSingular: string; fields: Array<{ name: string }> }>>('/objects');
    const list = Array.isArray(res) ? res : ((res as { data?: typeof res }).data ?? []);
    const out: Record<string, Set<string>> = {};
    for (const node of list) {
      out[node.nameSingular] = new Set((node.fields ?? []).map((f) => f.name));
    }
    return out;
  } catch {
    return {};
  }
}
