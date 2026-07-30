import type { AppState, Assignment } from "../model";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "./assignment-evidence";
import { consecutivePositionAssignments } from "./schedule-frequency";
import { assignmentRule } from "./schedule-position-rules";
import {
  isRotationLocked,
  reassignmentSafetyReasons,
  type RotationStaffChange,
} from "./rotation-review-safety";
import { isKe166MobileSupervisor } from "./schedule-tasks";
import { schedulingDecision } from "../schedule-rule-contract";
import { isPriorityRotationPosition } from "./position-rotation-policy";
import type { ScheduleRunFacts } from "./schedule-run-facts";
import { intervalsOverlap } from "./time";
import {
  findShortestRotationCycle,
  type RotationRole,
} from "./rotation-cycle-search";

interface Ke166RotationReviewResult {
  warnings: string[];
  reviewedAssignmentIds: string[];
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

interface Ke166RotationRole extends RotationRole {
  mobileSupervisorGroup: boolean;
  boundCounterGroup: boolean;
}

function applyRoleCycle(
  cycle: Ke166RotationRole[],
  primary: Ke166RotationRole
): void {
  const original = cycle.map((role) => ({
    staffId: role.staffId,
    staffName: role.staffName,
    label: role.mobileSupervisorGroup
      ? `${role.assignments[0]!.flightNo}/${role.boundCounterGroup ? "机动督导兼任组" : "机动督导"}`
      : `${role.assignments[0]!.flightNo}/${role.assignments[0]!.position}`,
  }));
  const route = original
    .map((item) => `${item.staffName}:${item.label}`)
    .join(" → ");
  const message = `${primary.staffName}的连续岗位已通过${cycle.length}个逻辑岗位闭环轮换解除：${route}；岗位资质、岗位关系、岗位完整性及全部安全约束验证通过。`;
  cycle.forEach((role, index) => {
    const incoming = original[(index + 1) % original.length]!;
    role.assignments.forEach((assignment) => {
      assignment.staffId = incoming.staffId;
      assignment.staffName = incoming.staffName;
      rebuildAutomaticAssignmentEvidence(
        assignment,
        role.mobileSupervisorGroup
          ? [
              schedulingDecision(
                "ke166-supervisor",
                "selected",
                `${incoming.staffName}已安排为KE166机动督导${role.boundCounterGroup ? "兼任人员" : "独立人员"}`
              ),
              schedulingDecision("position-rotation", "selected", message),
            ]
          : [schedulingDecision("position-rotation", "selected", message)]
      );
    });
  });
}

function roleChanges(cycle: Ke166RotationRole[]): RotationStaffChange[] {
  return cycle.flatMap((role, index) => {
    const incoming = cycle[(index + 1) % cycle.length]!;
    return role.assignments.map((assignment) => ({
      assignmentId: assignment.id,
      staffId: incoming.staffId,
    }));
  });
}

function roleEligibilityReason(
  state: AppState,
  role: Ke166RotationRole,
  staffId: string
): string | null {
  if (
    role.assignments.every((assignment) =>
      configuredForAssignment(state, assignment, staffId)
    )
  )
    return null;
  return role.mobileSupervisorGroup
    ? role.boundCounterGroup
      ? "候选人不具备机动督导或兼任柜台的完整资质"
      : "候选人不具备机动督导资质"
    : "没有具备双向岗位资质的人员";
}

export function reviewKe166GroupRotation(
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): Ke166RotationReviewResult {
  const warnings: string[] = [];
  const reviewedAssignmentIds: string[] = [];
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
    const groupLockedByDuty = group.some(hasSelectedDutyLock);
    const groupRole: Ke166RotationRole = {
      id: `ke166-group:${supervisor.id}`,
      assignments: group,
      staffId: supervisor.staffId!,
      staffName: supervisor.staffName,
      mobileSupervisorGroup: true,
      boundCounterGroup: linked.length > 0,
    };
    const groupIds = new Set(group.map((assignment) => assignment.id));
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
    const resolvedRoleIds = new Set<string>();

    for (const { role: primaryRole, repeatedAssignment } of repeatedRoles) {
      if (!repeatedAssignment || resolvedRoleIds.has(primaryRole.id)) continue;
      const availableRoles = roles.filter(
        (role) => !resolvedRoleIds.has(role.id)
      );
      const search = findShortestRotationCycle({
        primary: primaryRole,
        roles: availableRoles,
        eligibilityReason: (target, incomingStaffId) => {
          const typedTarget = target as Ke166RotationRole;
          return roleEligibilityReason(state, typedTarget, incomingStaffId);
        },
        safetyReasons: (cycle) =>
          reassignmentSafetyReasons({
            kind: "plan",
            state,
            assignments,
            changes: roleChanges(cycle as Ke166RotationRole[]),
            primaryAssignmentId: repeatedAssignment.id,
            date,
            review: "consecutive",
            facts,
            permittedConcurrentAssignmentIds: groupIds,
          }),
      });
      const rotationSearch = groupLockedByDuty
        ? {
            cycle: null,
            attemptedReasons: ["机动督导岗位或兼任组包含值班锁定岗位"],
          }
        : search;
      const cycle = rotationSearch.cycle as Ke166RotationRole[] | null;
      if (cycle) {
        applyRoleCycle(cycle, primaryRole);
        cycle.forEach((role) => {
          resolvedRoleIds.add(role.id);
          reviewedAssignmentIds.push(
            ...role.assignments.map((assignment) => assignment.id)
          );
        });
        continue;
      }

      const reason =
        [...new Set(rotationSearch.attemptedReasons)].slice(0, 3).join("；") ||
        "没有可形成安全闭环的机动督导与常规岗位人员";
      const message = primaryRole.mobileSupervisorGroup
        ? `KE166机动督导连续轮岗未落实：${primaryRole.staffName}上一工作班已承担${repeatedAssignment.flightNo}/${repeatedAssignment.position}，本班再次承担；${reason}；为保证${primaryRole.boundCounterGroup ? "机动督导及兼任柜台" : "机动督导岗位"}完整，本班异常保留。`
        : `重点岗位连续轮岗未落实：${primaryRole.staffName}上一工作班已承担${repeatedAssignment.flightNo}/${repeatedAssignment.position}，本班再次承担；${reason}；为保证岗位完整性，本班异常保留。`;
      primaryRole.assignments.forEach((assignment) => {
        replaceAssignmentDecisions(assignment, "position-rotation", [
          schedulingDecision("position-rotation", "fallback", message),
        ]);
      });
      warnings.push(message);
      resolvedRoleIds.add(primaryRole.id);
      reviewedAssignmentIds.push(
        ...primaryRole.assignments.map((assignment) => assignment.id)
      );
    }
  }

  return { warnings, reviewedAssignmentIds };
}
