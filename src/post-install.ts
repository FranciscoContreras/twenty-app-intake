import { definePostInstallLogicFunction } from 'twenty-sdk/define';
import type { InstallPayload } from 'twenty-sdk/define';
import { IDS } from './constants/universal-identifiers';
import { coreApi } from './lib/rest-client';

const handler = async (payload: InstallPayload) => {
  // Only run on fresh installs — not version upgrades
  if (payload.previousVersion) {
    return { success: true, message: 'Upgrade — skipping default data creation' };
  }

  const results: string[] = [];

  // ── 1. Create "Getting Started" IntakeSource ──────────────────────────────
  try {
    const { webcrypto } = await import('node:crypto');
    const secretBytes = webcrypto.getRandomValues(new Uint8Array(32));
    const secret = Array.from(secretBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    await coreApi.post('/intakeSources', {
      name: 'Getting Started',
      slug: 'getting-started',
      targetObject: 'AUTO',
      webhookSecret: secret,
      status: 'ACTIVE',
      createOpportunity: true,
      opportunityNameTemplate: '{{source}} — {{firstName}} {{lastName}}',
      totalIngested: 0,
      totalFailed: 0,
    });
    results.push('Created "Getting Started" source');
  } catch (e) {
    results.push(`Could not create sample source: ${String(e).slice(0, 100)}`);
  }

  // ── 2. Create global default IntakeFieldRules ─────────────────────────────
  // These show users how rules work and cover the most common non-obvious mappings.
  const defaultRules = [
    {
      inputPattern: 'phoneNumber',
      canonicalName: 'phone',
      fieldType: 'PHONES',
      priority: 95,
      isActive: true,
    },
    {
      inputPattern: 'emailAddress',
      canonicalName: 'email',
      fieldType: 'EMAILS',
      priority: 95,
      isActive: true,
    },
    {
      inputPattern: 'fullName',
      canonicalName: 'fullName',
      fieldType: 'NOTE',
      priority: 90,
      isActive: true,
    },
  ];

  for (const rule of defaultRules) {
    try {
      await coreApi.post('/intakeFieldRules', rule);
      results.push(`Created global rule: ${rule.inputPattern} → ${rule.canonicalName}`);
    } catch {
      results.push(`Could not create rule ${rule.inputPattern} — may already exist`);
    }
  }

  return { success: true, results };
};

export default definePostInstallLogicFunction({
  universalIdentifier: IDS.POST_INSTALL_LOGIC_FUNCTION,
  name: 'intake-post-install',
  handler,
  shouldRunOnVersionUpgrade: false,
});
