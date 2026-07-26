import type { AppState, Assignment, PositionRule, ScheduleResult, SchedulingDecision, Staff } from "../model";
import { createId } from "../utils";
import { getDutyRosterForDate } from "./duty-roster";
import { durationHours, isNightInterval, timeToMinutes } from "./time";
import { canMobileSupervisorCoverPosition } from "./mobile-supervisor-coverage";
import { compareCandidatePriority, firstDifferentCandidateRule, isPriorityRotationPosition, schedulingDecision, schedulingRuleLabel, type CandidatePriority } from "./scheduling-policy";
import { workloadBalancePriority } from "./workload-balance";
import { applyEarlyReleases, canReleaseForFlight, projectedAssignedHours, staffConflicts } from "./assignment-timing";
import { eligibleStaffForRule } from "./assignment-eligibility";
import { compactRegularAssignments, preNoonShortageNote } from "./schedule-coverage";
import { priorityPositionScarceQualification, scarceQualificationPriority } from "./candidate-qualification";
import {
  configuredDutyTaskPriority,
  dutyHardConstraintReason,
  dutyPositionPriority,
  preferredDutyLateTasks,
  preferredDutyMorningTask
} from "./duty-assignment";
import {
  activeFlightRules,
  assignmentRule,
  makeUnfilled
} from "./schedule-position-rules";
import {
  isKe166MobileSupervisor,
  isNumberedRegularPosition,
  isPreNoonFlight,
  mustAutoFillPreNoon,
  shouldAutoAssign,
  type AssignmentTask
} from "./schedule-tasks";
import {
  hasHighLoadTransition,
  lateShiftRecoveryPriority,
  lateShiftRecoveryRisk,
  positionTransitionInsertionCost,
  rollingLoadCost,
  totalFatiguePriority,
  violatedPositionTransitionPoliciesForInsertion
} from "./schedule-protection";
import {
  positionFrequencyProfileForRule
} from "./schedule-frequency";
import { reviewSamePositionFrequency } from "./position-frequency-review";
import { reviewConsecutivePositionRotation } from "./position-rotation-review";
import { reuseKe166RegularWorkerAsSupervisor } from "./ke166-assignment";
import { nextWorkdayRecoveryOverrideReason, strictOverrideNotes } from "./schedule-decision-notes";


export function generateSchedule(state: AppState, date: string): ScheduleResult {
  const assignments: Assignment[] = [];
  const warnings: string[] = [];
  const flights = [...state.flights].sort((left, right) => left.startTime.localeCompare(right.startTime));
  const displayRulesByFlight = new Map(flights.map((flight) => [flight.id, activeFlightRules(state, flight)]));
  const tasks: AssignmentTask[] = flights.flatMap((flight) => (displayRulesByFlight.get(flight.id) ?? [])
    .filter((rule) => shouldAutoAssign(flight, rule))
    .map((rule) => ({ key: `${flight.id}:${rule.id}`, flight, rule })));
  const eligibleStaffIds = new Map(tasks.map((task) => [task.key, new Set(eligibleStaffForRule(state, task.flight, task.rule).map((person) => person.id))]));
  const eligibleCounts = new Map(tasks.map((task) => [task.key, eligibleStaffIds.get(task.key)?.size ?? 0]));
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  const preferredDutyMorningTaskKey = preferredDutyMorningTask(state, date, tasks)?.key ?? null;
  const preferredDutyLateTaskCandidates = preferredDutyLateTasks(state, date, tasks);
  const dutyTargetTaskKeys = new Set([preferredDutyMorningTaskKey, ...preferredDutyLateTaskCandidates.map((task) => task.key)].filter((key): key is string => Boolean(key)));
  let assignedDutyLateTaskKey: string | null = null;
  const ke166SupervisorTask = tasks.find((task) => isKe166MobileSupervisor(task.flight, task.rule));
  const ke166SupervisorStaffIds = new Set(ke166SupervisorTask ? eligibleStaffIds.get(ke166SupervisorTask.key) ?? [] : []);
  const ke166RegularTargets = tasks
    .filter((task) => task.flight.id === ke166SupervisorTask?.flight.id && isNumberedRegularPosition(task.rule))
    .filter((task) => canMobileSupervisorCoverPosition(state, {
      flightNo: task.flight.flightNo,
      position: task.rule.name,
      remark: task.rule.remark
    }))
    .filter((task) => [...(eligibleStaffIds.get(task.key) ?? [])].some((staffId) => ke166SupervisorStaffIds.has(staffId)))
    .sort((left, right) => (eligibleCounts.get(left.key) ?? 0) - (eligibleCounts.get(right.key) ?? 0));
  const ke166RegularTargetTaskKey = (ke166RegularTargets.find((task) => task.key !== preferredDutyMorningTaskKey)
    ?? ke166RegularTargets[0])?.key ?? null;
  const processedTasks = new Set<string>();
  const lockedAssignmentIds = new Set<string>();

  const scheduleTask = (task: AssignmentTask, allowMorningReallocation: boolean): void => {
    const { flight, rule, key: taskKey } = task;
    const hours = durationHours(flight.startTime, flight.endTime);
    const preNoonRequired = mustAutoFillPreNoon(flight, rule);
    let strictTransitionBlockNotes: string[] = [];
    const configuredDutyPriority = configuredDutyTaskPriority(state, task);
    const isDutyTarget = Boolean(dutyStaffId && dutyTargetTaskKeys.has(taskKey));
    processedTasks.add(taskKey);
    const reusedSupervisor = reuseKe166RegularWorkerAsSupervisor(state, assignments, flight, rule, date);
    if (reusedSupervisor) {
      assignments.push(reusedSupervisor);
      return;
    }
    let candidates = eligibleStaffForRule(state, flight, rule)
      .filter((person) => staffConflicts(assignments, person.id, flight).every((assignment) => canReleaseForFlight(assignment, flight, state)))
      .filter((person) => projectedAssignedHours(assignments, person.id, flight, state) + hours <= state.settings.maxDailyHours);
    const reserveDutyForTarget = Boolean(dutyStaffId
      && taskKey !== preferredDutyMorningTaskKey
      && taskKey !== assignedDutyLateTaskKey
      && (Boolean(assignedDutyLateTaskKey)
        || (!dutyTargetTaskKeys.has(taskKey) && [...dutyTargetTaskKeys].some((targetKey) => !processedTasks.has(targetKey)))));
    if (reserveDutyForTarget) {
      const withoutDuty = candidates.filter((person) => person.id !== dutyStaffId);
      if (!preNoonRequired || withoutDuty.length) candidates = withoutDuty;
    }
    const reserveKe166Supervisor = Boolean(
      (ke166RegularTargetTaskKey
        && taskKey !== ke166RegularTargetTaskKey
        && !processedTasks.has(ke166RegularTargetTaskKey))
      || (!ke166RegularTargetTaskKey
        && ke166SupervisorTask
        && taskKey !== ke166SupervisorTask.key
        && task.flight.id === ke166SupervisorTask.flight.id
        && !processedTasks.has(ke166SupervisorTask.key))
    );
    if (reserveKe166Supervisor) {
      const withoutKe166Supervisor = candidates.filter((person) => !ke166SupervisorStaffIds.has(person.id));
      if (withoutKe166Supervisor.length) candidates = withoutKe166Supervisor;
    }
    if (taskKey === ke166RegularTargetTaskKey) {
      const mobileSupervisorCandidates = candidates.filter((person) => ke166SupervisorStaffIds.has(person.id));
      if (mobileSupervisorCandidates.length) candidates = mobileSupervisorCandidates;
    }
    const transitionPreferred = candidates.filter((person) => positionTransitionInsertionCost(assignments, person.id, task, state, "forbid") === 0);
    const reservedDuty = isDutyTarget ? candidates.find((person) => person.id === dutyStaffId) : undefined;
    if (reservedDuty && !transitionPreferred.includes(reservedDuty)) transitionPreferred.push(reservedDuty);
    const canBreakStrictTransition = preNoonRequired
      || taskKey === ke166RegularTargetTaskKey
      || isKe166MobileSupervisor(flight, rule);
    if (transitionPreferred.length) {
      candidates = transitionPreferred;
    } else if (candidates.length && !canBreakStrictTransition) {
      strictTransitionBlockNotes = [...new Set(candidates.flatMap((person) => violatedPositionTransitionPoliciesForInsertion(
        assignments,
        person.id,
        flight.flightNo,
        rule.name,
        flight.startTime,
        flight.endTime,
        state,
        "forbid"
      ).map((policy) => policy.name)))];
      candidates = [];
    }
    const candidatePriority = (person: Staff): CandidatePriority => ({
      dutyPosition: dutyPositionPriority(person.id, taskKey, dutyStaffId, dutyTargetTaskKeys),
      missingKe166SupervisorQualification: taskKey === ke166RegularTargetTaskKey && !ke166SupervisorStaffIds.has(person.id),
      strictTransitionViolations: positionTransitionInsertionCost(assignments, person.id, task, state, "forbid"),
      preferredTransitionViolations: positionTransitionInsertionCost(assignments, person.id, task, state, "prefer"),
      scarceQualification: isPriorityRotationPosition(rule)
        ? priorityPositionScarceQualification(person, task, state, assignments, tasks, processedTasks, eligibleCounts, eligibleStaffIds)
        : scarceQualificationPriority(person, flight, tasks, processedTasks, eligibleCounts, eligibleStaffIds),
      alreadyAssignedToday: assignments.some((item) => item.staffId === person.id && item.workHours > 0),
      lateShiftRecovery: lateShiftRecoveryPriority(state, person.id, {
        ...flight,
        position: rule.name,
        remark: rule.remark,
        fatiguePoints: rule.fatiguePoints
      }, date),
      rollingLoadExcess: rollingLoadCost(assignments, person.id, flight.startTime, rule.fatiguePoints, rule.remark, state),
      highLoadRecoveryConflict: state.settings.highLoadProtectionEnabled
        && hasHighLoadTransition(assignments, person.id, flight.startTime, flight.endTime, rule.fatiguePoints, rule.remark, state),
      positionFrequency: positionFrequencyProfileForRule(state, person.id, flight.flightNo, rule, date),
      workloadBalance: workloadBalancePriority(person, assignments, state, hours, rule.fatiguePoints, dutyStaffId, date),
      historicalFatigue: totalFatiguePriority(person, assignments, state, date),
      staffOrder: Math.max(0, state.staff.findIndex((item) => item.id === person.id))
    });
    const candidatePriorities = new Map(candidates.map((person) => [person.id, candidatePriority(person)]));
    candidates.sort((left, right) => compareCandidatePriority(candidatePriorities.get(left.id)!, candidatePriorities.get(right.id)!)
      || left.id.localeCompare(right.id, undefined, { numeric: true }));

    let selected = candidates[0];
    const runnerUp = candidates[1];
    const decisiveCandidateRule = selected && runnerUp
      ? firstDifferentCandidateRule(candidatePriorities.get(selected.id)!, candidatePriorities.get(runnerUp.id)!)
      : null;
    if (!selected && allowMorningReallocation && preNoonRequired) {
      const donors = assignments
        .filter((assignment) => assignment.status === "assigned" && assignment.staffId && assignment.flightId !== flight.id && isPreNoonFlight(assignment))
        .map((assignment) => ({
          assignment,
          sourceRule: assignmentRule(state, assignment),
          person: state.staff.find((person) => person.id === assignment.staffId)
        }))
        .filter((item): item is typeof item & { person: Staff; sourceRule: PositionRule } => Boolean(
          item.person
          && item.sourceRule?.category === "常规"
          && item.person.status === "正常"
          && item.person.staffType === "常规"
          && rule.qualifiedStaffIds.includes(item.person.id)
          && (!isNightInterval(flight.startTime, flight.endTime, state.settings.nightStart, state.settings.nightEnd) || item.person.nightShift)
        ))
        .filter((item) => {
          const remaining = assignments.filter((assignment) => assignment.id !== item.assignment.id);
          return staffConflicts(remaining, item.person.id, flight).every((assignment) => canReleaseForFlight(assignment, flight, state))
            && projectedAssignedHours(remaining, item.person.id, flight, state) + hours <= state.settings.maxDailyHours;
        })
        .sort((left, right) => (eligibleCounts.get(`${right.assignment.flightId}:${right.sourceRule.id}`) ?? 0)
          - (eligibleCounts.get(`${left.assignment.flightId}:${left.sourceRule.id}`) ?? 0)
          || left.assignment.startTime.localeCompare(right.assignment.startTime));
      const donor = donors[0];
      if (donor) {
        selected = donor.person;
        donor.assignment.staffId = null;
        donor.assignment.staffName = "";
        donor.assignment.status = "unfilled";
        donor.assignment.systemNotes = [`因抽调至 ${flight.flightNo}/${rule.name} 而空缺`];
        warnings.push(`${donor.assignment.flightNo} / ${donor.assignment.position} 因抽调至 ${flight.flightNo}/${rule.name} 而空缺`);
      }
    }

    if (!selected) {
      const unfilled = makeUnfilled(flight, rule.name, rule);
      if (strictTransitionBlockNotes.length) {
        unfilled.status = "unfilled";
        unfilled.systemNotes = [`严格岗位衔接限制未满足：${strictTransitionBlockNotes.join("、")}`];
      } else if (preNoonRequired) {
        unfilled.status = "unfilled";
        unfilled.systemNotes = [preNoonShortageNote(state, assignments, task.flight, task.rule)];
      }
      assignments.push(unfilled);
      warnings.push(`${flight.flightNo} / ${rule.name} ${unfilled.systemNotes?.[0] ?? "无可用人员"}`);
      return;
    }

    applyEarlyReleases(assignments, selected.id, flight, state);
    const systemNotes = strictOverrideNotes(state, assignments, selected, task);
    const decisionTrace: SchedulingDecision[] = [];
    if (dutyStaffId && configuredDutyPriority >= 0 && !assignedDutyLateTaskKey) {
      const hardReason = dutyHardConstraintReason(state, dutyStaffId, task);
      if (selected.id === dutyStaffId) {
        decisionTrace.push(schedulingDecision("duty-position", "selected", `值班人员${selected.name}按优先级第${configuredDutyPriority + 1}项锁定${flight.flightNo}/${rule.name}`));
      } else {
        decisionTrace.push(schedulingDecision("duty-position", "blocked", hardReason ?? `值班人员未通过${flight.flightNo}/${rule.name}的时段、工时或衔接检查`));
      }
    }
    if (selected.id === dutyStaffId && isDutyTarget && positionTransitionInsertionCost(assignments, selected.id, task, state, "forbid") > 0) {
      decisionTrace.push(schedulingDecision("position-transition", "fallback", "值班岗位锁定优先，已突破严格岗位衔接保护"));
    }
    if (taskKey === ke166RegularTargetTaskKey && ke166SupervisorStaffIds.has(selected.id)) {
      decisionTrace.push(schedulingDecision("ke166-supervisor", "selected", `${selected.name}已锁定为KE166机动督导兼任人员`));
    }
    const selectedRecoveryRisk = lateShiftRecoveryRisk(state, selected.id, {
      ...flight,
      position: rule.name,
      remark: rule.remark,
      fatiguePoints: rule.fatiguePoints
    }, date);
    if (selectedRecoveryRisk.protectedMorningTarget) {
      const reason = nextWorkdayRecoveryOverrideReason(
        state,
        assignments,
        selected,
        task,
        dutyStaffId,
        isDutyTarget,
        taskKey === ke166RegularTargetTaskKey || isKe166MobileSupervisor(flight, rule)
      );
      decisionTrace.push(schedulingDecision(
        "late-shift-recovery",
        "fallback",
        `跨工作日早班恢复保护未落实：${selected.name}仍安排在${flight.flightNo}/${rule.name}；${reason}`
      ));
    }
    if (runnerUp && decisiveCandidateRule && !decisionTrace.some((decision) => decision.ruleId === decisiveCandidateRule)) {
      decisionTrace.push(schedulingDecision(
        decisiveCandidateRule,
        "selected",
        `${selected.name}在“${schedulingRuleLabel(decisiveCandidateRule)}”判断中优先于${runnerUp.name}`
      ));
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
      ...(decisionTrace.length ? { decisionTrace } : {})
    };
    assignments.push(assignment);
    if ((selected.id === dutyStaffId && isDutyTarget) || taskKey === ke166RegularTargetTaskKey) lockedAssignmentIds.add(assignment.id);
    warnings.push(...systemNotes.map((note) => `${flight.flightNo} / ${rule.name} ${note}`));
  };

  const preNoonTasks = tasks
    .filter((task) => mustAutoFillPreNoon(task.flight, task.rule))
    .sort((left, right) => Number(right.key === ke166RegularTargetTaskKey) - Number(left.key === ke166RegularTargetTaskKey)
      || (eligibleCounts.get(left.key) ?? 0) - (eligibleCounts.get(right.key) ?? 0)
      || Number(isPriorityRotationPosition(right.rule)) - Number(isPriorityRotationPosition(left.rule))
      || timeToMinutes(left.flight.startTime) - timeToMinutes(right.flight.startTime)
      || (displayRulesByFlight.get(left.flight.id)?.findIndex((rule) => rule.id === left.rule.id) ?? 0)
        - (displayRulesByFlight.get(right.flight.id)?.findIndex((rule) => rule.id === right.rule.id) ?? 0)
      || left.key.localeCompare(right.key));
  preNoonTasks.forEach((task) => { scheduleTask(task, true); });

  for (const task of preferredDutyLateTaskCandidates) {
    if (!processedTasks.has(task.key)) scheduleTask(task, false);
    if (assignments.some((assignment) => assignment.flightId === task.flight.id
      && assignment.positionRuleId === task.rule.id
      && assignment.staffId === dutyStaffId)) {
      assignedDutyLateTaskKey = task.key;
      break;
    }
  }

  for (const flight of flights) {
    const displayRules = displayRulesByFlight.get(flight.id) ?? [];
    const displayIndex = new Map(displayRules.map((rule, index) => [rule.id, index]));
    const processingRules = displayRules
      .filter((rule) => !mustAutoFillPreNoon(flight, rule))
      .filter((rule) => rule.category !== "引导" && rule.category !== "行政支援")
      .sort((left, right) => {
        const leftKey = `${flight.id}:${left.id}`;
        const rightKey = `${flight.id}:${right.id}`;
        if (dutyTargetTaskKeys.has(leftKey) || dutyTargetTaskKeys.has(rightKey)) return dutyTargetTaskKeys.has(leftKey) ? -1 : 1;
        const leftDeferred = left.manual || (left.minPassengers ?? 0) > flight.bookedPassengers;
        const rightDeferred = right.manual || (right.minPassengers ?? 0) > flight.bookedPassengers;
        if (leftDeferred !== rightDeferred) return leftDeferred ? 1 : -1;
        const leftCount = eligibleCounts.get(leftKey) ?? Number.MAX_SAFE_INTEGER;
        const rightCount = eligibleCounts.get(rightKey) ?? Number.MAX_SAFE_INTEGER;
        return leftCount - rightCount
          || Number(isPriorityRotationPosition(right)) - Number(isPriorityRotationPosition(left))
          || (displayIndex.get(left.id) ?? 0) - (displayIndex.get(right.id) ?? 0);
      })
      .concat(displayRules.filter((rule) => rule.category === "引导"))
      .concat(displayRules.filter((rule) => rule.category === "行政支援"));

    for (const rule of processingRules) {
      const taskKey = `${flight.id}:${rule.id}`;
      if (processedTasks.has(taskKey)) continue;
      const ke166MobileSupervisor = isKe166MobileSupervisor(flight, rule);
      if (rule.category === "行政支援") {
        assignments.push({ ...makeUnfilled(flight, rule.name, rule), status: "manual" });
        continue;
      }
      if (!ke166MobileSupervisor && (rule.minPassengers ?? 0) > flight.bookedPassengers) {
        assignments.push({ ...makeUnfilled(flight, rule.name, rule), status: "manual" });
        continue;
      }
      if (rule.category === "引导") {
        const usedReusableStaff = new Set(assignments
          .filter((item) => item.flightId === flight.id && assignmentRule(state, item)?.category === rule.category)
          .map((item) => item.staffId)
          .filter((staffId): staffId is string => Boolean(staffId)));
        const reusedCandidates = assignments
          .filter((item) => item.flightId === flight.id && item.staffId && item.status === "assigned" && !usedReusableStaff.has(item.staffId))
          .map((item) => ({ assignment: item, sourceRule: assignmentRule(state, item), person: state.staff.find((person) => person.id === item.staffId) }))
          .filter((item): item is typeof item & { person: Staff } => Boolean(
            item.sourceRule?.category === "常规"
            && item.person?.status === "正常"
            && item.person.staffType === "常规"
          ))
          .sort((left, right) => (displayIndex.get(right.assignment.positionRuleId ?? "") ?? -1)
            - (displayIndex.get(left.assignment.positionRuleId ?? "") ?? -1));
        const selected = reusedCandidates[0]?.person;
        if (!selected) {
          assignments.push({ ...makeUnfilled(flight, rule.name, rule), workHours: 0, fatiguePoints: 0 });
          warnings.push(`${flight.flightNo} / ${rule.name} 没有可复用的常规岗位人员`);
        } else {
          assignments.push({
            id: createId("assignment"), flightId: flight.id, flightNo: flight.flightNo, positionRuleId: rule.id,
            position: rule.name, staffId: selected.id, staffName: selected.name, startTime: flight.startTime, endTime: flight.endTime,
            workHours: 0, fatiguePoints: 0, remark: rule.remark, manualRemark: "", status: "assigned"
          });
        }
        continue;
      }
      if (rule.manual && !ke166MobileSupervisor) {
        assignments.push(makeUnfilled(flight, rule.name, rule));
        continue;
      }
      scheduleTask({ key: taskKey, flight, rule }, false);
    }
  }

  compactRegularAssignments(state, assignments, lockedAssignmentIds);
  const postReviewWarnings = [
    ...reviewSamePositionFrequency(state, assignments, date, lockedAssignmentIds),
    ...reviewConsecutivePositionRotation(state, assignments, date, lockedAssignmentIds)
  ];

  assignments.filter((assignment) => assignment.status === "assigned" && assignment.staffId && isPreNoonFlight(assignment)).forEach((assignment) => {
    const rule = assignmentRule(state, assignment);
    const flight = state.flights.find((item) => item.id === assignment.flightId);
    const person = state.staff.find((item) => item.id === assignment.staffId);
    if (!rule || rule.category !== "常规" || !flight || !person) return;
    const preserved = (assignment.systemNotes ?? []).filter((note) => !note.startsWith("已突破严格限制仍安排："));
    const strictNotes = strictOverrideNotes(
      state,
      assignments.filter((item) => item.id !== assignment.id),
      person,
      { key: `${flight.id}:${rule.id}`, flight, rule }
    );
    assignment.systemNotes = [...preserved, ...strictNotes];
    if (!assignment.systemNotes.length) delete assignment.systemNotes;
  });

  warnings.length = 0;
  assignments.forEach((assignment) => {
    if (assignment.systemNotes?.length) {
      warnings.push(...assignment.systemNotes.map((note) => `${assignment.flightNo} / ${assignment.position} ${note}`));
      return;
    }
    if (assignment.status !== "unfilled") return;
    const category = assignmentRule(state, assignment)?.category;
    warnings.push(`${assignment.flightNo} / ${assignment.position} ${category === "引导" ? "没有可复用的常规岗位人员" : "无可用人员"}`);
  });
  warnings.push(...postReviewWarnings);

  const flightOrder = new Map(flights.map((flight, index) => [flight.id, index]));
  assignments.sort((left, right) => (flightOrder.get(left.flightId) ?? flights.length) - (flightOrder.get(right.flightId) ?? flights.length)
    || ((displayRulesByFlight.get(left.flightId)?.findIndex((rule) => rule.id === left.positionRuleId) ?? -1) + 1 || Number.MAX_SAFE_INTEGER)
      - ((displayRulesByFlight.get(right.flightId)?.findIndex((rule) => rule.id === right.positionRuleId) ?? -1) + 1 || Number.MAX_SAFE_INTEGER));

  return {
    assignments,
    unfilledCount: assignments.filter((assignment) => assignment.status === "unfilled").length,
    warnings: [...new Set(warnings)]
  };
}
