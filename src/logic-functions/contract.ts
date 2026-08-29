import { defineLogicFunction } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';
import { APP_VERSION } from '../constants/version';
import { FIELD_MAP } from '../constants/field-map';
import { coreApi } from '../lib/rest-client';
import { objectFieldNames } from '../lib/diff';
import { snapshot } from '../lib/settings';

/**
 * Everything this app accepts and everything it currently is, in one call.
 *
 * The alternative, for anyone integrating, is reading the source for the field
 * map, querying the rules table for the overrides, and introspecting Twenty's
 * metadata API for the custom fields that already exist — three places, none of
 * which say how the settings are configured. An agent or a script should be able
 * to learn the contract without any of that, and then send a payload that lands
 * where it expects.
 *
 * Secrets never appear. A source reports whether it has a signing secret, not
 * what it is.
 */
const handler = async () => {
  const [sources, rules, objectFields] = await Promise.all([
    loadSources(),
    loadRules(),
    objectFieldNames(),
  ]);

  // Group the built-in map by destination so the answer is "these keys all mean
  // email" rather than a flat list the caller has to invert.
  const canonical = new Map<string, { accepts: string[]; type: string; action: string }>();
  for (const [key, entry] of Object.entries(FIELD_MAP)) {
    const existing = canonical.get(entry.canonicalName);
    if (existing) {
      existing.accepts.push(key);
    } else {
      canonical.set(entry.canonicalName, {
        accepts: [key],
        type: entry.twentyType,
        action: entry.action,
      });
    }
  }

  return {
    statusCode: 200,
    body: {
      app: {
        name: 'twenty-app-intake',
        version: APP_VERSION,
        requiredServerVersion: '>=2.26.0',
      },

      endpoints: ENDPOINTS,

      targetObjects: ['person', 'company', 'opportunity', 'note'],

      /** How a payload key becomes a field, in the order the pipeline tries. */
      resolutionOrder: [
        'Built-in field map (canonicalFields below)',
        'Field rules configured in the workspace (rules below)',
        'Passthrough — the key is camel-cased, prefixed ext, and the type is detected from the value',
      ],

      canonicalFields: [...canonical.entries()].map(([name, v]) => ({
        canonicalName: name,
        accepts: v.accepts,
        twentyType: v.type,
        action: v.action,
      })),

      /**
       * Custom fields Intake has already created or can already write to. This
       * is the live schema, not a guess — a caller can check whether the field
       * it wants exists before sending anything.
       */
      extFields: {
        person: extOnly(objectFields['person']),
        company: extOnly(objectFields['company']),
        opportunity: extOnly(objectFields['opportunity']),
      },

      rules,
      sources,
      settings: snapshot(),

      routing: {
        note: 'A field reaches the Opportunity only when a rule says so or the key carries an explicit prefix. Nothing is routed to a deal by inference.',
        opportunityKeyPrefixes: ['opportunity_', 'opp_', 'deal_'],
      },
    },
  };
};

const ENDPOINTS = [
  { method: 'POST', path: '/s/intake/:slug', auth: false, description: 'Ingest a payload.' },
  { method: 'POST', path: '/s/intake/:slug/test', auth: false, description: 'Dry run — returns a structured diff, writes nothing.' },
  { method: 'GET', path: '/s/intake/health', auth: false, description: 'Health check, plus a summary of silent sources.' },
  { method: 'GET', path: '/s/intake/contract', auth: true, description: 'This document.' },
  { method: 'POST', path: '/s/intake/sources/register', auth: true, description: 'Register a source and get a webhook URL and secret.' },
  { method: 'POST', path: '/s/intake/sources/check-silence', auth: true, description: 'Check every source against its expected cadence.' },
  { method: 'POST', path: '/s/intake/logs/:logId/retry', auth: true, description: 'Retry a failed ingestion from its stored payload.' },
  { method: 'POST', path: '/s/intake/logs/:logId/replay', auth: true, description: 'Re-run any stored payload through the current rules.' },
  { method: 'POST', path: '/s/intake/replay', auth: true, description: 'Bulk replay a selection of stored payloads.' },
  { method: 'GET', path: '/s/intake/quarantine', auth: true, description: 'List held payloads and why they were held.' },
  { method: 'POST', path: '/s/intake/quarantine/:logId/release', auth: true, description: 'Ingest a held payload, overruling the filter.' },
  { method: 'POST', path: '/s/intake/quarantine/:logId/discard', auth: true, description: 'Mark a held payload as junk.' },
];

function extOnly(fields: Set<string> | undefined): string[] {
  return [...(fields ?? [])].filter((f) => /^ext[A-Z]/.test(f)).sort();
}

async function loadSources(): Promise<unknown[]> {
  try {
    const res = await coreApi.get<{
      data: { intakeSources: { edges: Array<{ node: Record<string, unknown> }> } };
    }>('/intakeSources?limit=200');

    return (res.data?.intakeSources?.edges ?? []).map(({ node }) => ({
      slug: node['slug'],
      name: node['name'],
      status: node['status'],
      targetObject: node['targetObject'],
      createOpportunity: node['createOpportunity'],
      // Whether requests must be signed — never the secret itself.
      requiresSignature: Boolean(node['webhookSecret']),
      honeypotField: node['honeypotField'] ?? null,
      mergePolicy: node['mergePolicy'] ?? null,
      expectedCadenceHours: node['expectedCadenceHours'] ?? null,
      healthStatus: node['healthStatus'] ?? null,
      lastIngestedAt: node['lastIngestedAt'] ?? null,
      totalIngested: node['totalIngested'] ?? 0,
    }));
  } catch {
    return [];
  }
}

async function loadRules(): Promise<unknown[]> {
  try {
    const res = await coreApi.get<{
      data: { intakeFieldRules: { edges: Array<{ node: Record<string, unknown> }> } };
    }>('/intakeFieldRules?limit=200&orderBy=priority[DescNullsLast]');

    return (res.data?.intakeFieldRules?.edges ?? []).map(({ node }) => ({
      inputPattern: node['inputPattern'],
      canonicalName: node['canonicalName'],
      fieldType: node['fieldType'],
      targetObject: node['targetObject'] ?? 'AUTO',
      mergeStrategy: node['mergeStrategy'] ?? 'INHERIT',
      priority: node['priority'] ?? 0,
      isActive: node['isActive'] ?? true,
      scope: node['intakeSourceId'] ? 'source' : 'global',
    }));
  } catch {
    return [];
  }
}

export default defineLogicFunction({
  universalIdentifier: IDS.CONTRACT_LOGIC_FUNCTION,
  name: 'intake-contract',
  description: 'Describes what Intake accepts and how it is currently configured, in one call.',
  timeoutSeconds: 20,
  handler,
  httpRouteTriggerSettings: {
    path: '/intake/contract',
    httpMethod: 'GET',
    isAuthRequired: true,
  },
});
