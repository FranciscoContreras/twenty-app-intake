import { defineView } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';

export default defineView({
  universalIdentifier: IDS.SOURCES_VIEW,
  name: 'Intake Sources',
  objectUniversalIdentifier: IDS.INTAKE_SOURCE_OBJECT,
  icon: 'IconRadar2',
  fields: [
    { universalIdentifier: 'f860c3eb-39a7-4d10-a8b4-115b28d779f6', fieldMetadataUniversalIdentifier: IDS.INTAKE_SOURCE_NAME, position: 0, size: 180, isVisible: true },
    { universalIdentifier: '992db257-627f-45cc-8818-22cdd92e3bca', fieldMetadataUniversalIdentifier: IDS.INTAKE_SOURCE_SLUG, position: 1, size: 160, isVisible: true },
    { universalIdentifier: 'e474a4bb-e588-433c-aee5-21c6a5c09880', fieldMetadataUniversalIdentifier: IDS.INTAKE_SOURCE_STATUS, position: 2, size: 100, isVisible: true },
    { universalIdentifier: 'be0424cc-aa59-4b7e-9292-a270e90d98b0', fieldMetadataUniversalIdentifier: IDS.INTAKE_SOURCE_TARGET_OBJECT, position: 3, size: 120, isVisible: true },
    { universalIdentifier: 'a32a52ab-1a83-40f8-82c0-06f537422f29', fieldMetadataUniversalIdentifier: IDS.INTAKE_SOURCE_TOTAL_INGESTED, position: 4, size: 100, isVisible: true },
    { universalIdentifier: '80242d84-20ac-44a3-bf5a-3b49174e549f', fieldMetadataUniversalIdentifier: IDS.INTAKE_SOURCE_LAST_INGESTED, position: 5, size: 160, isVisible: true },
  ],
});
