import type { AppState, Assignment } from "../model";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "./assignment-evidence";
import {
  isNextDutyRestConflict,
  nextDutyRestProtection,
} from "./next-duty-rest";
import {
  applyRotationCycleStaff,
  findSafeRotationCycle,
  isRotationLocked,
} from "./rotation-review-safety";
import { assignmentRule } from "./schedule-position-rules";
import { schedulingDecision } from "../schedule-rule-contract";
import type { ScheduleRunFacts } from "./schedule-run-facts";

function applyRestCycle(cycle: Assignment[], nextWorkdayDate: string): void {
  const original = applyRotationCycleStaff(cycle);
  const protectedAssignment = original[0]!;
  const route =
    cycle.length === 2
      ? `与${original[1]!.staffName}安全交换`
      : `通过${original.map((item) => item.staffName).join(" → ")}完成三人安全重排`;
  const message = `${protectedAssignment.staffName}下个工作班${nextWorkdayDate}值班，已从${protectedAssignment.flightNo}/${protectedAssignment.position}${route}到普通岗位，预休保护已落实。`;
  cycle.forEach((assignment) => {
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("next-duty-rest", "selected", message),
    ]);
  });
}

function restFallback(
  primary: Assignment,
  nextWorkdayDate: string,
  reasons: string[]
): string {
  const details = [...new Set(reasons)].slice(0, 4);
  const reason = details.length
    ? details.join("；")
    : "没有可参与安全交换的同航班或重叠航班常规岗位人员";
  return `下班次值班预休未落实：${primary.staffName}在${nextWorkdayDate}值班，本班仍承担${primary.flightNo}/${primary.position}；已检查同航班及重叠航班调换，${reason}；为保证岗位完整性，本班允许突破。`;
}

export function reviewNextDutyRest(
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): string[] {
  const protection = facts?.nextDutyRest ?? nextDutyRestProtection(state, date);
  if (!protection.dutyStaffId) return [];
  const reviewed = new Set<string>();
  const warnings: string[] = [];
  const protectedAssignments = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .filter((assignment) => {
      const rule = assignmentRule(state, assignment);
      return Boolean(
        rule &&
        isNextDutyRestConflict(
          state,
          assignment.staffId!,
          rule,
          date,
          protection
        )
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
          decision.ruleId === "next-duty-rest" &&
          decision.outcome === "fallback"
      )
      .map((decision) => decision.message.split("；").slice(1).join("；"))
      .filter(Boolean);
    const search = findSafeRotationCycle({
      state,
      assignments,
      primary,
      date,
      review: "next-duty-rest",
      lockedAssignmentIds,
      facts,
      excludedAssignmentIds: reviewed,
      maxAssignments: 3,
    });
    attemptedReasons.push(...search.attemptedReasons);
    const cycle = search.cycle;

    if (cycle) {
      applyRestCycle(cycle, protection.nextWorkdayDate);
      cycle.forEach((assignment) => reviewed.add(assignment.id));
      continue;
    }

    reviewed.add(primary.id);
    const message = restFallback(
      primary,
      protection.nextWorkdayDate,
      attemptedReasons
    );
    replaceAssignmentDecisions(primary, "next-duty-rest", [
      schedulingDecision("next-duty-rest", "fallback", message),
    ]);
    warnings.push(message);
  }
  return warnings;
}
