import type { Assignment } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import type {
  AssignmentEligibilityDiagnostic,
  AutomaticAssignmentEligibilityOptions,
} from "../candidates/assignment-eligibility";
import type { AssignmentTask } from "../flights/schedule-tasks";
import type { SolverProblem, SolverResult } from "../solver/solver-port";
import {
  isKe166MobileSupervisor,
  isNumberedRegularPosition,
} from "../flights/schedule-tasks";
import {
  isStrictNextWorkdayRecoveryTarget,
  previousWorkdayLateProtection,
} from "../reviews/cross-day-recovery";
import {
  concurrentOverlapMinutes,
  isConcurrentSupervisor,
} from "../coverage/team-leader-concurrent-plan";
import { assignmentRule } from "../flights/schedule-position-rules";
import { sameAirlinePriorityAssignmentConflict } from "../rules/airline-rotation";

export interface DailyScheduleSafetyOptions {
  state: ScheduleGenerationFacts;
  date: string;
  assignments: readonly Assignment[];
  tasks: readonly AssignmentTask[];
  evaluateEligibility: (
    options: AutomaticAssignmentEligibilityOptions
  ) => AssignmentEligibilityDiagnostic;
  allowFinalizedConcurrency?: boolean;
  preservedAssignments?: readonly Assignment[];
}

function assignmentMatchesTask(
  assignment: Assignment,
  task: AssignmentTask
): boolean {
  return (
    assignment.flightId === task.flight.id &&
    assignment.positionRuleId === task.rule.id
  );
}

export function assertTimeLimitedResultIsEligible(
  problem: SolverProblem,
  result: SolverResult
): void {
  if (
    result.termination !== "time-limited-feasible" &&
    result.termination !== "gap-limited-feasible"
  )
    return;
  const stoppedObjective = result.bestEffort
    ? problem.objectives.find(
        (objective) => objective.id === result.bestEffort!.stoppedAtObjectiveId
      )
    : undefined;
  const completed = new Set(result.bestEffort?.completedObjectiveIds ?? []);
  const requiredCompleted = problem.objectives
    .filter((objective) => objective.optimality !== "best-effort")
    .every((objective) => completed.has(objective.id));
  if (
    !result.bestEffort ||
    stoppedObjective?.optimality !== "best-effort" ||
    !requiredCompleted
  ) {
    throw new Error("当天班表未采用：关键排班规则未全部完成");
  }
}

export function assertDailyScheduleSafety({
  state,
  date,
  assignments,
  tasks,
  evaluateEligibility,
  allowFinalizedConcurrency = false,
  preservedAssignments = [],
}: DailyScheduleSafetyOptions): void {
  const assigned = assignments.filter(
    (assignment) => assignment.status === "assigned" && assignment.staffId
  );
  for (let leftIndex = 0; leftIndex < assigned.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < assigned.length;
      rightIndex += 1
    ) {
      const left = assigned[leftIndex]!;
      const right = assigned[rightIndex]!;
      if (
        left.staffId !== right.staffId ||
        left.flightId === right.flightId ||
        !sameAirlinePriorityAssignmentConflict(
          {
            ...left,
            positionRule: assignmentRule(state, left),
          },
          {
            ...right,
            positionRule: assignmentRule(state, right),
          }
        )
      )
        continue;
      const later =
        left.startTime.localeCompare(right.startTime) <= 0 ? right : left;
      throw new Error(
        `最终安全复核未通过：${left.staffName}已承担同日同航司控制/一号岗位，不得再次承担${later.flightNo}/${later.position}`
      );
    }
  }
  for (const preserved of preservedAssignments) {
    const current = assignments.find(
      (assignment) => assignment.id === preserved.id
    );
    if (
      !current ||
      current.status !== preserved.status ||
      current.staffId !== preserved.staffId ||
      current.flightId !== preserved.flightId ||
      current.positionRuleId !== preserved.positionRuleId
    ) {
      throw new Error("最终安全复核未通过：已锁定岗位在后续排班中发生变化");
    }
  }
  const assignmentsByTask = new Map(
    tasks.map((task) => [
      task.key,
      assignments.filter((assignment) =>
        assignmentMatchesTask(assignment, task)
      ),
    ])
  );

  for (const task of tasks) {
    const matches = assignmentsByTask.get(task.key) ?? [];
    if (matches.length !== 1) {
      throw new Error(
        `最终安全复核未通过：${task.flight.flightNo}/${task.rule.name}必须且只能保留一个排班结果`
      );
    }
    const assignment = matches[0]!;
    if (
      assignment.status === "unfilled" ||
      (assignment.status === "manual" && !assignment.staffId)
    )
      continue;
    if (assignment.status !== "assigned" || !assignment.staffId) {
      throw new Error(
        `最终安全复核未通过：${task.flight.flightNo}/${task.rule.name}没有形成有效自动排班结果`
      );
    }
    const person = state.staff.find((item) => item.id === assignment.staffId);
    if (!person) {
      throw new Error(
        `最终安全复核未通过：${task.flight.flightNo}/${task.rule.name}的人员不存在`
      );
    }
    if (
      state.settings.nextWorkdayRecoveryMode === "forbid" &&
      state.settings.lateShiftRecoveryEnabled &&
      previousWorkdayLateProtection(state, date).protectedStaffIds.has(
        person.id
      ) &&
      isStrictNextWorkdayRecoveryTarget(state, {
        flightNo: task.flight.flightNo,
        position: task.rule.name,
        remark: task.rule.remark,
      })
    ) {
      throw new Error(
        `最终安全复核未通过：${task.flight.flightNo}/${task.rule.name}违反严格跨工作日恢复目标`
      );
    }
    const otherAutomaticAssignments = tasks.flatMap((otherTask) =>
      (assignmentsByTask.get(otherTask.key) ?? []).filter(
        (other) =>
          other.id !== assignment.id &&
          other.status === "assigned" &&
          Boolean(other.staffId) &&
          !(
            allowFinalizedConcurrency &&
            isControlledConcurrentPair(state, tasks, assignment, other)
          )
      )
    );
    const diagnostic = evaluateEligibility({
      state,
      assignments: otherAutomaticAssignments,
      flight: task.flight,
      rule: task.rule,
      person,
      workHours: assignment.workHours,
    });
    if (!diagnostic.eligible) {
      throw new Error(
        `最终安全复核未通过：${task.flight.flightNo}/${task.rule.name}${diagnostic.violations[0]?.message ?? "不满足排班要求"}`
      );
    }
  }
}

function isControlledConcurrentPair(
  state: ScheduleGenerationFacts,
  tasks: readonly AssignmentTask[],
  left: Assignment,
  right: Assignment
): boolean {
  if (!left.staffId || left.staffId !== right.staffId) return false;
  const leftTask = tasks.find((task) => assignmentMatchesTask(left, task));
  const rightTask = tasks.find((task) => assignmentMatchesTask(right, task));
  if (!leftTask || !rightTask) return false;

  const source =
    left.supervisorSourceAssignmentId === right.id
      ? left
      : right.supervisorSourceAssignmentId === left.id
        ? right
        : undefined;
  const supervisor =
    source === left ? right : source === right ? left : undefined;
  const sourceTask =
    source === left ? leftTask : source === right ? rightTask : undefined;
  const supervisorTask =
    supervisor === left
      ? leftTask
      : supervisor === right
        ? rightTask
        : undefined;
  if (
    source &&
    supervisor &&
    source.flightId === supervisor.flightId &&
    sourceTask &&
    supervisorTask &&
    isNumberedRegularPosition(sourceTask.rule) &&
    isKe166MobileSupervisor(supervisorTask.flight, supervisorTask.rule)
  ) {
    return true;
  }

  const person = state.staff.find((item) => item.id === left.staffId);
  const hasConcurrentDecision = [left, right].every((assignment) =>
    assignment.decisionTrace?.some(
      (decision) =>
        decision.ruleId === "team-leader-concurrent-supervision" &&
        decision.outcome === "selected"
    )
  );
  if (
    !person?.teamLeader ||
    !hasConcurrentDecision ||
    leftTask.flight.id === rightTask.flight.id ||
    !isConcurrentSupervisor(leftTask.rule, leftTask.flight) ||
    !isConcurrentSupervisor(rightTask.rule, rightTask.flight)
  ) {
    return false;
  }
  const overlapMinutes = concurrentOverlapMinutes(state, left, right);
  return (
    overlapMinutes > 0 &&
    overlapMinutes <=
      state.settings.teamLeaderConcurrentSupervisionMaxOverlapMinutes
  );
}
