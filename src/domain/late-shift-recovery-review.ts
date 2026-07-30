import type { AppState, Assignment } from "../model";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "./assignment-evidence";
import { lateShiftRecoveryRisk } from "./schedule-protection";
import { assignmentRule } from "./schedule-position-rules";
import {
  applyRotationCycleStaff,
  findSafeRotationCycle,
  isRotationLocked,
} from "./rotation-review-safety";
import { schedulingDecision } from "../schedule-rule-contract";
import type { ScheduleRunFacts } from "./schedule-run-facts";

function applyRecoveryCycle(cycle: Assignment[]): void {
  const original = applyRotationCycleStaff(cycle);
  const protectedAssignment = original[0]!;
  const route =
    cycle.length === 2
      ? `与${original[1]!.staffName}的${original[1]!.flightNo}/${original[1]!.position}安全交换`
      : `通过${original.map((item) => `${item.staffName}:${item.flightNo}/${item.position}`).join(" → ")}完成三人安全重排`;
  const message = `${protectedAssignment.staffName}原在${protectedAssignment.flightNo}/${protectedAssignment.position}，现已${route}，本班已避开跨工作日恢复冲突。`;
  cycle.forEach((assignment) => {
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("late-shift-recovery", "selected", message),
    ]);
  });
}

function recoveryFallback(primary: Assignment, reasons: string[]): string {
  const details = [...new Set(reasons)].slice(0, 4);
  const reason = details.length
    ? details.join("；")
    : "没有可参与安全交换的同航班或重叠航班常规岗位人员";
  return `跨工作日恢复未落实：${primary.staffName}仍安排在${primary.flightNo}/${primary.position}；已检查同航班及重叠航班调换，${reason}；为保证岗位完整性，本班允许突破。`;
}

export function reviewLateShiftRecovery(
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): string[] {
  if (!state.settings.lateShiftRecoveryEnabled) return [];
  const reviewed = new Set<string>();
  const warnings: string[] = [];
  const protectedAssignments = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .filter((assignment) => {
      const flight = state.flights.find(
        (item) => item.id === assignment.flightId
      );
      const rule = assignmentRule(state, assignment);
      return Boolean(
        flight &&
        rule &&
        lateShiftRecoveryRisk(
          state,
          assignment.staffId!,
          {
            ...flight!,
            position: assignment.position,
            remark: assignment.remark,
            fatiguePoints: assignment.fatiguePoints,
          },
          date,
          facts?.crossDayRecovery
        ).excess > 0
      );
    })
    .sort(
      (left, right) =>
        left.startTime.localeCompare(right.startTime) ||
        left.flightNo.localeCompare(right.flightNo) ||
        left.position.localeCompare(right.position)
    );

  for (const primary of protectedAssignments) {
    if (reviewed.has(primary.id)) continue;
    const attemptedReasons = (primary.decisionTrace ?? [])
      .filter(
        (decision) =>
          decision.ruleId === "late-shift-recovery" &&
          decision.outcome === "fallback"
      )
      .map((decision) => decision.message.split("；").slice(1).join("；"))
      .filter(Boolean);
    const search = findSafeRotationCycle({
      state,
      assignments,
      primary,
      date,
      review: "recovery",
      lockedAssignmentIds,
      facts,
      excludedAssignmentIds: reviewed,
      maxAssignments: 3,
    });
    attemptedReasons.push(...search.attemptedReasons);
    const cycle = search.cycle;

    if (cycle) {
      applyRecoveryCycle(cycle);
      cycle.forEach((assignment) => reviewed.add(assignment.id));
      continue;
    }

    reviewed.add(primary.id);
    const message = recoveryFallback(primary, attemptedReasons);
    replaceAssignmentDecisions(primary, "late-shift-recovery", [
      schedulingDecision("late-shift-recovery", "fallback", message),
    ]);
    warnings.push(message);
  }
  return warnings;
}
