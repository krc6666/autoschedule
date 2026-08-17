import type { Assignment } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "../assignments/assignment-evidence";
import {
  isNextWorkdayCutoffConflict,
  nextWorkdayCutoffProtection,
} from "./cross-day-recovery";
import {
  isRotationLocked,
  rotationCandidateAssignments,
  type RotationStaffChange,
} from "./rotation-review-safety";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import { optimizeReassignment } from "../solver/reassignment-optimizer";
import type { SolverPort } from "../solver/solver-port";
import { timeToMinutes } from "../shared/time";
import { assignmentWarningMessage } from "./schedule-warning-message";

function operationalEnd(
  assignment: Pick<Assignment, "startTime" | "endTime">
): number {
  const start = timeToMinutes(assignment.startTime);
  let end = timeToMinutes(assignment.endTime);
  if (end <= start) end += 24 * 60;
  return end;
}

function latestAssignedEnd(
  assignments: readonly Assignment[],
  staffId: string
): number {
  const ends = assignments
    .filter(
      (assignment) =>
        assignment.status === "assigned" && assignment.staffId === staffId
    )
    .map(operationalEnd);
  return ends.length ? Math.max(...ends) : -1;
}

function cutoffProtectionOrder(
  state: ScheduleGenerationFacts,
  assignments: readonly Assignment[],
  date: string,
  facts?: ScheduleRunFacts
): string[] {
  const byStaff = new Map<
    string,
    ReturnType<typeof nextWorkdayCutoffProtection>
  >();
  for (const assignment of assignments) {
    if (!assignment.staffId) continue;
    const protection = nextWorkdayCutoffProtection(
      state,
      assignment.staffId,
      date,
      facts?.crossDayRecovery
    );
    if (protection) byStaff.set(assignment.staffId, protection);
  }
  return [...byStaff.entries()]
    .sort(
      ([leftId, left], [rightId, right]) =>
        left!.cutoffMinutes - right!.cutoffMinutes ||
        right!.previousEndMinutes - left!.previousEndMinutes ||
        leftId.localeCompare(rightId)
    )
    .map(([staffId]) => staffId);
}

function protectedEndVector(
  assignments: readonly Assignment[],
  staffOrder: readonly string[]
): number[] {
  return staffOrder.map((staffId) => latestAssignedEnd(assignments, staffId));
}

function compareVectors(
  left: readonly number[],
  right: readonly number[]
): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

function plannedAssignments(
  state: ScheduleGenerationFacts,
  assignments: readonly Assignment[],
  changes: readonly RotationStaffChange[]
): Assignment[] {
  const staffById = new Map(state.staff.map((person) => [person.id, person]));
  const incomingByAssignmentId = new Map(
    changes.map((change) => [change.assignmentId, change.staffId])
  );
  return assignments.map((assignment) => {
    const staffId = incomingByAssignmentId.get(assignment.id);
    if (!staffId) return { ...assignment };
    return {
      ...assignment,
      staffId,
      staffName: staffById.get(staffId)?.name ?? assignment.staffName,
    };
  });
}

function applyPlan(
  state: ScheduleGenerationFacts,
  assignments: Assignment[],
  changes: readonly RotationStaffChange[],
  protectedName: string
): void {
  const people = new Map(state.staff.map((person) => [person.id, person]));
  const changed: Assignment[] = [];
  for (const change of changes) {
    const assignment = assignments.find(
      (item) => item.id === change.assignmentId
    );
    const person = people.get(change.staffId);
    if (!assignment || !person) continue;
    assignment.staffId = person.id;
    assignment.staffName = person.name;
    changed.push(assignment);
  }
  const participants =
    new Set(changes.flatMap((change) => [change.staffId])).size + 1;
  const message = `${protectedName}已通过${participants}人整体安全重排提前结束本班工作，末班重点岗位次班截止保护已落实。`;
  changed.forEach((assignment) => {
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("late-shift-cutoff", "selected", message),
    ]);
  });
}

function fallbackMessage(
  primary: Assignment,
  reasons: readonly string[]
): string {
  return assignmentWarningMessage({
    staffName: primary.staffName,
    fact: `上一班较晚结束，本班仍承担${primary.flightNo}/${primary.position}`,
    reasons,
    result: "保留原安排，未能提前下班",
  });
}

export async function reviewLateShiftCutoff(
  solver: SolverPort,
  state: ScheduleGenerationFacts,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): Promise<string[]> {
  if (!state.settings.lateShiftRecoveryEnabled) return [];
  const warnings: string[] = [];
  const reviewed = new Set<string>();
  const protectedStaffOrder = cutoffProtectionOrder(
    state,
    assignments,
    date,
    facts
  );
  const protectedEndBefore = protectedEndVector(
    assignments,
    protectedStaffOrder
  );
  const protectedAssignments = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .filter((assignment) =>
      isNextWorkdayCutoffConflict(
        state,
        assignment.staffId!,
        assignment.startTime,
        date,
        facts?.crossDayRecovery
      )
    )
    .sort((left, right) => {
      const leftProtection = nextWorkdayCutoffProtection(
        state,
        left.staffId!,
        date,
        facts?.crossDayRecovery
      )!;
      const rightProtection = nextWorkdayCutoffProtection(
        state,
        right.staffId!,
        date,
        facts?.crossDayRecovery
      )!;
      return (
        leftProtection.cutoffMinutes - rightProtection.cutoffMinutes ||
        rightProtection.previousEndMinutes -
          leftProtection.previousEndMinutes ||
        operationalEnd(right) - operationalEnd(left)
      );
    });

  for (const primary of protectedAssignments) {
    if (reviewed.has(primary.id) || !primary.staffId) continue;
    if (
      !isNextWorkdayCutoffConflict(
        state,
        primary.staffId,
        primary.startTime,
        date,
        facts?.crossDayRecovery
      )
    )
      continue;
    const protectedStaffId = primary.staffId;
    const protectedName = primary.staffName;
    const originalLatestEnd = latestAssignedEnd(assignments, protectedStaffId);
    const result = await optimizeReassignment({
      solver,
      state,
      assignments,
      primary,
      movableAssignments: [
        ...new Map(
          protectedAssignments
            .flatMap((protectedAssignment) => [
              protectedAssignment,
              ...rotationCandidateAssignments(
                assignments,
                protectedAssignment,
                state,
                lockedAssignmentIds
              ),
            ])
            .filter((assignment) => !reviewed.has(assignment.id))
            .map((assignment) => [assignment.id, assignment] as const)
        ).values(),
      ],
      date,
      review: "recovery",
      facts,
      primaryCandidateAllowed: (person) =>
        !isNextWorkdayCutoffConflict(
          state,
          person.id,
          primary.startTime,
          date,
          facts?.crossDayRecovery
        ),
      validateChanges: (changes) =>
        compareVectors(
          protectedEndVector(
            plannedAssignments(state, assignments, changes),
            protectedStaffOrder
          ),
          protectedEndBefore
        ) < 0 &&
        latestAssignedEnd(
          plannedAssignments(state, assignments, changes),
          protectedStaffId
        ) < originalLatestEnd
          ? []
          : ["整体重排后受保护人员的最终下班时间没有提前"],
      leadingObjectives: protectedStaffOrder.map((staffId) => ({
        id: `late-shift-cutoff:${staffId}:final-end`,
        direction: "minimize" as const,
        coefficient: ({ assignment, person }) =>
          person.id === staffId ? operationalEnd(assignment) : 0,
      })),
      allowWorkloadBalanceRegression: true,
      allowCutoffProtectionRegression: true,
      maxParticipants: 3,
    });
    if (result.changes) {
      applyPlan(state, assignments, result.changes, protectedName);
      result.changes.forEach((change) => reviewed.add(change.assignmentId));
      continue;
    }
    const message = fallbackMessage(primary, result.attemptedReasons);
    replaceAssignmentDecisions(primary, "late-shift-cutoff", [
      schedulingDecision("late-shift-cutoff", "fallback", message),
    ]);
    warnings.push(message);
    reviewed.add(primary.id);
  }
  return warnings;
}
