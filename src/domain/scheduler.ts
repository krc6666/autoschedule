import type { AppState, Assignment, ScheduleResult, Staff } from "../model";
import { createId } from "../utils";
import { assignmentDecisionMessages } from "./assignment-evidence";
import { eligibleStaffForRule } from "./assignment-eligibility";
import { compactRegularAssignments } from "./schedule-coverage";
import { strictOverrideNotes } from "./schedule-decision-notes";
import {
  preferredDutyLateTasks,
  preferredDutyMorningTask,
} from "./duty-assignment";
import { fillVacancyWithTeamLeaderConcurrentSupervision } from "./team-leader-concurrent-supervision";
import { runPostSchedulePipeline } from "./schedule-pipeline";
import {
  activeFlightRules,
  assignmentRule,
  makeUnfilled,
} from "./schedule-position-rules";
import {
  scheduleProgressPercent,
  type ScheduleProgressStage,
} from "./schedule-progress";
import { createScheduleRunFacts } from "./schedule-run-facts";
import { createScheduleTaskAssigner } from "./schedule-task-assigner";
import {
  isKe166MobileSupervisor,
  isPreNoonFlight,
  mustAutoFillPreNoon,
  shouldAutoAssign,
  type AssignmentTask,
} from "./schedule-tasks";
import { isPriorityRotationPosition } from "./position-rotation-policy";
import { timeToMinutes } from "./time";

export type { ScheduleProgressStage } from "./schedule-progress";

export interface GenerateScheduleOptions {
  onProgress?: (stage: ScheduleProgressStage, percent: number) => void;
}

export function generateSchedule(
  state: AppState,
  date: string,
  options: GenerateScheduleOptions = {}
): ScheduleResult {
  const reportProgress = (
    stage: ScheduleProgressStage,
    percent: number
  ): void => options.onProgress?.(stage, percent);
  reportProgress("prepare", scheduleProgressPercent("prepare"));
  const assignments: Assignment[] = [];
  const warnings: string[] = [];
  const flights = [...state.flights].sort((left, right) =>
    left.startTime.localeCompare(right.startTime)
  );
  const displayRulesByFlight = new Map(
    flights.map((flight) => [flight.id, activeFlightRules(state, flight)])
  );
  const tasks: AssignmentTask[] = flights.flatMap((flight) =>
    (displayRulesByFlight.get(flight.id) ?? [])
      .filter((rule) => shouldAutoAssign(flight, rule))
      .map((rule) => ({ key: `${flight.id}:${rule.id}`, flight, rule }))
  );
  const eligibleStaffIds = new Map(
    tasks.map((task) => [
      task.key,
      new Set(
        eligibleStaffForRule(state, task.flight, task.rule).map(
          (person) => person.id
        )
      ),
    ])
  );
  const eligibleCounts = new Map(
    tasks.map((task) => [task.key, eligibleStaffIds.get(task.key)?.size ?? 0])
  );
  reportProgress("history", scheduleProgressPercent("history"));
  const runFacts = createScheduleRunFacts(state, date);
  const dutyStaffId = runFacts.currentDutyStaffId;
  const preferredDutyMorningTaskKey =
    preferredDutyMorningTask(state, date, tasks, dutyStaffId)?.key ?? null;
  const preferredDutyLateTaskCandidates = preferredDutyLateTasks(
    state,
    date,
    tasks,
    dutyStaffId
  );
  const processedTasks = new Set<string>();
  const lockedAssignmentIds = new Set<string>();
  const taskAssigner = createScheduleTaskAssigner({
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
  });

  reportProgress("assign", scheduleProgressPercent("assign"));
  const preNoonTasks = tasks
    .filter((task) => mustAutoFillPreNoon(task.flight, task.rule))
    .sort(
      (left, right) =>
        (eligibleCounts.get(left.key) ?? 0) -
          (eligibleCounts.get(right.key) ?? 0) ||
        Number(isPriorityRotationPosition(right.rule)) -
          Number(isPriorityRotationPosition(left.rule)) ||
        timeToMinutes(left.flight.startTime) -
          timeToMinutes(right.flight.startTime) ||
        (displayRulesByFlight
          .get(left.flight.id)
          ?.findIndex((rule) => rule.id === left.rule.id) ?? 0) -
          (displayRulesByFlight
            .get(right.flight.id)
            ?.findIndex((rule) => rule.id === right.rule.id) ?? 0) ||
        left.key.localeCompare(right.key)
    );
  preNoonTasks.forEach((task) => {
    taskAssigner.schedule(task, true);
  });

  for (const task of preferredDutyLateTaskCandidates) {
    if (!taskAssigner.hasProcessedTask(task.key))
      taskAssigner.schedule(task, false);
    if (
      assignments.some(
        (assignment) =>
          assignment.flightId === task.flight.id &&
          assignment.positionRuleId === task.rule.id &&
          assignment.staffId === dutyStaffId
      )
    ) {
      taskAssigner.markAssignedDutyLateTask(task.key);
      break;
    }
  }

  for (const flight of flights) {
    const displayRules = displayRulesByFlight.get(flight.id) ?? [];
    const displayIndex = new Map(
      displayRules.map((rule, index) => [rule.id, index])
    );
    const processingRules = displayRules
      .filter((rule) => !mustAutoFillPreNoon(flight, rule))
      .filter(
        (rule) => rule.category !== "引导" && rule.category !== "行政支援"
      )
      .sort((left, right) => {
        const leftKey = `${flight.id}:${left.id}`;
        const rightKey = `${flight.id}:${right.id}`;
        if (
          taskAssigner.dutyTargetTaskKeys.has(leftKey) ||
          taskAssigner.dutyTargetTaskKeys.has(rightKey)
        ) {
          return taskAssigner.dutyTargetTaskKeys.has(leftKey) ? -1 : 1;
        }
        const leftDeferred =
          left.manual || (left.minPassengers ?? 0) > flight.bookedPassengers;
        const rightDeferred =
          right.manual || (right.minPassengers ?? 0) > flight.bookedPassengers;
        if (leftDeferred !== rightDeferred) return leftDeferred ? 1 : -1;
        const leftCount =
          eligibleCounts.get(leftKey) ?? Number.MAX_SAFE_INTEGER;
        const rightCount =
          eligibleCounts.get(rightKey) ?? Number.MAX_SAFE_INTEGER;
        return (
          leftCount - rightCount ||
          Number(isPriorityRotationPosition(right)) -
            Number(isPriorityRotationPosition(left)) ||
          (displayIndex.get(left.id) ?? 0) - (displayIndex.get(right.id) ?? 0)
        );
      })
      .concat(displayRules.filter((rule) => rule.category === "引导"))
      .concat(displayRules.filter((rule) => rule.category === "行政支援"));

    for (const rule of processingRules) {
      const taskKey = `${flight.id}:${rule.id}`;
      if (taskAssigner.hasProcessedTask(taskKey)) continue;
      const ke166MobileSupervisor = isKe166MobileSupervisor(flight, rule);
      if (rule.category === "行政支援") {
        assignments.push({
          ...makeUnfilled(flight, rule.name, rule),
          status: "manual",
        });
        continue;
      }
      if (
        !ke166MobileSupervisor &&
        (rule.minPassengers ?? 0) > flight.bookedPassengers
      ) {
        assignments.push({
          ...makeUnfilled(flight, rule.name, rule),
          status: "manual",
        });
        continue;
      }
      if (rule.category === "引导") {
        const usedReusableStaff = new Set(
          assignments
            .filter(
              (item) =>
                item.flightId === flight.id &&
                assignmentRule(state, item)?.category === rule.category
            )
            .map((item) => item.staffId)
            .filter((staffId): staffId is string => Boolean(staffId))
        );
        const reusedCandidates = assignments
          .filter(
            (item) =>
              item.flightId === flight.id &&
              item.staffId &&
              item.status === "assigned" &&
              !usedReusableStaff.has(item.staffId)
          )
          .map((item) => ({
            assignment: item,
            sourceRule: assignmentRule(state, item),
            person: state.staff.find((person) => person.id === item.staffId),
          }))
          .filter((item): item is typeof item & { person: Staff } =>
            Boolean(
              item.sourceRule?.category === "常规" &&
              item.person?.status === "正常" &&
              item.person.staffType === "常规"
            )
          )
          .sort(
            (left, right) =>
              (displayIndex.get(right.assignment.positionRuleId ?? "") ?? -1) -
              (displayIndex.get(left.assignment.positionRuleId ?? "") ?? -1)
          );
        const selected = reusedCandidates[0]?.person;
        if (!selected) {
          assignments.push({
            ...makeUnfilled(flight, rule.name, rule),
            workHours: 0,
            fatiguePoints: 0,
          });
          warnings.push(
            `${flight.flightNo} / ${rule.name} 没有可复用的常规岗位人员`
          );
        } else {
          assignments.push({
            id: createId("assignment"),
            flightId: flight.id,
            flightNo: flight.flightNo,
            positionRuleId: rule.id,
            position: rule.name,
            staffId: selected.id,
            staffName: selected.name,
            startTime: flight.startTime,
            endTime: flight.endTime,
            workHours: 0,
            fatiguePoints: 0,
            remark: rule.remark,
            manualRemark: "",
            status: "assigned",
          });
        }
        continue;
      }
      if (rule.manual && !ke166MobileSupervisor) {
        assignments.push(makeUnfilled(flight, rule.name, rule));
        continue;
      }
      taskAssigner.schedule({ key: taskKey, flight, rule }, false);
    }
  }

  compactRegularAssignments(state, assignments, lockedAssignmentIds);
  const postReviewWarnings: string[] = [];
  postReviewWarnings.push(
    ...fillVacancyWithTeamLeaderConcurrentSupervision(
      state,
      assignments,
      date,
      lockedAssignmentIds,
      runFacts
    )
  );
  postReviewWarnings.push(
    ...runPostSchedulePipeline({
      state,
      assignments,
      date,
      lockedAssignmentIds,
      runFacts,
      onProgress: (stage, percent) => reportProgress(stage, percent),
      finalizeKe166Supervisor: () =>
        taskAssigner.finalizeDeferredKe166Supervisors(),
    })
  );
  for (const message of assignmentDecisionMessages(assignments, {
    ruleIds: new Set(["position-rotation"]),
    outcomes: new Set(["fallback"]),
  })) {
    if (!postReviewWarnings.includes(message)) postReviewWarnings.push(message);
  }

  assignments
    .filter(
      (assignment) =>
        assignment.status === "assigned" &&
        assignment.staffId &&
        isPreNoonFlight(assignment)
    )
    .forEach((assignment) => {
      const rule = assignmentRule(state, assignment);
      const flight = state.flights.find(
        (item) => item.id === assignment.flightId
      );
      const person = state.staff.find((item) => item.id === assignment.staffId);
      if (!rule || rule.category !== "常规" || !flight || !person) return;
      const preserved = (assignment.systemNotes ?? []).filter(
        (note) => !note.startsWith("已突破严格限制仍安排：")
      );
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
      warnings.push(
        ...assignment.systemNotes.map(
          (note) => `${assignment.flightNo} / ${assignment.position} ${note}`
        )
      );
      return;
    }
    if (assignment.status !== "unfilled") return;
    const category = assignmentRule(state, assignment)?.category;
    warnings.push(
      `${assignment.flightNo} / ${assignment.position} ${category === "引导" ? "没有可复用的常规岗位人员" : "无可用人员"}`
    );
  });
  warnings.push(...postReviewWarnings);

  const flightOrder = new Map(
    flights.map((flight, index) => [flight.id, index])
  );
  assignments.sort(
    (left, right) =>
      (flightOrder.get(left.flightId) ?? flights.length) -
        (flightOrder.get(right.flightId) ?? flights.length) ||
      ((displayRulesByFlight
        .get(left.flightId)
        ?.findIndex((rule) => rule.id === left.positionRuleId) ?? -1) + 1 ||
        Number.MAX_SAFE_INTEGER) -
        ((displayRulesByFlight
          .get(right.flightId)
          ?.findIndex((rule) => rule.id === right.positionRuleId) ?? -1) + 1 ||
          Number.MAX_SAFE_INTEGER)
  );

  reportProgress("complete", scheduleProgressPercent("complete"));
  return {
    assignments,
    unfilledCount: assignments.filter(
      (assignment) => assignment.status === "unfilled"
    ).length,
    warnings: [...new Set(warnings)],
  };
}
