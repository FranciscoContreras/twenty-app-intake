import { defineObject, FieldType, RelationType, OnDeleteAction } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';

export default defineObject({
  universalIdentifier: IDS.INTAKE_FIELD_RULE_OBJECT,
  nameSingular: 'intakeFieldRule',
  namePlural: 'intakeFieldRules',
  labelSingular: 'Field Rule',
  labelPlural: 'Field Rules',
  description: 'User-configurable normalization rules. Global rules apply to all sources; source-specific rules override them.',
  icon: 'IconArrowsExchange',
  fields: [
    {
      universalIdentifier: IDS.INTAKE_FIELD_RULE_INPUT_PATTERN,
      name: 'inputPattern',
      type: FieldType.TEXT,
      label: 'Input Pattern',
      description: 'Exact key name or a JavaScript regex string to match against incoming field names.',
      icon: 'IconSearch',
    },
    {
      universalIdentifier: IDS.INTAKE_FIELD_RULE_CANONICAL_NAME,
      name: 'canonicalName',
      type: FieldType.TEXT,
      label: 'Canonical Field Name',
      description: 'The target field name in Twenty. Use an ext prefix (extBudget) to have the field auto-created; any other name must already exist on the target object or the value is routed to the note instead.',
      icon: 'IconTag',
    },
    {
      universalIdentifier: IDS.INTAKE_FIELD_RULE_TARGET_OBJECT,
      name: 'targetObject',
      type: FieldType.SELECT,
      label: 'Target Object',
      description: 'Which record this field is written to. Auto puts it on the primary record (person, or company for company-only payloads). Choose Opportunity for deal attributes such as service, budget or lead id.',
      icon: 'IconTarget',
      options: [
        { value: 'AUTO', label: 'Auto', position: 0, color: 'gray' },
        { value: 'PERSON', label: 'Person', position: 1, color: 'blue' },
        { value: 'COMPANY', label: 'Company', position: 2, color: 'purple' },
        { value: 'OPPORTUNITY', label: 'Opportunity', position: 3, color: 'green' },
      ],
      defaultValue: "'AUTO'",
    },
    {
      universalIdentifier: IDS.INTAKE_FIELD_RULE_FIELD_TYPE,
      name: 'fieldType',
      type: FieldType.SELECT,
      label: 'Field Type',
      description: 'The column type to write, or NOTE / SKIP to route the value instead of storing it. Currency accepts a bare number or a written figure and is stored as a real amount, so it totals in the pipeline.',
      icon: 'IconDatabase',
      /**
       * Every type the pipeline can actually write, and no others.
       *
       * The list must stay in step with `TwentyFieldType` and with what
       * `SyncSchemaStage.createField` can create unattended: a type needing
       * configuration the app cannot supply — SELECT without options, RATING
       * without a scale, the FULL_NAME and ADDRESS composites the upsert only
       * assembles from built-in parts — would be offered here and then fail at
       * the Metadata API, which is worse than not offering it.
       *
       * CURRENCY was handled by `formatExtValue` and documented in the README
       * from 0.4.0 but was missing from this list, so the rule that needed it
       * could not be saved.
       */
      options: [
        { value: 'TEXT', label: 'Text', position: 0, color: 'gray' },
        { value: 'NUMBER', label: 'Number', position: 1, color: 'blue' },
        { value: 'BOOLEAN', label: 'Boolean', position: 2, color: 'green' },
        { value: 'DATE', label: 'Date', position: 3, color: 'orange' },
        { value: 'DATE_TIME', label: 'Date/Time', position: 4, color: 'orange' },
        { value: 'CURRENCY', label: 'Currency', position: 5, color: 'green' },
        { value: 'LINKS', label: 'Link', position: 6, color: 'purple' },
        { value: 'EMAILS', label: 'Email', position: 7, color: 'turquoise' },
        { value: 'PHONES', label: 'Phone', position: 8, color: 'pink' },
        { value: 'RICH_TEXT', label: 'Rich text', position: 9, color: 'blue' },
        { value: 'RAW_JSON', label: 'JSON', position: 10, color: 'gray' },
        { value: 'NOTE', label: 'Always Note', position: 11, color: 'yellow' },
        { value: 'SKIP', label: 'Skip', position: 12, color: 'red' },
      ],
      defaultValue: "'TEXT'",
    },
    {
      universalIdentifier: IDS.INTAKE_FIELD_RULE_MERGE_STRATEGY,
      name: 'mergeStrategy',
      type: FieldType.SELECT,
      label: 'Merge Strategy',
      description: 'What happens when this field already has a value on an existing record. Inherit follows the source or workspace policy. Newest wins suits volatile attributes such as a lead score; preserve suits anything a person may have corrected by hand.',
      icon: 'IconGitMerge',
      options: [
        { value: 'INHERIT', label: 'Inherit', position: 0, color: 'gray' },
        { value: 'PRESERVE', label: 'Preserve existing', position: 1, color: 'green' },
        { value: 'NEWEST_WINS', label: 'Newest wins', position: 2, color: 'orange' },
      ],
      defaultValue: "'INHERIT'",
    },
    {
      universalIdentifier: IDS.INTAKE_FIELD_RULE_PRIORITY,
      name: 'priority',
      type: FieldType.NUMBER,
      label: 'Priority',
      description: 'Higher priority rules are checked first. Default 0.',
      icon: 'IconSortAscending',
      defaultValue: 0,
    },
    {
      universalIdentifier: IDS.INTAKE_FIELD_RULE_IS_ACTIVE,
      name: 'isActive',
      type: FieldType.BOOLEAN,
      label: 'Active',
      icon: 'IconToggleRight',
      defaultValue: "'true'",
    },
    {
      universalIdentifier: IDS.INTAKE_FIELD_RULE_SOURCE_RELATION,
      name: 'intakeSource',
      type: FieldType.RELATION,
      label: 'Source',
      description: 'Leave empty to make this a global rule that applies to all sources.',
      icon: 'IconRadar2',
      isNullable: true,
      defaultValue: null,
      relationTargetObjectMetadataUniversalIdentifier: IDS.INTAKE_SOURCE_OBJECT,
      relationTargetFieldMetadataUniversalIdentifier: IDS.INTAKE_SOURCE_RULES_REVERSE,
      universalSettings: {
        relationType: RelationType.MANY_TO_ONE,
        onDelete: OnDeleteAction.SET_NULL,
        joinColumnName: 'intakeSourceId',
      },
    },
  ],
});
