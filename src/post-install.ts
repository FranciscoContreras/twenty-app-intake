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
  // These show users how rules work and restate the two most common mappings.
  //
  // A third seeded rule sent `fullName` to the note. It never fired while the
  // built-in map was consulted first, so nobody noticed it was pointing a
  // person's name at the overflow note rather than at their record. Rules now
  // outrank the built-in map, which would have made it fire — and it is not
  // seeded any more. Workspaces installed before 0.5.0 still hold the row; the
  // normalizer declines it and says so on the log, and it is safe to delete.
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
