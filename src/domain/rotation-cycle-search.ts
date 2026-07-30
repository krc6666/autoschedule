import type { Assignment } from "../model";

export const MAX_ROTATION_CYCLE_ROLES = 5;

export interface RotationRole {
  id: string;
  assignments: Assignment[];
  staffId: string;
  staffName: string;
}

export interface RotationCycleSearchResult {
  cycle: RotationRole[] | null;
  attemptedReasons: string[];
}

interface RotationCycleSearchOptions {
  primary: RotationRole;
  roles: RotationRole[];
  eligibilityReason: (
    target: RotationRole,
    incomingStaffId: string
  ) => string | null;
  edgeEligibilityReason?: (
    target: RotationRole,
    incoming: RotationRole
  ) => string | null;
  safetyReasons: (cycle: RotationRole[]) => string[];
  acceptCycle?: (cycle: RotationRole[]) => boolean;
  minRoles?: number;
  maxRoles?: number;
}

export function findShortestRotationCycle({
  primary,
  roles,
  eligibilityReason,
  edgeEligibilityReason,
  safetyReasons,
  acceptCycle,
  minRoles = 2,
  maxRoles = MAX_ROTATION_CYCLE_ROLES,
}: RotationCycleSearchOptions): RotationCycleSearchResult {
  const attemptedReasons: string[] = [];
  const queue: RotationRole[][] = [[primary]];
  const visited = new Set([primary.id]);

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const path = queue[queueIndex]!;
    const last = path[path.length - 1]!;
    if (
      path.length >= Math.max(2, minRoles) &&
      (!acceptCycle || acceptCycle(path))
    ) {
      const closureReason = edgeEligibilityReason
        ? edgeEligibilityReason(last, primary)
        : eligibilityReason(last, primary.staffId);
      if (!closureReason) {
        const reasons = safetyReasons(path);
        if (!reasons.length) return { cycle: path, attemptedReasons };
        attemptedReasons.push(...reasons);
      } else {
        attemptedReasons.push(closureReason);
      }
    }
    if (path.length >= maxRoles) continue;

    const usedRoleIds = new Set(path.map((role) => role.id));
    const usedStaffIds = new Set(path.map((role) => role.staffId));
    for (const next of roles) {
      if (usedRoleIds.has(next.id) || usedStaffIds.has(next.staffId)) continue;
      const reason = edgeEligibilityReason
        ? edgeEligibilityReason(last, next)
        : eligibilityReason(last, next.staffId);
      if (reason) {
        attemptedReasons.push(reason);
        continue;
      }
      const nextPath = [...path, next];
      const signature = nextPath.map((role) => role.id).join("|");
      if (visited.has(signature)) continue;
      visited.add(signature);
      queue.push(nextPath);
    }
  }

  return { cycle: null, attemptedReasons: [...new Set(attemptedReasons)] };
}
