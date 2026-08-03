import type { AppState, Assignment } from "../../model";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "../assignments/assignment-evidence";
import { isPriorityRotationPosition } from "./position-rotation-policy";
import { consecutivePositionAssignments } from "../statistics/schedule-frequency";
import { assignmentRule } from "../flights/schedule-position-rules";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import { isKe166MobileSupervisor } from "../flights/schedule-tasks";
import {
  isRotationLocked,
  type RotationStaffChange,
} from "./rotation-review-safety";
import { optimizeReassignment } from "../solver/reassignment-optimizer";
import type { SolverPort } from "../solver/solver-port";
import { intervalsOverlap } from "../shared/time";
import { assignmentWarningMessage } from "./schedule-warning-message";

interface Ke166RotationReviewResult {
  warnings: string[];
  reviewedAssignmentIds: string[];
}

interface Ke166RotationRole {
  id: string;
  assignments: Assignment[];
  staffId: string;
  staffName: string;
  mobileSupervisorGroup: boolean;
  boundCounterGroup: boolean;
}

function hasSelectedDutyLock(assignment: Assignment): boolean {
  return (
    assignment.decisionTrace?.some(
      (decision) =>
        decision.ruleId === "duty-position" && decision.outcome === "selected"
    ) ?? false
  );
}

function configuredForAssignment(
  state: AppState,
  assignment: Assignment,
  staffId: string
): boolean {
  const rule = assignmentRule(state, assignment);
  const person = state.staff.find((item) => item.id === staffId);
  return Boolean(
    rule &&
    person?.status === "正常" &&
    person.staffType === "常规" &&
    rule.qualifiedStaffIds.includes(staffId)
  );
}

function previousRuns(
  state: AppState,
  assignment: Assignment,
  staffId: string,
  date: string,
  facts?: ScheduleRunFacts
): number {
  return consecutivePositionAssignments(
    state,
    staffId,
    assignment.flightNo,
    assignment.position,
    date,
    facts?.scheduleFrequency
  );
}

function applyRotationPlan(
  state: AppState,
  assignments: Assignment[],
  primaryRole: Ke166RotationRole,
  repeatedAssignment: Assignment,
  changes: readonly RotationStaffChange[],
  mobileAssignmentIds: ReadonlySet<string>
): void {
  const originalById = new Map(
    assignments.map((assignment) => [
      assignment.id,
      { staffId: assignment.staffId!, staffName: assignment.staffName },
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
  const participants = new Set(
    changes.flatMap((change) => [
      originalById.get(change.assignmentId)!.staffId,
      change.staffId,
    ])
  ).size;
  const message = `${primaryRole.staffName}上一工作班已承担${repeatedAssignment.flightNo}/${repeatedAssignment.position}，本班已通过${participants}人整体安全重排解除连续岗位；机动督导关系、岗位完整性及全部安全约束验证通过。`;
  changedAssignments.forEach((assignment) => {
    rebuildAutomaticAssignmentEvidence(
      assignment,
      mobileAssignmentIds.has(assignment.id)
        ? [
            schedulingDecision(
              "ke166-supervisor",
              "selected",
              `${assignment.staffName}已安排为KE166机动督导组人员`
            ),
            schedulingDecision("position-rotation", "selected", message),
          ]
        : [schedulingDecision("position-rotation", "selected", message)]
    );
  });
}

function unresolvedMessage(
  primaryRole: Ke166RotationRole,
  repeatedAssignment: Assignment,
  runs: number,
  reasons: readonly string[]
): string {
  return assignmentWarningMessage({
    staffName: primaryRole.staffName,
    fact: `已连续${runs}次承担${repeatedAssignment.flightNo}/${repeatedAssignment.position}`,
    reasons,
    decision: primaryRole.boundCounterGroup
      ? "机动督导和兼任柜台完整性优先"
      : "岗位完整性优先",
    result: `保留原安排，当前连续第${runs + 1}次`,
  });
}

export async function reviewKe166GroupRotation(
  solver: SolverPort,
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): Promise<Ke166RotationReviewResult> {
  const warnings: string[] = [];
  const reviewedAssignmentIds = new Set<string>();
  const supervisors = assignments.filter((assignment) => {
    const flight = state.flights.find(
      (item) => item.id === assignment.flightId
    );
    const rule = assignmentRule(state, assignment);
    return Boolean(
      flight &&
      rule &&
      isKe166MobileSupervisor(flight, rule) &&
      assignment.status === "assigned" &&
      assignment.staffId
    );
  });

  for (const supervisor of supervisors) {
    const linked = assignments.filter(
      (assignment) => assignment.supervisorSourceAssignmentId === supervisor.id
    );
    const group = [supervisor, ...linked];
    const groupIds = new Set(group.map((assignment) => assignment.id));
    const groupRole: Ke166RotationRole = {
      id: `ke166-group:${supervisor.id}`,
      assignments: group,
      staffId: supervisor.staffId!,
      staffName: supervisor.staffName,
      mobileSupervisorGroup: true,
      boundCounterGroup: linked.length > 0,
    };
    const ordinaryRoles: Ke166RotationRole[] = assignments
      .filter(
        (assignment) =>
          !groupIds.has(assignment.id) &&
          !isRotationLocked(state, assignment, lockedAssignmentIds) &&
          (assignment.flightId === supervisor.flightId ||
            intervalsOverlap(
              assignment.startTime,
              assignment.endTime,
              supervisor.startTime,
              supervisor.endTime
            ))
      )
      .map((assignment) => ({
        id: `assignment:${assignment.id}`,
        assignments: [assignment],
        staffId: assignment.staffId!,
        staffName: assignment.staffName,
        mobileSupervisorGroup: false,
        boundCounterGroup: false,
      }));
    const roles = [groupRole, ...ordinaryRoles];
    const roleByAssignmentId = new Map(
      roles.flatMap((role) =>
        role.assignments.map((assignment) => [assignment.id, role] as const)
      )
    );
    const repeatedRoles = roles
      .map((role) => {
        const repeatedAssignments = role.assignments.filter((assignment) => {
          const rule = assignmentRule(state, assignment);
          return (
            previousRuns(state, assignment, role.staffId, date, facts) > 0 &&
            (role.mobileSupervisorGroup ||
              Boolean(rule && isPriorityRotationPosition(rule)))
          );
        });
        return {
          role,
          repeatedAssignment: repeatedAssignments.sort(
            (left, right) => right.fatiguePoints - left.fatiguePoints
          )[0],
          runs: Math.max(
            0,
            ...repeatedAssignments.map((assignment) =>
              previousRuns(state, assignment, role.staffId, date, facts)
            )
          ),
        };
      })
      .filter((item) => Boolean(item.repeatedAssignment))
      .sort(
        (left, right) =>
          right.runs - left.runs ||
          right.repeatedAssignment!.fatiguePoints -
            left.repeatedAssignment!.fatiguePoints ||
          left.role.id.localeCompare(right.role.id)
      );

    for (const {
      role: primaryRole,
      repeatedAssignment,
      runs,
    } of repeatedRoles) {
      if (
        !repeatedAssignment ||
        primaryRole.assignments.some((assignment) =>
          reviewedAssignmentIds.has(assignment.id)
        )
      )
        continue;
      let attemptedReasons: string[] = [];
      let changes: readonly RotationStaffChange[] | null = null;
      if (primaryRole.assignments.some(hasSelectedDutyLock)) {
        attemptedReasons = ["机动督导岗位或兼任组包含值班锁定岗位"];
      } else {
        const availableRoles = roles.filter((role) =>
          role.assignments.every(
            (assignment) => !reviewedAssignmentIds.has(assignment.id)
          )
        );
        const beforeRuns = previousRuns(
          state,
          repeatedAssignment,
          primaryRole.staffId,
          date,
          facts
        );
        const result = await optimizeReassignment({
          solver,
          state,
          assignments,
          primary: repeatedAssignment,
          movableAssignments: availableRoles
            .flatMap((role) => role.assignments)
            .filter((assignment) => assignment.id !== repeatedAssignment.id),
          date,
          review: "consecutive",
          facts,
          permittedConcurrentAssignmentIds: groupIds,
          coupledAssignmentGroups:
            group.length > 1 ? [group.map((assignment) => assignment.id)] : [],
          primaryCandidateAllowed: (person) =>
            primaryRole.assignments.every((assignment) =>
              configuredForAssignment(state, assignment, person.id)
            ) &&
            previousRuns(state, repeatedAssignment, person.id, date, facts) <
              beforeRuns,
          primaryCandidateRejectionReason: (person) =>
            primaryRole.boundCounterGroup &&
            configuredForAssignment(state, repeatedAssignment, person.id) &&
            !primaryRole.assignments.every((assignment) =>
              configuredForAssignment(state, assignment, person.id)
            )
              ? "候选人不具备机动督导或兼任柜台的完整资质"
              : null,
          maxParticipants: 5,
          validateChanges: (proposed) => {
            const incoming = new Map(
              proposed.map((change) => [change.assignmentId, change.staffId])
            );
            for (const role of availableRoles.filter(
              (item) => item.mobileSupervisorGroup
            )) {
              const staffIds = new Set(
                role.assignments.map(
                  (assignment) =>
                    incoming.get(assignment.id) ?? assignment.staffId!
                )
              );
              if (staffIds.size !== 1)
                return ["机动督导与兼任柜台必须保持同一人员"];
              const staffId = [...staffIds][0]!;
              if (
                !role.assignments.every((assignment) =>
                  configuredForAssignment(state, assignment, staffId)
                )
              )
                return ["候选人不具备机动督导或兼任柜台的完整资质"];
            }
            return [];
          },
        });
        changes = result.changes;
        attemptedReasons = result.attemptedReasons;
      }
      if (changes) {
        applyRotationPlan(
          state,
          assignments,
          primaryRole,
          repeatedAssignment,
          changes,
          groupIds
        );
        changes.forEach((change) => {
          const role = roleByAssignmentId.get(change.assignmentId);
          role?.assignments.forEach((assignment) =>
            reviewedAssignmentIds.add(assignment.id)
          );
        });
        continue;
      }
      const message = unresolvedMessage(
        primaryRole,
        repeatedAssignment,
        runs,
        attemptedReasons
      );
      primaryRole.assignments.forEach((assignment) => {
        replaceAssignmentDecisions(assignment, "position-rotation", [
          schedulingDecision("position-rotation", "fallback", message),
        ]);
        reviewedAssignmentIds.add(assignment.id);
      });
      warnings.push(message);
    }
  }

  return { warnings, reviewedAssignmentIds: [...reviewedAssignmentIds] };
}
