import { HARD_BLOCK_DENIED_TOOLS } from '../constants.js';

export type PermissionName = string;

export type PermissionKind = 'task' | 'native' | 'custom';

export type PermissionStatus = 'allow' | 'deny';

export interface PermissionDecision {
  status: PermissionStatus;
  kind: PermissionKind;
  reason: string;
}

const CUSTOM_PERMISSIONS = new Set(['skill', 'question', 'todowrite', 'doom_loop', 'external_directory']);
const NATIVE_PERMISSIONS = new Set(HARD_BLOCK_DENIED_TOOLS);

export function classifyPermission(permissionName: PermissionName): PermissionKind {
  if (permissionName === 'task') return 'task';
  if (CUSTOM_PERMISSIONS.has(permissionName)) return 'custom';
  return 'native';
}

export function evaluateSessionPermission({
  sessionIsSubagent,
  hardBlockedTier,
  permissionName,
}: {
  sessionIsSubagent: boolean;
  hardBlockedTier?: string;
  permissionName: PermissionName;
}): PermissionDecision {
  const kind = classifyPermission(permissionName);

  if (sessionIsSubagent && kind === 'task') {
    return { status: 'deny', kind, reason: 'Subagent sessions cannot delegate via task().' };
  }

  if (hardBlockedTier && kind === 'native') {
    return { status: 'deny', kind, reason: 'Hard-blocked sessions cannot run native tools directly.' };
  }

  return { status: 'allow', kind, reason: 'Permission matches the router matrix.' };
}

export function isAllowed(decision: PermissionDecision): boolean {
  return decision.status === 'allow';
}
