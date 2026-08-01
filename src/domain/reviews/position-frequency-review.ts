import type { AppState, Assignment, Staff } from "../../model";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "../assignments/assignment-evidence";
import { isPriorityRotationPosition } from "./position-rotation-policy";
import {
  comparePositionFrequency,
  createScheduleFrequencyFacts,
  POSITION_FREQUENCY_WORKDAY_COUNT,
  samePositionFrequencyProfile,
  type PositionFrequencyProfile,
  type ScheduleFrequencyFacts,
} from "../statistics/schedule-frequency";
import { assignmentRule } from "../flights/schedule-position-rules";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import {
  isRotationLocked,
  rotationCandidateAssignments,
  type RotationStaffChange,
} from "./rotation-review-safety";
import { optimizeReassignment } from "../solver/reassignment-optimizer";
import type { SolverPort } from "../solver/solver-port";

function frequencyProfileText(profile: PositionFrequencyProfile): string {
  return `本月${profile.currentMonthCount}次、最近${POSITION_FREQUENCY_WORKDAY_COUNT}个已归档工作日${profile.recentWorkdayCount}次`;
}

function frequencyFallback(
  primary: Assignment,
  profile: PositionFrequencyProfile,
  reasons: readonly string[]
): string {
  const reason =
    [...new Set(reasons)].slice(0, 4).join("；") ||
    "没有满足全部安全约束的整体重排方案";
  const message = `同岗高频未调整：${primary.staffName}${frequencyProfileText(profile)}承担${primary.flightNo}/${primary.position}；${reason}；为保证岗位完整性，本班保留原安排。`;
  replaceAssignmentDecisions(primary, "position-frequency-review", [
    schedulingDecision("position-frequency-review", "fallback", message),
  ]);
  return message;
}

function candidateFrequencyOrder(
  state: AppState,
  primary: Assignment,
  date: string,
  facts: ScheduleFrequencyFacts
): (left: Staff, right: Staff) => number {
  return (left, right) =>
    comparePositionFrequency(
      samePositionFrequencyProfile(
        state,
        left.id,
        primary.flightNo,
        primary.position,
        date,
        facts
      ),
      samePositionFrequencyProfile(
        state,
        right.id,
        primary.flightNo,
        primary.position,
        date,
        facts
      )
    ) || left.id.localeCompare(right.id, undefined, { numeric: true });
}

function applyFrequencyPlan(
  state: AppState,
  assignments: Assignment[],
  primary: Assignment,
  profile: PositionFrequencyProfile,
  changes: readonly RotationStaffChange[]
): void {
  const originalById = new Map(
    assignments.map((assignment) => [
      assignment.id,
      {
        staffId: assignment.staffId!,
        staffName: assignment.staffName,
        flightNo: assignment.flightNo,
        position: assignment.position,
      },
    ])
  );
  const originalPrimary = originalById.get(primary.id)!;
  const changedAssignments: Assignment[] = [];
  for (const change of changes) {
    const assignment = assignments.find(
      (item) => item.id === change.assignmentId
    );
    const person = state.staff.find((item) => item.id === change.staffId);
    if (!assignment || !person) continue;
    assignment.staffId = person.id;
    assignment.staffName = person.name;
    changedAssignments.push(assignment);
  }
  const participants = new Set(
    changes.flatMap((change) => [
      originalById.get(change.assignmentId)!.staffId,
      change.staffId,
    ])
  ).size;
  const route = changedAssignments
    .map(
      (assignment) =>
        `${assignment.staffName}接${assignment.flightNo}/${assignment.position}`
    )
    .join(" → ");
  const message = `${originalPrimary.staffName}${frequencyProfileText(profile)}承担${originalPrimary.flightNo}/${originalPrimary.position}，本班已通过${participants}人整体安全重排降低同岗频率：${route}；岗位完整性及全部安全约束验证通过。`;
  changedAssignments.forEach((assignment) => {
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("position-frequency-review", "selected", message),
    ]);
  });
}

export async function reviewSamePositionFrequency(
  solver: SolverPort,
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): Promise<string[]> {
  if (!state.settings.positionRotationEnabled) return [];
  const frequencyFacts =
    facts?.scheduleFrequency ?? createScheduleFrequencyFacts(state, date);
  const warnings: string[] = [];
  const reviewed = new Set<string>();
  const primaryAssignments = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .filter((assignment) => {
      const rule = assignmentRule(state, assignment);
      return Boolean(rule && isPriorityRotationPosition(rule));
    })
    .map((assignment) => ({
      assignment,
      frequency: samePositionFrequencyProfile(
        state,
        assignment.staffId!,
        assignment.flightNo,
        assignment.position,
        date,
        frequencyFacts
      ),
    }))
    .sort(
      (left, right) =>
        right.frequency.currentMonthCount - left.frequency.currentMonthCount ||
        right.frequency.recentWorkdayCount -
          left.frequency.recentWorkdayCount ||
        left.assignment.flightNo.localeCompare(right.assignment.flightNo) ||
        left.assignment.position.localeCompare(right.assignment.position)
    );

  for (const { assignment: primary } of primaryAssignments) {
    if (reviewed.has(primary.id) || !primary.staffId) continue;
    const frequency = samePositionFrequencyProfile(
      state,
      primary.staffId,
      primary.flightNo,
      primary.position,
      date,
      frequencyFacts
    );
    if (frequency.currentMonthCount < 2 && frequency.recentWorkdayCount < 2)
      continue;
    const rule = assignmentRule(state, primary);
    if (!rule) continue;
    const configuredOthers = state.staff.filter(
      (person) =>
        person.id !== primary.staffId &&
        person.staffType === "常规" &&
        rule.qualifiedStaffIds.includes(person.id)
    );
    const lowerFrequencyConfigured = configuredOthers.filter(
      (person) =>
        comparePositionFrequency(
          samePositionFrequencyProfile(
            state,
            person.id,
            primary.flightNo,
            primary.position,
            date,
            frequencyFacts
          ),
          frequency
        ) < 0
    );
    if (!lowerFrequencyConfigured.length) {
      warnings.push(
        frequencyFallback(primary, frequency, [
          configuredOthers.length
            ? "无其他同岗频率更低且具备目标岗位资质的人员"
            : "无其他具备目标岗位资质的人员",
        ])
      );
      reviewed.add(primary.id);
      continue;
    }
    const lowerFrequencyIds = new Set(
      lowerFrequencyConfigured.map((person) => person.id)
    );
    const compareStaff = candidateFrequencyOrder(
      state,
      primary,
      date,
      frequencyFacts
    );
    const result = await optimizeReassignment({
      solver,
      state,
      assignments,
      primary,
      movableAssignments: rotationCandidateAssignments(
        assignments,
        primary,
        state,
        lockedAssignmentIds
      ).filter((assignment) => !reviewed.has(assignment.id)),
      date,
      review: "frequency",
      facts,
      frequencyFacts,
      primaryCandidateAllowed: (person) => lowerFrequencyIds.has(person.id),
      compareCandidates: (_assignment, left, right) =>
        compareStaff(left, right),
    });
    if (result.changes) {
      applyFrequencyPlan(
        state,
        assignments,
        primary,
        frequency,
        result.changes
      );
      result.changes.forEach((change) => reviewed.add(change.assignmentId));
      continue;
    }
    const lockedNames = lowerFrequencyConfigured
      .filter((person) =>
        assignments.some(
          (assignment) =>
            assignment.staffId === person.id &&
            isRotationLocked(state, assignment, lockedAssignmentIds)
        )
      )
      .map((person) => person.name);
    const reasons = [...result.attemptedReasons];
    if (lockedNames.length)
      reasons.push(
        `其他低频人员被值班或KE166特殊锁定：${lockedNames.join("、")}`
      );
    warnings.push(frequencyFallback(primary, frequency, reasons));
    reviewed.add(primary.id);
  }
  return warnings;
}
