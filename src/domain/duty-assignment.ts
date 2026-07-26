import type { AppState, Assignment, Flight } from "../model";
import type { CandidatePriority } from "./scheduling-policy";
import type { AssignmentTask } from "./schedule-tasks";
import { eligibleStaffForRule } from "./assignment-eligibility";
import { getDutyRosterForDate } from "./duty-roster";
import { isSupervisorPosition } from "./schedule-position-rules";
import { durationHours, isNightInterval, timeToMinutes } from "./time";

export function dutyLatePositionPriority(position: string, remark: string): number {
  const value = `${position} ${remark}`;
  if (value.includes("一号")) return 0;
  if (isSupervisorPosition(position)) return 1;
  if (value.includes("申报")) return 2;
  if (value.includes("送资料")) return 3;
  return 4;
}

function matchesDutyPositionPriority(
  priority: AppState["settings"]["dutyPositionPriorities"][number],
  target: Pick<Assignment, "flightNo" | "position" | "remark">
): boolean {
  const flightNo = target.flightNo.trim().toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  const positionText = `${target.position} ${target.remark}`.trim().toLowerCase();
  return priority.enabled
    && priority.flightNo.trim().toUpperCase().replaceAll(/[^A-Z0-9]/g, "") === flightNo
    && (!priority.positionKeyword.trim() || positionText.includes(priority.positionKeyword.trim().toLowerCase()));
}

export function configuredDutyPositionPriority(
  state: AppState,
  target: Pick<Assignment, "flightNo" | "position" | "remark">
): number {
  return state.settings.dutyPositionPriorities.findIndex((item) => matchesDutyPositionPriority(item, target));
}

export const DUTY_MORNING_CUTOFF = "08:30";

export function isDutyMorningFlight(target: Pick<Flight, "startTime">, state: AppState): boolean {
  const start = timeToMinutes(target.startTime);
  const morningStart = timeToMinutes(state.settings.nightEnd);
  const cutoff = timeToMinutes(DUTY_MORNING_CUTOFF);
  return [start, morningStart, cutoff].every(Number.isFinite) && start >= morningStart && start <= cutoff;
}

function operationalStartMinutes(startTime: string, state: AppState): number {
  const start = timeToMinutes(startTime);
  const nightEnd = timeToMinutes(state.settings.nightEnd);
  return start < nightEnd ? start + 24 * 60 : start;
}

export function preferredDutyLateTasks(state: AppState, date: string, tasks: AssignmentTask[]): AssignmentTask[] {
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  if (!dutyStaffId || !tasks.length) return [];
  const eligibleTasks = tasks
    .filter((task) => durationHours(task.flight.startTime, task.flight.endTime) <= state.settings.maxDailyHours)
    .filter((task) => eligibleStaffForRule(state, task.flight, task.rule).some((person) => person.id === dutyStaffId));
  const ordered: AssignmentTask[] = [];
  for (const priority of state.settings.dutyPositionPriorities.filter((item) => item.enabled)) {
    const target = eligibleTasks.find((task) => matchesDutyPositionPriority(priority, {
      flightNo: task.flight.flightNo,
      position: task.rule.name,
      remark: task.rule.remark
    }));
    if (target && !ordered.includes(target)) ordered.push(target);
  }
  const latestStarts = [...new Set(state.flights.map((flight) => operationalStartMinutes(flight.startTime, state)))]
    .sort((left, right) => right - left)
    .slice(0, 2);
  for (const start of latestStarts) {
    const targets = tasks
      .filter((task) => operationalStartMinutes(task.flight.startTime, state) === start)
      .filter((task) => dutyLatePositionPriority(task.rule.name, task.rule.remark) < 4)
      .filter((task) => eligibleTasks.includes(task))
      .sort((left, right) => dutyLatePositionPriority(left.rule.name, left.rule.remark)
        - dutyLatePositionPriority(right.rule.name, right.rule.remark));
    targets.forEach((target) => { if (!ordered.includes(target)) ordered.push(target); });
  }
  return ordered;
}

export function configuredDutyTaskPriority(state: AppState, task: AssignmentTask): number {
  return state.settings.dutyPositionPriorities.findIndex((priority) => matchesDutyPositionPriority(priority, {
    flightNo: task.flight.flightNo,
    position: task.rule.name,
    remark: task.rule.remark
  }));
}

export function dutyHardConstraintReason(state: AppState, dutyStaffId: string, task: AssignmentTask): string | null {
  const person = state.staff.find((item) => item.id === dutyStaffId);
  if (!person) return "值班人员不存在";
  if (person.status !== "正常") return `${person.name}当前状态为${person.status}`;
  if (person.staffType !== "常规") return `${person.name}不是常规人员`;
  if (!task.rule.qualifiedStaffIds.includes(person.id)) return `${person.name}不在${task.flight.flightNo}/${task.rule.name}可胜任人员名单`;
  if (isNightInterval(
    task.flight.startTime,
    task.flight.endTime,
    state.settings.nightStart,
    state.settings.nightEnd
  ) && !person.nightShift) return `${person.name}不具备夜班能力`;
  return null;
}

export function preferredDutyMorningTask(state: AppState, date: string, tasks: AssignmentTask[]): AssignmentTask | undefined {
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  if (!dutyStaffId) return undefined;
  return tasks
    .filter((task) => isDutyMorningFlight(task.flight, state))
    .filter((task) => durationHours(task.flight.startTime, task.flight.endTime) <= state.settings.maxDailyHours)
    .filter((task) => eligibleStaffForRule(state, task.flight, task.rule).some((person) => person.id === dutyStaffId))
    .sort((left, right) => timeToMinutes(right.flight.startTime) - timeToMinutes(left.flight.startTime)
      || left.rule.fatiguePoints - right.rule.fatiguePoints)[0];
}

export function dutyPositionPriority(
  staffId: string,
  taskKey: string,
  dutyStaffId: string | null,
  targetTaskKeys: ReadonlySet<string>
): CandidatePriority["dutyPosition"] {
  if (!dutyStaffId || !targetTaskKeys.size || staffId !== dutyStaffId) return "unrelated";
  return targetTaskKeys.has(taskKey) ? "reserved-target" : "reserved-elsewhere";
}
