import type { AppState, Assignment } from "../model";
import { canAssignStaff } from "./assignment-eligibility";
import { assignmentRule } from "./schedule-position-rules";
import {
  consecutivePositionAssignments,
  type ScheduleFrequencyFacts,
} from "./schedule-frequency";
import type { ScheduleRunFacts } from "./schedule-run-facts";
import {
  isHighFatigueOrdinaryRotationPosition,
  isPriorityRotationPosition,
} from "./position-rotation-policy";
import {
  reassignmentSafetyReasons,
  rotationCycleReason,
} from "./rotation-review-safety";
import {
  findShortestRotationCycle,
  type RotationRole,
} from "./rotation-cycle-search";
import {
  findShortestOpenRotationChain,
  type OpenRotationChain,
} from "./rotation-open-chain-search";
import { isInFinalLateBatch } from "./cross-day-recovery";

export type ConsecutiveRotationPlan =
  | {
      kind: "cycle";
      cycle: Assignment[];
      fatigueRelief: boolean;
      protectedReplacementFallback: boolean;
    }
  | {
      kind: "open";
      chain: OpenRotationChain;
      protectedReplacementFallback: boolean;
    };

export interface ConsecutiveRotationPlanSearchResult {
  plan: ConsecutiveRotationPlan | null;
  attemptedReasons: string[];
}

interface ConsecutiveRotationPlanSearchOptions {
  state: AppState;
  assignments: Assignment[];
  primary: Assignment;
  availableAssignments: Assignment[];
  date: string;
  originalStaffHasOtherWork: boolean;
  compareStaff: (leftId: string, rightId: string) => number;
  facts?: ScheduleRunFacts;
  frequencyFacts: ScheduleFrequencyFacts;
}

function configuredForAssignment(
  state: AppState,
  assignment: Assignment,
  staffId: string
): boolean {
  return (
    assignmentRule(state, assignment)?.qualifiedStaffIds.includes(staffId) ??
    false
  );
}

function openChainChanges(
  chain: OpenRotationChain
): Array<{ assignmentId: string; staffId: string }> {
  return chain.roles.flatMap((role, index) => {
    const incomingStaffId =
      chain.roles[index + 1]?.staffId ?? chain.endpointStaffId;
    return role.assignments.map((assignment) => ({
      assignmentId: assignment.id,
      staffId: incomingStaffId,
    }));
  });
}

export function findConsecutiveRotationPlan({
  state,
  assignments,
  primary,
  availableAssignments,
  date,
  originalStaffHasOtherWork,
  compareStaff,
  facts,
  frequencyFacts,
}: ConsecutiveRotationPlanSearchOptions): ConsecutiveRotationPlanSearchResult {
  const attemptedReasons: string[] = [];
  const roleFor = (assignment: Assignment): RotationRole => ({
    id: assignment.id,
    assignments: [assignment],
    staffId: assignment.staffId!,
    staffName: assignment.staffName,
  });
  const primaryRole = roleFor(primary);
  const roles = [primaryRole, ...availableAssignments.map(roleFor)];
  const primaryRule = assignmentRule(state, primary)!;
  const latePriorityReliefApplies =
    isPriorityRotationPosition(primaryRule) &&
    isInFinalLateBatch(primary, state.flights, state);

  const eligibilityByTargetAndStaff = new Map<string, string | null>();
  const eligibilityReason = (
    target: RotationRole,
    incomingStaffId: string
  ): string | null => {
    const cacheKey = `${target.id}\u0000${incomingStaffId}`;
    if (eligibilityByTargetAndStaff.has(cacheKey)) {
      return eligibilityByTargetAndStaff.get(cacheKey)!;
    }
    const targetAssignment = target.assignments[0]!;
    if (!configuredForAssignment(state, targetAssignment, incomingStaffId)) {
      eligibilityByTargetAndStaff.set(
        cacheKey,
        "没有具备连续腾挪岗位资质的人员"
      );
      return "没有具备连续腾挪岗位资质的人员";
    }
    const targetRule = assignmentRule(state, targetAssignment)!;
    const before = consecutivePositionAssignments(
      state,
      targetAssignment.staffId!,
      targetAssignment.flightNo,
      targetAssignment.position,
      date,
      frequencyFacts
    );
    const after = consecutivePositionAssignments(
      state,
      incomingStaffId,
      targetAssignment.flightNo,
      targetAssignment.position,
      date,
      frequencyFacts
    );
    const rotationSensitive =
      isPriorityRotationPosition(targetRule) ||
      isHighFatigueOrdinaryRotationPosition(
        targetRule,
        state.settings.highLoadFatigueThreshold
      );
    const transfersConsecutiveProblem =
      targetAssignment.id === primary.id
        ? after >= before
        : rotationSensitive && after > before;
    const reason = transfersConsecutiveProblem
      ? "交换会把连续轮岗问题转移给其他人员"
      : null;
    eligibilityByTargetAndStaff.set(cacheKey, reason);
    return reason;
  };

  const edgeEligibilityByRole = new Map<string, string | null>();
  const edgeEligibilityReason = (
    target: RotationRole,
    incoming: RotationRole
  ): string | null => {
    const cacheKey = `${target.id}\u0000${incoming.id}`;
    if (edgeEligibilityByRole.has(cacheKey)) {
      return edgeEligibilityByRole.get(cacheKey)!;
    }
    const basicReason = eligibilityReason(target, incoming.staffId);
    if (basicReason) {
      edgeEligibilityByRole.set(cacheKey, basicReason);
      return basicReason;
    }
    const releasedIds = new Set(
      incoming.assignments.map((assignment) => assignment.id)
    );
    const validationState: AppState = {
      ...state,
      assignments: assignments.filter(
        (assignment) => !releasedIds.has(assignment.id)
      ),
    };
    const assignmentError = canAssignStaff(
      validationState,
      target.assignments[0]!.id,
      incoming.staffId
    );
    const searchReason =
      isPriorityRotationPosition(primaryRule) &&
      assignmentError?.includes("衔接")
        ? null
        : assignmentError;
    const reason = searchReason ? rotationCycleReason(searchReason) : null;
    edgeEligibilityByRole.set(cacheKey, reason);
    return reason;
  };

  const endpointEligibilityByTargetAndStaff = new Map<string, string | null>();
  const endpointEligibilityReason = (
    target: RotationRole,
    incomingStaffId: string
  ): string | null => {
    const cacheKey = `${target.id}\u0000${incomingStaffId}`;
    if (endpointEligibilityByTargetAndStaff.has(cacheKey)) {
      return endpointEligibilityByTargetAndStaff.get(cacheKey)!;
    }
    const basicReason = eligibilityReason(target, incomingStaffId);
    const assignmentError = basicReason
      ? null
      : canAssignStaff(
          { ...state, assignments },
          target.assignments[0]!.id,
          incomingStaffId
        );
    const searchReason =
      isPriorityRotationPosition(primaryRule) &&
      assignmentError?.includes("衔接")
        ? null
        : assignmentError;
    const reason =
      basicReason ?? (searchReason ? rotationCycleReason(searchReason) : null);
    endpointEligibilityByTargetAndStaff.set(cacheKey, reason);
    return reason;
  };

  const endpointStaffIds = state.staff
    .filter((person) => person.status === "正常" && person.staffType === "常规")
    .sort((left, right) => compareStaff(left.id, right.id))
    .map((person) => person.id);

  const searchOpen = (
    allowProtectedReplacement: boolean
  ): OpenRotationChain | null => {
    if (!originalStaffHasOtherWork) return null;
    for (let participants = 2; participants <= 5; participants += 1) {
      const search = findShortestOpenRotationChain({
        primary: primaryRole,
        roles,
        endpointStaffIds,
        eligibilityReason,
        edgeEligibilityReason,
        endpointEligibilityReason,
        safetyReasons: (chain) =>
          reassignmentSafetyReasons({
            kind: "plan",
            state,
            assignments,
            changes: openChainChanges(chain),
            primaryAssignmentId: primary.id,
            date,
            review: "consecutive",
            facts,
            frequencyFacts,
            ...(allowProtectedReplacement
              ? {
                  latePriorityFatigueRelief: {
                    primaryAssignmentId: primary.id,
                    repeatedStaffId: primary.staffId!,
                    allowProtectedReplacement: true,
                  },
                }
              : {}),
          }),
        minParticipants: participants,
        maxParticipants: participants,
      });
      attemptedReasons.push(...search.attemptedReasons);
      if (search.chain) return search.chain;
    }
    return null;
  };

  const reliefTargets = availableAssignments
    .filter((candidate) => {
      const rule = assignmentRule(state, candidate);
      return Boolean(
        rule &&
        !isPriorityRotationPosition(rule) &&
        candidate.fatiguePoints < primary.fatiguePoints &&
        configuredForAssignment(state, candidate, primary.staffId!)
      );
    })
    .sort(
      (left, right) =>
        left.fatiguePoints - right.fatiguePoints ||
        compareStaff(left.staffId!, right.staffId!)
    );

  const searchFatigueRelief = (
    allowProtectedReplacement: boolean
  ): RotationRole[] | null => {
    const fatigueLevels = [
      ...new Set(reliefTargets.map((target) => target.fatiguePoints)),
    ];
    for (const fatigueLevel of fatigueLevels) {
      const solutions = reliefTargets
        .filter((target) => target.fatiguePoints === fatigueLevel)
        .flatMap((target) => {
          const search = findShortestRotationCycle({
            primary: primaryRole,
            roles,
            eligibilityReason,
            edgeEligibilityReason,
            acceptCycle: (candidateRoles) =>
              candidateRoles[candidateRoles.length - 1]?.id === target.id,
            safetyReasons: (candidateRoles) =>
              reassignmentSafetyReasons({
                kind: "cycle",
                state,
                assignments,
                cycle: candidateRoles.map((role) => role.assignments[0]!),
                date,
                review: "consecutive",
                facts,
                frequencyFacts,
                latePriorityFatigueRelief: {
                  primaryAssignmentId: primary.id,
                  repeatedStaffId: primary.staffId!,
                  allowProtectedReplacement,
                },
              }),
            minRoles: 2,
            maxRoles: 5,
          });
          attemptedReasons.push(...search.attemptedReasons);
          return search.cycle ? [search.cycle] : [];
        })
        .sort(
          (left, right) =>
            left.length - right.length ||
            compareStaff(left[1]!.staffId, right[1]!.staffId) ||
            compareStaff(
              left[left.length - 1]!.staffId,
              right[right.length - 1]!.staffId
            )
        );
      if (solutions.length) return solutions[0]!;
    }
    return null;
  };

  if (latePriorityReliefApplies) {
    const strictOpen = searchOpen(false);
    if (strictOpen) {
      return {
        plan: {
          kind: "open",
          chain: strictOpen,
          protectedReplacementFallback: false,
        },
        attemptedReasons,
      };
    }
    const strictRelief = searchFatigueRelief(false);
    if (strictRelief) {
      return {
        plan: {
          kind: "cycle",
          cycle: strictRelief.map((role) => role.assignments[0]!),
          fatigueRelief: true,
          protectedReplacementFallback: false,
        },
        attemptedReasons,
      };
    }
    const protectedOpen = searchOpen(true);
    if (protectedOpen) {
      return {
        plan: {
          kind: "open",
          chain: protectedOpen,
          protectedReplacementFallback: true,
        },
        attemptedReasons,
      };
    }
    const protectedRelief = searchFatigueRelief(true);
    return {
      plan: protectedRelief
        ? {
            kind: "cycle",
            cycle: protectedRelief.map((role) => role.assignments[0]!),
            fatigueRelief: true,
            protectedReplacementFallback: true,
          }
        : null,
      attemptedReasons,
    };
  }

  for (let participantLimit = 3; participantLimit <= 5; participantLimit += 1) {
    const minimumParticipants = participantLimit === 3 ? 2 : participantLimit;
    const closedSearch = findShortestRotationCycle({
      primary: primaryRole,
      roles,
      eligibilityReason,
      edgeEligibilityReason,
      safetyReasons: (candidateRoles) =>
        reassignmentSafetyReasons({
          kind: "cycle",
          state,
          assignments,
          cycle: candidateRoles.map((role) => role.assignments[0]!),
          date,
          review: "consecutive",
          facts,
          frequencyFacts,
        }),
      minRoles: minimumParticipants,
      maxRoles: participantLimit,
    });
    attemptedReasons.push(...closedSearch.attemptedReasons);
    if (closedSearch.cycle) {
      return {
        plan: {
          kind: "cycle",
          cycle: closedSearch.cycle.map((role) => role.assignments[0]!),
          fatigueRelief: false,
          protectedReplacementFallback: false,
        },
        attemptedReasons,
      };
    }
    if (!originalStaffHasOtherWork) continue;
    const openSearch = findShortestOpenRotationChain({
      primary: primaryRole,
      roles,
      endpointStaffIds,
      eligibilityReason,
      edgeEligibilityReason,
      endpointEligibilityReason,
      safetyReasons: (chain) =>
        reassignmentSafetyReasons({
          kind: "plan",
          state,
          assignments,
          changes: openChainChanges(chain),
          primaryAssignmentId: primary.id,
          date,
          review: "consecutive",
          facts,
          frequencyFacts,
        }),
      minParticipants: minimumParticipants,
      maxParticipants: participantLimit,
    });
    attemptedReasons.push(...openSearch.attemptedReasons);
    if (openSearch.chain) {
      return {
        plan: {
          kind: "open",
          chain: openSearch.chain,
          protectedReplacementFallback: false,
        },
        attemptedReasons,
      };
    }
  }

  return { plan: null, attemptedReasons: [...new Set(attemptedReasons)] };
}
