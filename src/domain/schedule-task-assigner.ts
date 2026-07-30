import type { AppState, Assignment, PositionRule, Staff } from "../model";
import {
  schedulingDecision,
  schedulingRuleLabel,
  type SchedulingDecision,
} from "../schedule-rule-contract";
import { createId } from "../utils";
import {
  analyzeAutomaticEligibilityPool,
  diagnoseAutomaticAssignmentEligibility,
} from "./assignment-eligibility";
import { applyEarlyReleases } from "./assignment-timing";
import {
  buildCandidatePriority,
  compareCandidatePriority,
  firstDifferentCandidateRule,
} from "./candidate-priority";
import {
  configuredDutyTaskPriority,
  dutyHardConstraintReason,
} from "./duty-assignment";
import {
  assignKe166SupervisorByCounterCoverage,
  compareKe166SupervisorRotation,
} from "./ke166-assignment";
import { isNextDutyRestConflict } from "./next-duty-rest";
import { comparePreviousWorkdayLoad } from "./previous-workday-load";
import {
  nextDutyRestOverrideReason,
  nextWorkdayRecoveryOverrideReason,
  strictOverrideNotes,
} from "./schedule-decision-notes";
import { preNoonShortageNote } from "./schedule-coverage";
import { assignmentRule, makeUnfilled } from "./schedule-position-rules";
import { consecutivePositionAssignments } from "./schedule-frequency";
import {
  isHighLoadPosition,
  lateShiftCutoffPriority,
  lateShiftRecoveryRisk,
  positionTransitionInsertionCost,
  violatedPositionTransitionPoliciesForInsertion,
} from "./schedule-protection";
import type { ScheduleRunFacts } from "./schedule-run-facts";
import {
  isKe166MobileSupervisor,
  isPreNoonFlight,
  mustAutoFillPreNoon,
  type AssignmentTask,
} from "./schedule-tasks";
import { isPriorityRotationPosition } from "./position-rotation-policy";
import { durationHours } from "./time";

export interface ScheduleTaskAssignerOptions {
  state: AppState;
  date: string;
  assignments: Assignment[];
  warnings: string[];
  tasks: AssignmentTask[];
  processedTasks: Set<string>;
  eligibleStaffIds: Map<string, Set<string>>;
  eligibleCounts: Map<string, number>;
  runFacts: ScheduleRunFacts;
  dutyStaffId: string | null;
  preferredDutyMorningTaskKey: string | null;
  preferredDutyLateTaskCandidates: AssignmentTask[];
  lockedAssignmentIds: Set<string>;
}

export interface ScheduleTaskAssigner {
  readonly dutyTargetTaskKeys: ReadonlySet<string>;
  schedule(
    task: AssignmentTask,
    allowMorningReallocation: boolean,
    finalizingKe166Supervisor?: boolean
  ): void;
  hasProcessedTask(taskKey: string): boolean;
  hasAssignedDutyLateTask(): boolean;
  markAssignedDutyLateTask(taskKey: string): void;
  finalizeDeferredKe166Supervisors(): void;
}

export function createScheduleTaskAssigner(
  options: ScheduleTaskAssignerOptions
): ScheduleTaskAssigner {
  const {
    state,
    date,
    assignments,
    warnings,
    tasks,
    processedTasks,
    eligibleStaffIds,
    eligibleCounts,
    runFacts,
    dutyStaffId,
    preferredDutyMorningTaskKey,
    preferredDutyLateTaskCandidates,
    lockedAssignmentIds,
  } = options;
  const deferredKe166SupervisorTasks: AssignmentTask[] = [];
  const deferredKe166SupervisorKeys = new Set<string>();
  let activeDutyLateTaskIndex = 0;
  let assignedDutyLateTaskKey: string | null = null;
  const dutyTargetTaskKeys = new Set(
    [
      preferredDutyMorningTaskKey,
      ...preferredDutyLateTaskCandidates.map((task) => task.key),
    ].filter((key): key is string => Boolean(key))
  );
  const activeDutyLateTaskKey = (): string | null =>
    assignedDutyLateTaskKey ??
    preferredDutyLateTaskCandidates[activeDutyLateTaskIndex]?.key ??
    null;
  const activeDutyTargetTaskKeys = (): ReadonlySet<string> =>
    new Set(
      [preferredDutyMorningTaskKey, activeDutyLateTaskKey()].filter(
        (key): key is string => Boolean(key)
      )
    );
  const settleDutyLateTarget = (
    taskKey: string,
    selectedStaffId: string | null
  ): void => {
    if (assignedDutyLateTaskKey || taskKey !== activeDutyLateTaskKey()) return;
    if (selectedStaffId === dutyStaffId) {
      assignedDutyLateTaskKey = taskKey;
      return;
    }
    activeDutyLateTaskIndex += 1;
  };

  const schedule = (
    task: AssignmentTask,
    allowMorningReallocation: boolean,
    finalizingKe166Supervisor = false
  ): void => {
    const { flight, rule, key: taskKey } = task;
    const hours = durationHours(flight.startTime, flight.endTime);
    const preNoonRequired = mustAutoFillPreNoon(flight, rule);
    let strictTransitionBlockNotes: string[] = [];
    const configuredDutyPriority = configuredDutyTaskPriority(state, task);
    const currentDutyTargetTaskKeys = activeDutyTargetTaskKeys();
    const isDutyTarget = Boolean(
      dutyStaffId &&
      (taskKey === preferredDutyMorningTaskKey ||
        (!assignedDutyLateTaskKey && taskKey === activeDutyLateTaskKey()))
    );
    const isDutyMorningTarget = taskKey === preferredDutyMorningTaskKey;
    if (isKe166MobileSupervisor(flight, rule) && !finalizingKe166Supervisor) {
      if (!deferredKe166SupervisorKeys.has(taskKey)) {
        deferredKe166SupervisorKeys.add(taskKey);
        deferredKe166SupervisorTasks.push(task);
      }
      return;
    }
    processedTasks.add(taskKey);
    let candidates = analyzeAutomaticEligibilityPool({
      state,
      assignments,
      flight,
      rule,
    }).withinHours;
    const reserveDutyForPendingTarget = Boolean(
      dutyStaffId &&
      !assignedDutyLateTaskKey &&
      taskKey !== preferredDutyMorningTaskKey &&
      !currentDutyTargetTaskKeys.has(taskKey) &&
      Boolean(activeDutyLateTaskKey()) &&
      !processedTasks.has(activeDutyLateTaskKey()!)
    );
    const protectDutyFromAdditionalPriorityPosition = Boolean(
      dutyStaffId &&
      assignedDutyLateTaskKey &&
      taskKey !== assignedDutyLateTaskKey &&
      isPriorityRotationPosition(rule)
    );
    if (
      reserveDutyForPendingTarget ||
      protectDutyFromAdditionalPriorityPosition
    ) {
      const withoutDuty = candidates.filter(
        (person) => person.id !== dutyStaffId
      );
      if (!preNoonRequired || withoutDuty.length) candidates = withoutDuty;
    }
    const transitionPreferred = candidates.filter(
      (person) =>
        diagnoseAutomaticAssignmentEligibility({
          state,
          assignments,
          flight,
          rule,
          person,
          workHours: hours,
          transitionMode: "forbid",
        }).eligible
    );
    const reservedDuty = isDutyTarget
      ? candidates.find((person) => person.id === dutyStaffId)
      : undefined;
    if (reservedDuty && !transitionPreferred.includes(reservedDuty))
      transitionPreferred.push(reservedDuty);
    const canBreakStrictTransition =
      preNoonRequired || isKe166MobileSupervisor(flight, rule);
    if (transitionPreferred.length) {
      candidates = transitionPreferred;
    } else if (candidates.length && !canBreakStrictTransition) {
      strictTransitionBlockNotes = [
        ...new Set(
          candidates.flatMap((person) =>
            violatedPositionTransitionPoliciesForInsertion(
              assignments,
              person.id,
              flight.flightNo,
              rule.name,
              flight.startTime,
              flight.endTime,
              state,
              "forbid"
            ).map((policy) => policy.name)
          )
        ),
      ];
      candidates = [];
    }
    const candidatePriorities = new Map(
      candidates.map((person) => [
        person.id,
        buildCandidatePriority(
          {
            state,
            assignments,
            tasks,
            processedTasks,
            eligibleStaffIds,
            eligibleCounts,
            runFacts,
            date,
            dutyStaffId,
            task,
            hours,
            isDutyTarget,
            reserveDutyForPendingTarget,
            currentDutyTargetTaskKeys,
          },
          person
        ),
      ])
    );
    candidates.sort(
      (left, right) =>
        (finalizingKe166Supervisor
          ? compareKe166SupervisorRotation(
              state,
              flight,
              rule,
              date,
              left.id,
              right.id
            )
          : 0) ||
        compareCandidatePriority(
          candidatePriorities.get(left.id)!,
          candidatePriorities.get(right.id)!
        ) ||
        left.id.localeCompare(right.id, undefined, { numeric: true })
    );

    let selected = candidates[0];
    const runnerUp = candidates[1];
    const decisiveCandidateRule =
      selected && runnerUp
        ? firstDifferentCandidateRule(
            candidatePriorities.get(selected.id)!,
            candidatePriorities.get(runnerUp.id)!
          )
        : null;
    if (!selected && allowMorningReallocation && preNoonRequired) {
      const donors = assignments
        .filter(
          (assignment) =>
            assignment.status === "assigned" &&
            assignment.staffId &&
            assignment.flightId !== flight.id &&
            isPreNoonFlight(assignment)
        )
        .map((assignment) => ({
          assignment,
          sourceRule: assignmentRule(state, assignment),
          person: state.staff.find(
            (person) => person.id === assignment.staffId
          ),
        }))
        .filter(
          (
            item
          ): item is typeof item & {
            person: Staff;
            sourceRule: PositionRule;
          } => Boolean(item.person && item.sourceRule?.category === "常规")
        )
        .filter((item) => {
          const remaining = assignments.filter(
            (assignment) => assignment.id !== item.assignment.id
          );
          return diagnoseAutomaticAssignmentEligibility({
            state,
            assignments: remaining,
            flight,
            rule,
            person: item.person,
            workHours: hours,
          }).eligible;
        })
        .sort(
          (left, right) =>
            (eligibleCounts.get(
              `${right.assignment.flightId}:${right.sourceRule.id}`
            ) ?? 0) -
              (eligibleCounts.get(
                `${left.assignment.flightId}:${left.sourceRule.id}`
              ) ?? 0) ||
            left.assignment.startTime.localeCompare(right.assignment.startTime)
        );
      const donor = donors[0];
      if (donor) {
        selected = donor.person;
        donor.assignment.staffId = null;
        donor.assignment.staffName = "";
        donor.assignment.status = "unfilled";
        donor.assignment.systemNotes = [
          `因抽调至 ${flight.flightNo}/${rule.name} 而空缺`,
        ];
        warnings.push(
          `${donor.assignment.flightNo} / ${donor.assignment.position} 因抽调至 ${flight.flightNo}/${rule.name} 而空缺`
        );
      }
    }

    const repeatedIndependentSupervisor =
      finalizingKe166Supervisor &&
      selected &&
      consecutivePositionAssignments(
        state,
        selected.id,
        flight.flightNo,
        rule.name,
        date
      ) > 0 &&
      assignments.some(
        (assignment) =>
          assignment.staffId === selected!.id &&
          assignment.status === "assigned" &&
          assignment.workHours > 0
      );
    if (repeatedIndependentSupervisor) {
      const reusedSupervisor = assignKe166SupervisorByCounterCoverage(
        state,
        assignments,
        flight,
        rule,
        date,
        runFacts,
        lockedAssignmentIds,
        selected!.id
      );
      if (reusedSupervisor) {
        assignments.push(reusedSupervisor);
        return;
      }
    }

    if (!selected && finalizingKe166Supervisor) {
      const reusedSupervisor = assignKe166SupervisorByCounterCoverage(
        state,
        assignments,
        flight,
        rule,
        date,
        runFacts,
        lockedAssignmentIds
      );
      if (reusedSupervisor) {
        assignments.push(reusedSupervisor);
        return;
      }
    }

    if (!selected) {
      const unfilled = makeUnfilled(flight, rule.name, rule);
      if (strictTransitionBlockNotes.length) {
        unfilled.status = "unfilled";
        unfilled.systemNotes = [
          `严格岗位衔接限制未满足：${strictTransitionBlockNotes.join("、")}`,
        ];
      } else if (preNoonRequired) {
        unfilled.status = "unfilled";
        unfilled.systemNotes = [
          preNoonShortageNote(state, assignments, task.flight, task.rule),
        ];
      }
      assignments.push(unfilled);
      warnings.push(
        `${flight.flightNo} / ${rule.name} ${unfilled.systemNotes?.[0] ?? "无可用人员"}`
      );
      settleDutyLateTarget(taskKey, null);
      return;
    }

    applyEarlyReleases(assignments, selected.id, flight, state);
    const systemNotes = strictOverrideNotes(state, assignments, selected, task);
    const decisionTrace: SchedulingDecision[] = [];
    if (finalizingKe166Supervisor) {
      decisionTrace.push(
        schedulingDecision(
          "ke166-supervisor",
          "selected",
          `${selected.name}在柜台排班与重点岗位轮换完成后独立担任${flight.flightNo}/${rule.name}`
        )
      );
    }
    if (
      dutyStaffId &&
      configuredDutyPriority >= 0 &&
      isDutyTarget &&
      !assignedDutyLateTaskKey
    ) {
      const hardReason = dutyHardConstraintReason(state, dutyStaffId, task);
      if (selected.id === dutyStaffId) {
        decisionTrace.push(
          schedulingDecision(
            "duty-position",
            "selected",
            `值班人员${selected.name}按优先级第${configuredDutyPriority + 1}项锁定${flight.flightNo}/${rule.name}`
          )
        );
      } else {
        decisionTrace.push(
          schedulingDecision(
            "duty-position",
            "blocked",
            hardReason ??
              `值班人员未通过${flight.flightNo}/${rule.name}的时段、工时或衔接检查`
          )
        );
      }
    }
    if (
      selected.id === dutyStaffId &&
      isDutyTarget &&
      positionTransitionInsertionCost(
        assignments,
        selected.id,
        task,
        state,
        "forbid"
      ) > 0
    ) {
      decisionTrace.push(
        schedulingDecision(
          "position-transition",
          "fallback",
          "值班岗位锁定优先，已突破严格岗位衔接保护"
        )
      );
    }
    if (
      isNextDutyRestConflict(
        state,
        selected.id,
        rule,
        date,
        runFacts.nextDutyRest
      )
    ) {
      const reason = nextDutyRestOverrideReason(
        state,
        assignments,
        selected,
        task,
        dutyStaffId,
        isDutyTarget,
        isKe166MobileSupervisor(flight, rule)
      );
      decisionTrace.push(
        schedulingDecision(
          "next-duty-rest",
          "fallback",
          `下班次值班预休未落实：${selected.name}仍安排在${flight.flightNo}/${rule.name}；${reason}`
        )
      );
    }
    const selectedRecoveryRisk = lateShiftRecoveryRisk(
      state,
      selected.id,
      {
        ...flight,
        position: rule.name,
        remark: rule.remark,
        fatiguePoints: rule.fatiguePoints,
      },
      date,
      runFacts.crossDayRecovery
    );
    if (
      selectedRecoveryRisk.protectedMorningTarget ||
      selectedRecoveryRisk.protectedLatePriorityTarget
    ) {
      const reason = nextWorkdayRecoveryOverrideReason(
        state,
        assignments,
        selected,
        task,
        dutyStaffId,
        isDutyTarget,
        isKe166MobileSupervisor(flight, rule),
        selectedRecoveryRisk.protectedMorningTarget
      );
      decisionTrace.push(
        schedulingDecision(
          "late-shift-recovery",
          "fallback",
          `${selectedRecoveryRisk.protectedMorningTarget ? "跨工作日早班恢复" : "末班重点岗位恢复"}未落实：${selected.name}仍安排在${flight.flightNo}/${rule.name}；${reason}`
        )
      );
    }
    const selectedCutoff = lateShiftCutoffPriority(
      state,
      selected.id,
      flight,
      date,
      runFacts.crossDayRecovery
    );
    if (selectedCutoff.disposition === "after-cutoff") {
      const reason = nextWorkdayRecoveryOverrideReason(
        state,
        assignments,
        selected,
        task,
        dutyStaffId,
        isDutyTarget,
        isKe166MobileSupervisor(flight, rule),
        false
      );
      decisionTrace.push(
        schedulingDecision(
          "late-shift-cutoff",
          "fallback",
          `末班重点岗位次班截止保护未落实：${selected.name}仍安排在${flight.flightNo}/${rule.name}；${reason}`
        )
      );
    }
    if (
      runnerUp &&
      decisiveCandidateRule &&
      !decisionTrace.some(
        (decision) => decision.ruleId === decisiveCandidateRule
      )
    ) {
      decisionTrace.push(
        schedulingDecision(
          decisiveCandidateRule,
          "selected",
          `${selected.name}在“${schedulingRuleLabel(decisiveCandidateRule)}”判断中优先于${runnerUp.name}`
        )
      );
    }
    if (isHighLoadPosition(rule.fatiguePoints, rule.remark, state)) {
      const selectedLoad = candidatePriorities.get(
        selected.id
      )?.previousWorkdayLoad;
      const lighterPreviousCandidate = selectedLoad
        ? candidates.find((person) => {
            const profile = candidatePriorities.get(person.id);
            return (
              profile &&
              comparePreviousWorkdayLoad(
                profile.previousWorkdayLoad,
                selectedLoad
              ) < 0
            );
          })
        : undefined;
      const blockingRule = lighterPreviousCandidate
        ? firstDifferentCandidateRule(
            candidatePriorities.get(selected.id)!,
            candidatePriorities.get(lighterPreviousCandidate.id)!
          )
        : null;
      if (
        lighterPreviousCandidate &&
        blockingRule &&
        blockingRule !== "cross-workday-load"
      ) {
        decisionTrace.push(
          schedulingDecision(
            "cross-workday-load",
            "fallback",
            `跨工作班负荷互补未落实：${selected.name}上一班负荷高于${lighterPreviousCandidate.name}，本班仍承担${flight.flightNo}/${rule.name}；${schedulingRuleLabel(blockingRule)}优先。`
          )
        );
      }
    }
    const assignment: Assignment = {
      id: createId("assignment"),
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: selected.id,
      staffName: selected.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      workHours: hours,
      fatiguePoints: rule.fatiguePoints,
      remark: rule.remark,
      manualRemark: "",
      status: "assigned",
      ...(systemNotes.length ? { systemNotes } : {}),
      ...(decisionTrace.length ? { decisionTrace } : {}),
    };
    assignments.push(assignment);
    settleDutyLateTarget(taskKey, selected.id);
    if (selected.id === dutyStaffId && isDutyTarget && !isDutyMorningTarget)
      lockedAssignmentIds.add(assignment.id);
    warnings.push(
      ...systemNotes.map((note) => `${flight.flightNo} / ${rule.name} ${note}`)
    );
  };

  return {
    dutyTargetTaskKeys,
    schedule,
    hasProcessedTask: (taskKey) => processedTasks.has(taskKey),
    hasAssignedDutyLateTask: () => Boolean(assignedDutyLateTaskKey),
    markAssignedDutyLateTask: (taskKey) => {
      assignedDutyLateTaskKey = taskKey;
    },
    finalizeDeferredKe166Supervisors: () => {
      for (const task of deferredKe166SupervisorTasks)
        schedule(task, false, true);
    },
  };
}
