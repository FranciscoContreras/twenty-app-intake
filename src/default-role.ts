import { defineApplicationRole } from 'twenty-sdk/define';
import { IDS } from './constants/universal-identifiers';

export default defineApplicationRole({
  universalIdentifier: IDS.DEFAULT_ROLE,
  label: 'Intake App Role',
  description:
    'Allows Intake to read and write People, Companies, Notes, Opportunities, and app objects. Required for schema extension via the metadata API.',
  canReadAllObjectRecords: true,
  canUpdateAllObjectRecords: true,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  canUpdateAllSettings: true,
  canBeAssignedToAgents: false,
  canBeAssignedToUsers: false,
  canBeAssignedToApiKeys: false,
  objectPermissions: [],
  fieldPermissions: [],
  permissionFlags: [],
});
