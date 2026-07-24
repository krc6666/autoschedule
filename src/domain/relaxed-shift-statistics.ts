import { getDutyRosterForDate } from "./duty-roster";
import { timeToMinutes } from "./time";
import type { AppState, Assignment, HistoryRecord, Staff } from "../model";

interface ActualTask {
  date: string;
  flightNo: string;
  staffId: string;
  staffName: string;
  startTime: string;
  endTime: string;
}

export interface EarlyDepartureEvent {
  date: string;
  flightNo: string;
  cutoffTime: string;
}

export interface MonthlyRelaxedShiftRow {
  staff: Staff;
  earlyDepartures: EarlyDepartureEvent[];
  afternoonRestDates: string[];
}

export interface MonthlyRelaxedShiftStatistics {
  month: string;
  rows: MonthlyRelaxedShiftRow[];
  currentEarlyDepartures: Array<EarlyDepartureEvent & { staffId: string; staffName: string; monthlyCount: number }>;
  currentAfternoonRest: Array<{ date: string; staffId: string; staffName: string; monthlyCount: number }>;
}

function operationalInterval(startTime: string, endTime: string, nightEnd: string): [number, number] | null {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const dayStart = timeToMinutes(nightEnd);
  if (![start, end, dayStart].every(Number.isFinite)) return null;
  const operationalStart = start < dayStart ? start + 1440 : start;
  let operationalEnd = end;
  if (operationalStart >= 1440 || operationalEnd <= operationalStart) operationalEnd += 1440;
  return [operationalStart, operationalEnd];
}

function fromAssignment(date: string, assignment: Assignment): ActualTask | null {
  if (assignment.status !== "assigned" || !assignment.staffId || !assignment.staffName || assignment.flightNo === "轮值") return null;
  return {
    date,
    flightNo: assignment.flightNo,
    staffId: assignment.staffId,
    staffName: assignment.staffName,
    startTime: assignment.startTime,
    endTime: assignment.endTime
  };
}

function fromHistory(record: HistoryRecord): ActualTask | null {
  if (!record.staffId || !record.staffName || record.flightNo === "轮值" || !record.startTime || !record.endTime) return null;
  return {
    date: record.date,
    flightNo: record.flightNo,
    staffId: record.staffId,
    staffName: record.staffName,
    startTime: record.startTime,
    endTime: record.endTime
  };
}

function uniqueTasks(tasks: ActualTask[]): ActualTask[] {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = `${task.date}\u0000${task.staffId}\u0000${task.flightNo}\u0000${task.startTime}\u0000${task.endTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dutyStaffIdForDate(state: AppState, date: string, useCurrentRoster: boolean): string | null {
  if (useCurrentRoster) return getDutyRosterForDate(state, date).dutyStaffId;
  const archived = state.history.find((record) => record.date === date && record.flightNo === "轮值" && record.position === "值班人员");
  return archived?.staffId || getDutyRosterForDate(state, date).dutyStaffId;
}

function overlapsWindow(task: ActualTask, startTime: string, endTime: string, nightEnd: string): boolean {
  const interval = operationalInterval(task.startTime, task.endTime, nightEnd);
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (!interval || ![start, end].every(Number.isFinite)) return false;
  if (end <= start) end += 1440;
  return interval[0] < end && interval[1] > start;
}

export function buildMonthlyRelaxedShiftStatistics(state: AppState, date: string): MonthlyRelaxedShiftStatistics {
  const month = date.slice(0, 7);
  const activeDate = state.activeScheduleDate === date && state.assignments.length ? date : null;
  const historyTasks = state.history
    .filter((record) => record.date.startsWith(month) && record.date !== activeDate)
    .map(fromHistory)
    .filter((task): task is ActualTask => Boolean(task));
  const activeTasks = activeDate
    ? state.assignments
      .map((assignment) => fromAssignment(activeDate, assignment))
      .filter((task): task is ActualTask => Boolean(task))
      .filter((task) => state.staff.some((person) => person.id === task.staffId && person.staffType === "常规" && person.status === "正常"))
    : [];
  const regularIds = new Set(state.staff.filter((person) => person.staffType === "常规").map((person) => person.id));
  const tasks = uniqueTasks([...historyTasks, ...activeTasks]).filter((task) => regularIds.has(task.staffId));
  const dates = [...new Set(tasks.map((task) => task.date))].sort();
  const earlyByStaff = new Map<string, EarlyDepartureEvent[]>();
  const afternoonByStaff = new Map<string, string[]>();
  const earlyCutoff = timeToMinutes(state.settings.earlyDepartureCutoffTime);

  for (const taskDate of dates) {
    const dailyTasks = tasks.filter((task) => task.date === taskDate);
    const participatingStaffIds = [...new Set(dailyTasks.map((task) => task.staffId))];
    const dutyStaffId = dutyStaffIdForDate(state, taskDate, taskDate === activeDate);
    for (const staffId of participatingStaffIds) {
      const staffTasks = dailyTasks.filter((task) => task.staffId === staffId);
      const lastTask = [...staffTasks].sort((left, right) => {
        const leftInterval = operationalInterval(left.startTime, left.endTime, state.settings.nightEnd);
        const rightInterval = operationalInterval(right.startTime, right.endTime, state.settings.nightEnd);
        return (rightInterval?.[1] ?? -1) - (leftInterval?.[1] ?? -1);
      })[0];
      const lastEnd = lastTask ? operationalInterval(lastTask.startTime, lastTask.endTime, state.settings.nightEnd)?.[1] : undefined;
      if (lastTask && staffId !== dutyStaffId && lastEnd !== undefined && Number.isFinite(earlyCutoff) && lastEnd < earlyCutoff) {
        const events = earlyByStaff.get(staffId) ?? [];
        events.push({ date: taskDate, flightNo: lastTask.flightNo, cutoffTime: lastTask.endTime });
        earlyByStaff.set(staffId, events);
      }
      if (!staffTasks.some((task) => overlapsWindow(task, state.settings.afternoonRestStartTime, state.settings.afternoonRestEndTime, state.settings.nightEnd))) {
        const restDates = afternoonByStaff.get(staffId) ?? [];
        restDates.push(taskDate);
        afternoonByStaff.set(staffId, restDates);
      }
    }
  }

  const rows = state.staff
    .filter((person) => person.staffType === "常规")
    .map((staff) => ({
      staff,
      earlyDepartures: earlyByStaff.get(staff.id) ?? [],
      afternoonRestDates: afternoonByStaff.get(staff.id) ?? []
    }));
  return {
    month,
    rows,
    currentEarlyDepartures: rows.flatMap((row) => row.earlyDepartures
      .filter((event) => event.date === date)
      .map((event) => ({ ...event, staffId: row.staff.id, staffName: row.staff.name, monthlyCount: row.earlyDepartures.length }))),
    currentAfternoonRest: rows.flatMap((row) => row.afternoonRestDates
      .filter((eventDate) => eventDate === date)
      .map((eventDate) => ({ date: eventDate, staffId: row.staff.id, staffName: row.staff.name, monthlyCount: row.afternoonRestDates.length })))
  };
}
