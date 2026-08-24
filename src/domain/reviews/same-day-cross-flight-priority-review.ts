import type { Assignment } from "../../model";
import { canAssignStaff } from "../candidates/assignment-eligibility";
import { isPreNoonFlight } from "../flights/schedule-tasks";
import { assignmentRule } from "../flights/schedule-position-rules";
import { replaceAssignmentDecisions } from "../assignments/assignment-evidence";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { isSameDayCxPriorityPosition } from "./position-rotation-policy";
import { isRotationLocked } from "./rotation-review-safety";
import { latePriorityFrequencyRegressionReasons } from "./late-priority-frequency-balance";
import { latePriorityFlightInScope } from "../statistics/late-priority-flight-scope";
import { latePriorityFrequencyKinds } from "./late-priority-policy";

function isCxFlight(flightNo: string): boolean {
  return /^CX\s*/i.test(flightNo.trim());
}

function isMorningCxPriority(
  state: ScheduleGenerationFacts,
  assignment: Assignment
): boolean {
  const rule = assignmentRule(state, assignment);
  return Boolean(
    rule &&
    isCxFlight(assignment.flightNo) &&
    isPreNoonFlight(assignment) &&
    isSameDayCxPriorityPosition(rule)
  );
}

function isEveningCxPriority(
  state: ScheduleGenerationFacts,
  assignment: Assignment
): boolean {
  const rule = assignmentRule(state, assignment);
  return Boolean(
    rule &&
    isCxFlight(assignment.flightNo) &&
    !isPreNoonFlight(assignment) &&
    isSameDayCxPriorityPosition(rule)
  );
}

/**
 * Repairs only an actual same-person morning/evening CX priority conflict.
 * The solver keeps its fast linear model; this pass validates every swap
 * against the existing automatic eligibility contract before committing it.
 */
export function reviewSameDayCrossFlightPriority(
  state: ScheduleGenerationFacts,
  assignments: Assignment[],
  _date: string,
  lockedAssignmentIds: ReadonlySet<string>
): string[] {
  const warnings: string[] = [];
  const morningByStaff = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    if (
      assignment.status !== "assigned" ||
      !assignment.staffId ||
      !isMorningCxPriority(state, assignment)
    )
      continue;
    const own = morningByStaff.get(assignment.staffId) ?? [];
    own.push(assignment);
    morningByStaff.set(assignment.staffId, own);
  }

  for (const evening of assignments) {
    if (
      evening.status !== "assigned" ||
      !evening.staffId ||
      !isEveningCxPriority(state, evening) ||
      !morningByStaff.has(evening.staffId) ||
      isRotationLocked(state, evening, lockedAssignmentIds)
    )
      continue;
    const rule = assignmentRule(state, evening);
    if (!rule) continue;

    const morningStaffIds = new Set(morningByStaff.keys());
    const candidates = state.staff.filter((person) => {
      if (
        person.id === evening.staffId ||
        morningStaffIds.has(person.id) ||
        !rule.qualifiedStaffIds.includes(person.id) ||
        canAssignStaff(
          { ...state, assignments },
          evening.id,
          person.id,
          evening.id
        )
      )
        return false;
      if (
        !latePriorityFlightInScope(
          state.settings.latePriorityFlightNumbers,
          evening.flightNo
        ) ||
        !latePriorityFrequencyKinds(rule).length
      )
        return true;
      const planned = assignments.map((assignment) =>
        assignment.id === evening.id
          ? { ...assignment, staffId: person.id, staffName: person.name }
          : assignment
      );
      return (
        latePriorityFrequencyRegressionReasons(
          state,
          assignments,
          planned,
          _date
        ).length === 0
      );
    });
    const replacement = candidates[0];
    if (!replacement) {
      replaceAssignmentDecisions(evening, "same-day-cross-flight-priority", [
        schedulingDecision(
          "same-day-cross-flight-priority",
          "fallback",
          "无同时满足资质、时间衔接和工时约束的替代人员，保留晚班重点岗位安排。"
        ),
      ]);
      continue;
    }

    const previousName = evening.staffName;
    evening.staffId = replacement.id;
    evening.staffName = replacement.name;
    replaceAssignmentDecisions(evening, "same-day-cross-flight-priority", [
      schedulingDecision(
        "same-day-cross-flight-priority",
        "selected",
        `${previousName} 已承担早班 CX 重点岗位，晚班改由 ${replacement.name} 承担以分散同日重点岗位负荷。`
      ),
    ]);
  }
  return warnings;
}
