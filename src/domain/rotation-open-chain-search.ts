import type { RotationRole } from "./rotation-cycle-search";

export interface OpenRotationChain {
  roles: RotationRole[];
  endpointStaffId: string;
}

export interface OpenRotationChainSearchResult {
  chain: OpenRotationChain | null;
  attemptedReasons: string[];
}

interface OpenRotationChainSearchOptions {
  primary: RotationRole;
  roles: RotationRole[];
  endpointStaffIds: string[];
  eligibilityReason: (
    target: RotationRole,
    incomingStaffId: string
  ) => string | null;
  edgeEligibilityReason?: (
    target: RotationRole,
    incoming: RotationRole
  ) => string | null;
  endpointEligibilityReason?: (
    target: RotationRole,
    incomingStaffId: string
  ) => string | null;
  safetyReasons: (chain: OpenRotationChain) => string[];
  minParticipants?: number;
  maxParticipants: number;
}

export function findShortestOpenRotationChain({
  primary,
  roles,
  endpointStaffIds,
  eligibilityReason,
  edgeEligibilityReason,
  endpointEligibilityReason,
  safetyReasons,
  minParticipants = 2,
  maxParticipants,
}: OpenRotationChainSearchOptions): OpenRotationChainSearchResult {
  const attemptedReasons: string[] = [];
  const queue: RotationRole[][] = [[primary]];
  const visited = new Set([primary.id]);

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const path = queue[queueIndex]!;
    const last = path[path.length - 1]!;
    const usedStaffIds = new Set(path.map((role) => role.staffId));
    if (path.length + 1 >= Math.max(2, minParticipants)) {
      for (const endpointStaffId of endpointStaffIds) {
        if (usedStaffIds.has(endpointStaffId)) continue;
        const endpointReason = endpointEligibilityReason
          ? endpointEligibilityReason(last, endpointStaffId)
          : eligibilityReason(last, endpointStaffId);
        if (endpointReason) {
          attemptedReasons.push(endpointReason);
          continue;
        }
        const chain = { roles: path, endpointStaffId };
        const reasons = safetyReasons(chain);
        if (!reasons.length) return { chain, attemptedReasons };
        attemptedReasons.push(...reasons);
      }
    }

    if (path.length + 1 >= maxParticipants) continue;
    const usedRoleIds = new Set(path.map((role) => role.id));
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

  return { chain: null, attemptedReasons: [...new Set(attemptedReasons)] };
}
