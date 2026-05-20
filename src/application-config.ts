import { defineApplication } from 'twenty-sdk/define';
import defaultRole from './default-role';
import { IDS } from './constants/universal-identifiers';

export const APPLICATION_UNIVERSAL_IDENTIFIER = IDS.APPLICATION;

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  name: 'twenty-app-intake',
  displayName: 'Intake',
  description:
    'Receive leads from any source — contact forms, pipeline apps, or any platform — and automatically normalize, classify, and ingest them into Twenty as clean records. Zero manual field configuration required.',
  category: 'data',
  logoUrl: 'https://raw.githubusercontent.com/your-org/twenty-app-intake/main/public/logo.png',
  websiteUrl: 'https://github.com/your-org/twenty-app-intake',
  defaultRoleUniversalIdentifier: defaultRole.universalIdentifier,
});
