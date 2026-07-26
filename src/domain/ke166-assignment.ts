import type { AppState, Assignment, Flight, PositionRule } from "../model";
import { createId } from "../utils";
import { eligibleStaffForRule } from "./assignment-eligibility";
import { canMobileSupervisorCoverPosition } from "./mobile-supervisor-coverage";
import { assignmentRule } from "./schedule-position-rules";
import { totalFatiguePriority } from "./schedule-protection";
import { isKe166MobileSupervisor, isNumberedRegularPosition } from "./schedule-tasks";
import { durationHours } from "./time";

export function reuseKe166RegularWorkerAsSupervisor(
  state: AppState,
  assignments: Assignment[],
  flight: Flight,
  rule: PositionRule,
  date: string
): Assignment | undefined {
  if (!isKe166MobileSupervisor(flight, rule)) return undefined;
  const eligibleIds = new Set(eligibleStaffForRule(state, flight, rule).map((person) => person.id));
  const regularAssignment = assignments
    .filter((assignment) => {
      const sourceRule = assignmentRule(state, assignment);
      return assignment.flightId === flight.id
        && assignment.status === "assigned"
        && assignment.staffId
        && eligibleIds.has(assignment.staffId)
        && Boolean(sourceRule
          && isNumberedRegularPosition(sourceRule)
          && canMobileSupervisorCoverPosition(state, {
            flightNo: flight.flightNo,
            position: sourceRule.name,
            remark: sourceRule.remark
          }));
    })
    .sort((left, right) => {
      const leftPerson = state.staff.find((person) => person.id === left.staffId)!;
      const rightPerson = state.staff.find((person) => person.id === right.staffId)!;
      return totalFatiguePriority(leftPerson, assignments, state, date) - totalFatiguePriority(rightPerson, assignments, state, date)
        || leftPerson.id.localeCompare(rightPerson.id, undefined, { numeric: true });
    })[0];
  if (!regularAssignment?.staffId) return undefined;

  const supervisorAssignment: Assignment = {
    id: createId("assignment"),
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule.id,
    position: rule.name,
    staffId: regularAssignment.staffId,
    staffName: regularAssignment.staffName,
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: durationHours(flight.startTime, flight.endTime),
    fatiguePoints: rule.fatiguePoints,
    remark: rule.remark,
    manualRemark: "",
    status: "assigned"
  };
  regularAssignment.workHours = 0;
  regularAssignment.supervisorSourceAssignmentId = supervisorAssignment.id;
  return supervisorAssignment;
}



