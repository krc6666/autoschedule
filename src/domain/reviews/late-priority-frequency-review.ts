import type { AppState, Assignment } from "../../model";
import { replaceAssignmentDecisions } from "../assignments/assignment-evidence";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import { optimizeReassignment } from "../solver/reassignment-optimizer";
import type { SolverPort } from "../solver/solver-port";
import { createScheduleFrequencyFacts } from "../statistics/schedule-frequency";
import type { LatePriorityFrequencyProfile } from "../statistics/late-priority-frequency";
import {
  assessLatePriorityAggregateBalance,
  assessLatePriorityFrequencyBalance,
  compareProjectedLatePriorityAggregateCandidates,
  compareProjectedLatePriorityCandidates,
  latePriorityFrequencyRegressionReasons,
} from "./late-priority-frequency-balance";
import {
  isRotationLocked,
  rotationCandidateAssignments,
  type RotationStaffChange,
} from "./rotation-review-safety";
import { assignmentWarningMessage } from "./schedule-warning-message";
import {
  latePriorityFrequencyKinds,
  latePriorityKindLabel,
  latePriorityMonthlyLabel,
  LATE_PRIORITY_ALLOWED_DIFFERENCE,
  LATE_PRIORITY_FREQUENCY_ORDER,
  type LatePriorityFrequencyKind,
} from "./late-priority-policy";
import { assignmentRule } from "../flights/schedule-position-rules";

function applyChanges(
  state: AppState,
  assignments: Assignment[],
  changes: readonly RotationStaffChange[]
): Assignment[] {
  const changed: Assignment[] = [];
  for (const change of changes) {
    const assignment = assignments.find(
      (item) => item.id === change.assignmentId
    );
    const person = state.staff.find((item) => item.id === change.staffId);
    if (!assignment || !person) continue;
    assignment.staffId = person.id;
    assignment.staffName = person.name;
    changed.push(assignment);
  }
  return changed;
}

function selectedMessage(
  primary: Assignment,
  originalStaffName: string,
  originalCount: number,
  replacementCount: number,
  countLabel: string
): string {
  return `${originalStaffName}${countLabel}已承担${originalCount}次，本班${primary.flightNo}/${primary.position}改由${primary.staffName}承担（此前${replacementCount}次）；岗位完整性和安全要求保持。`;
}

function monthlyTargetCount(
  profile: LatePriorityFrequencyProfile,
  kind: LatePriorityFrequencyKind
): number {
  return profile.counts[kind].currentMonthCount;
}

function lowestFrequencyReason(kind: LatePriorityFrequencyKind): string {
  return `没有其他${latePriorityKindLabel(kind)}次数更低的合格人员`;
}

function warningFact(
  assignment: Assignment,
  kind: LatePriorityFrequencyKind,
  periods: readonly {
    label: string;
    assignedCount: number;
    difference: number;
  }[]
): string {
  const relevant = periods
    .filter(
      (period) => period.difference > LATE_PRIORITY_ALLOWED_DIFFERENCE[kind]
    )
    .map(
      (period) =>
        `${period.label}承担${period.assignedCount}次、最高与最低相差${period.difference}次`
    )
    .join("；");
  return `本班承担${assignment.flightNo}/${assignment.position}，${relevant}`;
}

export async function reviewLatePriorityFrequency(
  solver: SolverPort,
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): Promise<string[]> {
  if (!state.settings.positionRotationEnabled) return [];
  assignments.forEach((assignment) => {
    replaceAssignmentDecisions(
      assignment,
      "late-priority-aggregate-rotation",
      []
    );
    replaceAssignmentDecisions(assignment, "late-priority-frequency", []);
  });
  const frequencyFacts =
    facts?.scheduleFrequency ?? createScheduleFrequencyFacts(state, date);
  const warnings: string[] = [];
  const aggregateWarningAssignmentIds = new Set<string>();
  const aggregateAttemptedReasons = new Map<string, readonly string[]>();
  const aggregateTargets = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .map((assignment) => ({
      assignment,
      assessment: assessLatePriorityAggregateBalance(
        state,
        assignment,
        assignments,
        date,
        frequencyFacts
      ),
    }))
    .filter((item) => item.assessment?.needsAttention)
    .sort(
      (left, right) =>
        Number(right.assessment!.previousWorkdayAssigned) -
          Number(left.assessment!.previousWorkdayAssigned) ||
        right.assessment!.assignedProfile.totalCurrentMonthCount -
          left.assessment!.assignedProfile.totalCurrentMonthCount ||
        left.assignment.startTime.localeCompare(right.assignment.startTime) ||
        left.assignment.id.localeCompare(right.assignment.id)
    );

  for (const target of aggregateTargets) {
    const primary = assignments.find(
      (assignment) => assignment.id === target.assignment.id
    );
    if (!primary?.staffId) continue;
    const assessment = assessLatePriorityAggregateBalance(
      state,
      primary,
      assignments,
      date,
      frequencyFacts
    );
    if (!assessment?.needsAttention) continue;
    const candidateIds = new Set(
      [...assessment.preferredStaffIds].filter(
        (staffId) => staffId !== primary.staffId
      )
    );
    if (!candidateIds.size) {
      aggregateAttemptedReasons.set(primary.id, [
        "其他合格人员的上一班或合计负担没有更轻",
      ]);
      continue;
    }
    const originalName = primary.staffName;
    const originalPrevious = assessment.previousWorkdayAssigned;
    const originalTotal = assessment.assignedProfile.totalCurrentMonthCount;
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
      ),
      date,
      review: "late-frequency",
      facts,
      frequencyFacts,
      primaryCandidateAllowed: (person) => candidateIds.has(person.id),
      primaryCandidateRejectionReason: () =>
        "该人员上一班已承担末班重点岗位或四类合计负担更高",
      compareCandidates: (assignment, left, right) =>
        compareProjectedLatePriorityAggregateCandidates(
          state,
          assignments,
          assignment,
          left,
          right,
          date,
          frequencyFacts
        ),
      validateChanges: (changes) => {
        const personById = new Map(
          state.staff.map((person) => [person.id, person])
        );
        const planned = assignments.map((assignment) => {
          const change = changes.find(
            (item) => item.assignmentId === assignment.id
          );
          const person = change ? personById.get(change.staffId) : undefined;
          return person
            ? { ...assignment, staffId: person.id, staffName: person.name }
            : assignment;
        });
        return latePriorityFrequencyRegressionReasons(
          state,
          assignments,
          planned,
          date,
          frequencyFacts
        );
      },
      maxParticipants: 5,
    });
    if (!result.changes) {
      aggregateAttemptedReasons.set(primary.id, result.attemptedReasons);
      continue;
    }
    const changed = applyChanges(state, assignments, result.changes);
    const message = originalPrevious
      ? `${originalName}上一工作班已承担末班重点岗位，本班${primary.flightNo}/${primary.position}已改由${primary.staffName}承担，避免连续重活。`
      : `${originalName}本月四类末班重点岗位合计已承担${originalTotal}次，本班${primary.flightNo}/${primary.position}已改由${primary.staffName}承担，合计负担更均衡。`;
    changed.forEach((assignment) =>
      replaceAssignmentDecisions(
        assignment,
        "late-priority-aggregate-rotation",
        [
          schedulingDecision(
            "late-priority-aggregate-rotation",
            "selected",
            message
          ),
        ]
      )
    );
  }

  for (const assignment of assignments) {
    const assessment = assessLatePriorityAggregateBalance(
      state,
      assignment,
      assignments,
      date,
      frequencyFacts
    );
    if (
      !assessment?.needsAttention ||
      !assessment.previousWorkdayAssigned ||
      !assignment.staffId
    )
      continue;
    const message = assignmentWarningMessage({
      staffName: assignment.staffName,
      fact: `上一工作班已承担末班重点岗位，本班再次承担${assignment.flightNo}/${assignment.position}`,
      reasons: aggregateAttemptedReasons.get(assignment.id) ?? [
        "其他合格人员均不能安全替代",
      ],
      decision: "岗位完整性优先",
      result: "保留原安排，本班形成连续承担",
    });
    replaceAssignmentDecisions(assignment, "late-priority-aggregate-rotation", [
      schedulingDecision(
        "late-priority-aggregate-rotation",
        "fallback",
        message
      ),
    ]);
    warnings.push(message);
    aggregateWarningAssignmentIds.add(assignment.id);
  }

  const attemptedReasons = new Map<string, readonly string[]>();
  const reviewed = new Set<string>();
  const primaryTargets = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .flatMap((assignment) => {
      const rule = assignmentRule(state, assignment);
      return rule
        ? latePriorityFrequencyKinds(rule).map((kind) => ({
            assignment,
            kind,
            assessment: assessLatePriorityFrequencyBalance(
              state,
              assignment,
              assignments,
              date,
              frequencyFacts,
              kind
            ),
          }))
        : [];
    })
    .filter((item) => item.assessment?.needsAttention)
    .sort(
      (left, right) =>
        LATE_PRIORITY_FREQUENCY_ORDER.indexOf(left.kind) -
          LATE_PRIORITY_FREQUENCY_ORDER.indexOf(right.kind) ||
        right.assessment!.maximumDifference -
          left.assessment!.maximumDifference ||
        left.assignment.startTime.localeCompare(right.assignment.startTime) ||
        left.assignment.id.localeCompare(right.assignment.id)
    );

  for (const target of primaryTargets) {
    const primary = assignments.find(
      (assignment) => assignment.id === target.assignment.id
    );
    if (!primary || reviewed.has(primary.id)) continue;
    const assessment = assessLatePriorityFrequencyBalance(
      state,
      primary,
      assignments,
      date,
      frequencyFacts,
      target.kind
    );
    if (!assessment?.needsAttention || !primary.staffId) continue;
    const candidateIds = new Set(
      [...assessment.lowestStaffIds].filter(
        (staffId) => staffId !== primary.staffId
      )
    );
    if (!candidateIds.size) {
      attemptedReasons.set(primary.id, [
        lowestFrequencyReason(assessment.kind),
      ]);
      continue;
    }
    const originalAssignments = assignments.map((assignment) => ({
      ...assignment,
    }));
    const originalName = primary.staffName;
    const originalCount = monthlyTargetCount(
      assessment.assignedProfile,
      assessment.kind
    );
    const countLabel = latePriorityMonthlyLabel(assessment.kind);
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
      review: "late-frequency",
      facts,
      frequencyFacts,
      primaryCandidateAllowed: (person) => candidateIds.has(person.id),
      primaryCandidateRejectionReason: () =>
        assessment.kind === "supervisor"
          ? "该人员不是当前督导次数最低的合格人员"
          : `该人员不是当前${latePriorityKindLabel(assessment.kind)}次数最低的合格人员`,
      compareCandidates: (assignment, left, right) =>
        compareProjectedLatePriorityCandidates(
          state,
          assignments,
          assignment,
          left,
          right,
          date,
          assessment.kind,
          frequencyFacts
        ),
      validateChanges: (changes) => {
        const personById = new Map(
          state.staff.map((person) => [person.id, person])
        );
        const planned = assignments.map((assignment) => {
          const change = changes.find(
            (item) => item.assignmentId === assignment.id
          );
          const person = change ? personById.get(change.staffId) : undefined;
          return person
            ? { ...assignment, staffId: person.id, staffName: person.name }
            : assignment;
        });
        return latePriorityFrequencyRegressionReasons(
          state,
          assignments,
          planned,
          date,
          frequencyFacts
        );
      },
      maxParticipants: 5,
    });
    if (!result.changes) {
      attemptedReasons.set(primary.id, result.attemptedReasons);
      reviewed.add(primary.id);
      continue;
    }
    const changed = applyChanges(state, assignments, result.changes);
    const finalPrimary = assignments.find(
      (assignment) => assignment.id === primary.id
    )!;
    const finalAssessment = assessLatePriorityFrequencyBalance(
      state,
      finalPrimary,
      assignments,
      date,
      frequencyFacts,
      assessment.kind
    );
    if (!finalAssessment) {
      assignments.splice(0, assignments.length, ...originalAssignments);
      attemptedReasons.set(primary.id, ["调整后无法核对末班重点岗位次数"]);
      continue;
    }
    const message = selectedMessage(
      finalPrimary,
      originalName,
      originalCount,
      Math.max(
        0,
        monthlyTargetCount(finalAssessment.assignedProfile, assessment.kind) - 1
      ),
      countLabel
    );
    changed.forEach((assignment) =>
      replaceAssignmentDecisions(assignment, "late-priority-frequency", [
        schedulingDecision("late-priority-frequency", "selected", message),
      ])
    );
    result.changes.forEach((change) => reviewed.add(change.assignmentId));
  }

  for (const assignment of assignments) {
    const rule = assignmentRule(state, assignment);
    const assessment = rule
      ? (LATE_PRIORITY_FREQUENCY_ORDER.flatMap((kind) =>
          latePriorityFrequencyKinds(rule).includes(kind)
            ? [
                assessLatePriorityFrequencyBalance(
                  state,
                  assignment,
                  assignments,
                  date,
                  frequencyFacts,
                  kind
                ),
              ]
            : []
        ).find((item) => item?.needsAttention) ??
        assessLatePriorityFrequencyBalance(
          state,
          assignment,
          assignments,
          date,
          frequencyFacts,
          latePriorityFrequencyKinds(rule)[0]
        ))
      : null;
    if (!assessment) continue;
    if (!assessment.needsAttention) {
      if (
        assignment.staffId &&
        assessment.lowestStaffIds.has(assignment.staffId) &&
        assessment.maximumDifference > 0
      ) {
        const countLabel = latePriorityMonthlyLabel(assessment.kind);
        const message = `${assignment.staffName}本班承担${assignment.flightNo}/${assignment.position}，${countLabel}累计${monthlyTargetCount(assessment.assignedProfile, assessment.kind)}次，属于当前最低频人员；本班按长期轮换安排。`;
        replaceAssignmentDecisions(assignment, "late-priority-frequency", [
          schedulingDecision("late-priority-frequency", "selected", message),
        ]);
      }
      continue;
    }
    if (aggregateWarningAssignmentIds.has(assignment.id)) continue;
    const message = assignmentWarningMessage({
      staffName: assignment.staffName,
      fact: warningFact(assignment, assessment.kind, assessment.periods),
      reasons: attemptedReasons.get(assignment.id) ?? [
        "前序排班安排优先，未能改由最低频人员",
      ],
      decision: "岗位完整性及前序保护优先",
      result: "保留原安排",
    });
    replaceAssignmentDecisions(assignment, "late-priority-frequency", [
      schedulingDecision("late-priority-frequency", "fallback", message),
    ]);
    warnings.push(message);
  }
  return [...new Set(warnings)];
}
