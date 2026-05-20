import { defineView } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';

export default defineView({
  universalIdentifier: IDS.LOGS_VIEW,
  name: 'Intake Logs',
  objectUniversalIdentifier: IDS.INTAKE_LOG_OBJECT,
  icon: 'IconListDetails',
  fields: [
    { universalIdentifier: 'aa7063c8-c7a4-43eb-97ad-b6285cbc1c93', fieldMetadataUniversalIdentifier: IDS.INTAKE_LOG_PROCESSED_AT, position: 0, size: 160, isVisible: true },
    { universalIdentifier: 'e67a25ae-488e-43af-ba10-539cbc3becbd', fieldMetadataUniversalIdentifier: IDS.INTAKE_LOG_STATUS, position: 1, size: 100, isVisible: true },
    { universalIdentifier: 'd2bf6610-6de2-4db5-9467-47498f3e9bc9', fieldMetadataUniversalIdentifier: IDS.INTAKE_LOG_RECORD_TYPE, position: 2, size: 100, isVisible: true },
    { universalIdentifier: 'fdf6bbae-cd8d-4e2e-9256-470085fe8acd', fieldMetadataUniversalIdentifier: IDS.INTAKE_LOG_FIELDS_CREATED, position: 3, size: 80, isVisible: true },
    { universalIdentifier: '8e6a96a8-b180-4896-b73a-412f199f136f', fieldMetadataUniversalIdentifier: IDS.INTAKE_LOG_FIELDS_MATCHED, position: 4, size: 80, isVisible: true },
    { universalIdentifier: '55c3db60-cf5e-41dd-9c1b-017b5c31a2d4', fieldMetadataUniversalIdentifier: IDS.INTAKE_LOG_OVERFLOW_COUNT, position: 5, size: 80, isVisible: true },
    { universalIdentifier: 'c4509bfa-c8fa-492c-aa75-67244e323d90', fieldMetadataUniversalIdentifier: IDS.INTAKE_LOG_PROCESSING_MS, position: 6, size: 100, isVisible: true },
  ],
});
