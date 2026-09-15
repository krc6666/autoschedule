import type { Assignment } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import type { SameFlightStaffExclusion } from "./structured-policy-contract";

export const SAME_FLIGHT_STAFF_EXCLUSION_RULE_ID =
  "same-flight-staff-exclusion";

export interface SameFlightStaffExclusionViolation {
  exclusion: SameFlightStaffExclusion;
  flightId: string;
  flightNo: string;
  firstAssignmentIds: string[];
  secondAssignmentIds: string[];
}

export function sameFlightStaffExclusionApplies(
  exclusion: SameFlightStaffExclusion,
  flightNo: string
): boolean {
  return (
    !exclusion.flightNo ||
    exclusion.flightNo.trim().toUpperCase() === flightNo.trim().toUpperCase()
  );
}

export function matchingSameFlightStaffExclusion(
  state: Pick<ScheduleGenerationFacts, "settings">,
  firstStaffId: string,
  secondStaffId: string,
  flightNo: string
): SameFlightStaffExclusion | undefined {
  if (!firstStaffId || !secondStaffId || firstStaffId === secondStaffId)
    return undefined;
  return (state.settings.sameFlightStaffExclusions ?? []).find(
    (exclusion) =>
      sameFlightStaffExclusionApplies(exclusion, flightNo) &&
      ((exclusion.firstStaffId === firstStaffId &&
        exclusion.secondStaffId === secondStaffId) ||
        (exclusion.firstStaffId === secondStaffId &&
          exclusion.secondStaffId === firstStaffId))
  );
}

export function sameFlightStaffExclusionViolations(
  state: Pick<ScheduleGenerationFacts, "settings">,
  assignments: readonly Assignment[]
): SameFlightStaffExclusionViolation[] {
  const assignedByFlight = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    if (assignment.status !== "assigned" || !assignment.staffId) continue;
    const own = assignedByFlight.get(assignment.flightId) ?? [];
    own.push(assignment);
    assignedByFlight.set(assignment.flightId, own);
  }
  const violations: SameFlightStaffExclusionViolation[] = [];
  for (const [flightId, flightAssignments] of assignedByFlight) {
    const flightNo = flightAssignments[0]?.flightNo ?? "";
    for (const exclusion of state.settings.sameFlightStaffExclusions ?? []) {
      if (!sameFlightStaffExclusionApplies(exclusion, flightNo)) continue;
      const firstAssignmentIds = flightAssignments
        .filter((item) => item.staffId === exclusion.firstStaffId)
        .map((item) => item.id);
      const secondAssignmentIds = flightAssignments
        .filter((item) => item.staffId === exclusion.secondStaffId)
        .map((item) => item.id);
      if (!firstAssignmentIds.length || !secondAssignmentIds.length) continue;
      violations.push({
        exclusion,
        flightId,
        flightNo,
        firstAssignmentIds,
        secondAssignmentIds,
      });
    }
  }
  return violations;
}

export function sameFlightStaffExclusionMessage(
  state: Pick<ScheduleGenerationFacts, "staff">,
  violation: SameFlightStaffExclusionViolation
): string {
  return sameFlightStaffExclusionPairMessage(
    state,
    violation.exclusion,
    violation.flightNo
  );
}

export function sameFlightStaffExclusionPairMessage(
  state: Pick<ScheduleGenerationFacts, "staff">,
  exclusion: SameFlightStaffExclusion,
  flightNo: string
): string {
  const name = (staffId: string): string =>
    state.staff.find((person) => person.id === staffId)?.name ?? staffId;
  return `${name(exclusion.firstStaffId)}与${name(
    exclusion.secondStaffId
  )}不能同时安排在${flightNo}`;
}
