// Dashboard sharing (BACKLOG 9.09): the Share popover and the pieces Settings → Dashboards → Permissions reuses.

export {
  grantsQuery,
  removeGrant,
  setGrantLevel,
  useGrants,
  useGrantTargets,
  useMemberOptions,
  useTeamOptions,
} from './data';
export { GrantRow, grantLabel, TargetAvatar, TeamTile } from './GrantRow';
export {
  filterTargets,
  freeTargets,
  type Grant,
  type Grants,
  type GrantTarget,
  type MemberOption,
  splitGrants,
  type TeamOption,
} from './grants';
export {
  DASHBOARD_LEVEL_DESCRIPTION,
  inheritanceOf,
  LEVEL_LABEL,
  LEVELS,
} from './levels';
export { PermissionLevelSelect, type PermissionLevelSelectProps, type RemoveOption } from './PermissionLevelSelect';
export { SharePopover, type SharePopoverProps } from './SharePopover';
