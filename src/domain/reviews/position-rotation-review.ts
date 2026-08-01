import type { AppState, Assignment } from "../../model";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "../assignments/assignment-evidence";
import { applyConfiguredEarlyReleases } from "../assignments/assignment-timing";
import { findConsecutiveRotationPlan } from "./consecutive-rotation-plan";
import { historyFatigue } from "../statistics/fatigue";
import { reviewKe166GroupRotation } from "./ke166-rotation-review";
import {
  isHighFatigueOrdinaryRotationPosition,
  isPriorityRotationPosition,
} from "./position-rotation-policy";
import {
  comparePreviousWorkdayLoad,
  createPreviousWorkdayLoadFacts,
  previousWorkdayLoadForStaff,
} from "../shared/previous-workday-load";
import {
  comparePositionFrequency,
  consecutivePositionAssignments,
  createScheduleFrequencyFacts,
  samePositionFrequencyProfile,
  type ScheduleFrequencyFacts,
} from "../statistics/schedule-frequency";
import { assignmentRule } from "../flights/schedule-position-rules";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import {
  isRotationLocked,
  rotationCandidateAssignments,
  type RotationStaffChange,
} from "./rotation-review-safety";
import type { SolverPort } from "../solver/solver-port";
import { countedWorkloadAssignments } from "../shared/workload-accounting";

type RotationKind = "priority" | "high-fatigue" | "ordinary";

function rotationKind(state: AppState, assignment: Assignment): RotationKind {
  const rule = assignmentRule(state, assignment)!;
  if (isPriorityRotationPosition(rule)) return "priority";
  return isHighFatigueOrdinaryRotationPosition(
    rule,
    state.settings.highLoadFatigueThreshold
  )
    ? "high-fatigue"
    : "ordinary";
}

function rotationKindOrder(kind: RotationKind): number {
  if (kind === "priority") return 0;
  if (kind === "high-fatigue") return 1;
  return 2;
}

function targetStaffOrder(
  state: AppState,
  assignments: Assignment[],
  primary: Assignment,
  date: string,
  facts?: ScheduleRunFacts,
  frequencyFacts?: ScheduleFrequencyFacts
): (leftId: string, rightId: string) => number {
  const countedAssignments = countedWorkloadAssignments(state, assignments);
  const previousLoadFacts =
    facts?.previousWorkdayLoad ?? createPreviousWorkdayLoadFacts(state, date);
  const loadByStaffId = new Map(
    state.staff.map((person) => {
      const ownAssignments = countedAssignments.filter(
        (assignment) => assignment.staffId === person.id
      );
      return [
        person.id,
        {
          historyFatigue: historyFatigue(
            state.history,
            person.id,
            date,
            state.settings
          ),
          todayWorkHours: ownAssignments.reduce(
            (sum, assignment) => sum + assignment.workHours,
            0
          ),
          todayFatigue:
            ownAssignments.reduce(
              (sum, assignment) => sum + assignment.fatiguePoints,
              0
            ) +
            (facts?.currentDutyStaffId === person.id
              ? state.settings.dutyFatiguePoints
              : 0),
        },
      ] as const;
    })
  );
  return (leftId, rightId) => {
    const leftLoad = loadByStaffId.get(leftId)!;
    const rightLoad = loadByStaffId.get(rightId)!;
    return (
      comparePreviousWorkdayLoad(
        previousWorkdayLoadForStaff(previousLoadFacts, leftId),
        previousWorkdayLoadForStaff(previousLoadFacts, rightId)
      ) ||
      comparePositionFrequency(
        samePositionFrequencyProfile(
          state,
          leftId,
          primary.flightNo,
          primary.position,
          date,
          frequencyFacts
        ),
        samePositionFrequencyProfile(
          state,
          rightId,
          primary.flightNo,
          primary.position,
          date,
          frequencyFacts
        )
      ) ||
      leftLoad.historyFatigue - rightLoad.historyFatigue ||
      leftLoad.todayWorkHours - rightLoad.todayWorkHours ||
      leftLoad.todayFatigue - rightLoad.todayFatigue ||
      state.staff.findIndex((person) => person.id === leftId) -
        state.staff.findIndex((person) => person.id === rightId) ||
      leftId.localeCompare(rightId, undefined, { numeric: true })
    );
  };
}

function applyRotationPlan(
  state: AppState,
  assignments: Assignment[],
  primary: Assignment,
  changes: readonly RotationStaffChange[],
  runs: number,
  fatigueRelief: boolean,
  protectedReplacementFallback: boolean
): string | undefined {
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
  applyConfiguredEarlyReleases(
    assignments,
    state,
    new Set(
      changedAssignments.flatMap((item) => (item.staffId ? [item.staffId] : []))
    )
  );
  const participants = new Set(
    changes.flatMap((change) => [
      originalById.get(change.assignmentId)!.staffId,
      change.staffId,
    ])
  ).size;
  const route = changes
    .map((change) => {
      const assignment = assignments.find(
        (item) => item.id === change.assignmentId
      )!;
      return `${assignment.staffName}接${assignment.flightNo}/${assignment.position}`;
    })
    .join(" → ");
  const originalPrimary = originalById.get(primary.id)!;
  const reliefAssignment = changedAssignments.find(
    (assignment) => assignment.staffId === originalPrimary.staffId
  );
  const message =
    fatigueRelief && reliefAssignment
      ? `${originalPrimary.staffName}已连续${runs === 1 ? "一" : "两"}个工作班承担${originalPrimary.flightNo}/${originalPrimary.position}，无法彻底退出晚班时，本班通过${participants}人整体重排换到${reliefAssignment.flightNo}/${reliefAssignment.position}的${reliefAssignment.fatiguePoints}点普通岗位；跨工作日恢复和次班截止仅对这次明确降疲劳改善让步，其余安全约束与岗位完整性验证通过。`
      : `${originalPrimary.staffName}已连续${runs === 1 ? "一" : "两"}个工作班承担${originalPrimary.flightNo}/${originalPrimary.position}，本班已通过${participants}人整体重排解除：${route}；岗位完整性及全部安全约束验证通过。`;
  const recoveryFallbackMessage = protectedReplacementFallback
    ? `跨工作日恢复保护软约束已让步：${primary.staffName}属于上一工作班末班重点岗位人员；其他不移动受保护人员的安全方案均已穷尽，本班允许其接替${primary.flightNo}/${primary.position}，请复核现场恢复情况。`
    : undefined;
  changedAssignments.forEach((assignment) => {
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("position-rotation", "selected", message),
      ...(recoveryFallbackMessage
        ? [
            schedulingDecision(
              "late-shift-recovery",
              "fallback",
              recoveryFallbackMessage
            ),
          ]
        : []),
    ]);
  });
  return recoveryFallbackMessage;
}

function unresolvedMessage(
  primary: Assignment,
  runs: number,
  kind: RotationKind,
  attemptedReasons: readonly string[]
): string {
  const reason =
    [...new Set(attemptedReasons)].slice(0, 3).join("；") ||
    "没有满足全部安全约束的整体重排方案";
  if (kind === "priority" && runs === 1)
    return `重点岗位连续轮岗未落实：${primary.staffName}上一工作班已承担${primary.flightNo}/${primary.position}，本班再次承担；${reason}；为保证岗位完整性，本班异常保留。`;
  if (kind === "high-fatigue" && runs === 1)
    return `高负荷普通岗位连续轮岗未落实：${primary.staffName}上一工作班已承担${primary.flightNo}/${primary.position}，本班再次承担；${reason}；为保证岗位完整性，本班异常保留。`;
  return `连续轮岗未落实：${primary.staffName}已连续两个工作班承担${primary.flightNo}/${primary.position}；${reason}；为保证岗位完整性，本班异常保留该人员，形成第三次连续安排。`;
}

export async function reviewConsecutivePositionRotation(
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
  const ke166Review = await reviewKe166GroupRotation(
    solver,
    state,
    assignments,
    date,
    lockedAssignmentIds,
    facts
  );
  const reviewed = new Set(ke166Review.reviewedAssignmentIds);
  const warnings: string[] = [...ke166Review.warnings];
  const primaryAssignments = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .map((assignment) => ({
      assignment,
      kind: rotationKind(state, assignment),
      runs: consecutivePositionAssignments(
        state,
        assignment.staffId!,
        assignment.flightNo,
        assignment.position,
        date,
        frequencyFacts
      ),
    }))
    .filter((item) =>
      item.kind === "ordinary" ? item.runs >= 2 : item.runs > 0
    )
    .sort(
      (left, right) =>
        rotationKindOrder(left.kind) - rotationKindOrder(right.kind) ||
        right.runs - left.runs ||
        right.assignment.fatiguePoints - left.assignment.fatiguePoints ||
        left.assignment.flightNo.localeCompare(right.assignment.flightNo) ||
        left.assignment.position.localeCompare(right.assignment.position)
    );

  for (const { assignment: primary, runs, kind } of primaryAssignments) {
    if (reviewed.has(primary.id)) continue;
    const compareStaff = targetStaffOrder(
      state,
      assignments,
      primary,
      date,
      facts,
      frequencyFacts
    );
    const availableAssignments = rotationCandidateAssignments(
      assignments,
      primary,
      state,
      lockedAssignmentIds
    )
      .filter((candidate) => !reviewed.has(candidate.id))
      .filter((candidate) => {
        const candidateKind = rotationKind(state, candidate);
        if (kind === "priority") return true;
        if (kind === "high-fatigue") return candidateKind !== "priority";
        return candidateKind === "ordinary";
      });
    const search = await findConsecutiveRotationPlan({
      solver,
      state,
      assignments,
      primary,
      availableAssignments,
      date,
      compareStaff,
      facts,
      frequencyFacts,
    });
    if (search.plan) {
      const fallback = applyRotationPlan(
        state,
        assignments,
        primary,
        search.plan.changes,
        runs,
        search.plan.fatigueRelief,
        search.plan.protectedReplacementFallback
      );
      search.plan.changes.forEach((change) =>
        reviewed.add(change.assignmentId)
      );
      if (fallback) warnings.push(fallback);
      continue;
    }
    reviewed.add(primary.id);
    const message = unresolvedMessage(
      primary,
      runs,
      kind,
      search.attemptedReasons
    );
    replaceAssignmentDecisions(primary, "position-rotation", [
      schedulingDecision("position-rotation", "fallback", message),
    ]);
    warnings.push(message);
  }
  return warnings;
}
