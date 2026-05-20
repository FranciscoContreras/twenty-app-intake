import { defineNavigationMenuItem, NavigationMenuItemType } from 'twenty-sdk/define';
import { IDS } from '../constants/universal-identifiers';

export default defineNavigationMenuItem({
  universalIdentifier: IDS.INTAKE_NAV_ITEM,
  name: 'intake',
  label: 'Intake',
  icon: 'IconRadar2',
  position: 2,
  type: NavigationMenuItemType.VIEW,
  viewUniversalIdentifier: IDS.SOURCES_VIEW,
});
