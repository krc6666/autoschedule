import type { AppState, Assignment, Flight, PositionRule, Staff } from "../model";
import { recentHistory } from "./fatigue";
import { getDutyRosterForDate } from "./duty-roster";
import { durationHours, isNightInterval, timeToMinutes } from "./time";

export type WorkloadPressure = "宽松" | "紧张" | "密集";

export interface WorkloadTask {
  flight: Flight;
  rule: PositionRule;
  eligibleStaffIds: string[];
}

export interface WorkloadBalanceMetrics {
  enabled: boolean;
  pressure: WorkloadPressure;
  peakConcurrentPositions: number;
  peakEligibleStaff: number;
  peakStaffingRatio: number;
  scheduledHours: number;
  capacityHours: number;
  utilization: number;
  workHoursDifference: number;
  rollingWorkHoursDifference: number;
  todayFatigueDifference: number;
  withinConfiguredTargets: boolean;
  shortageTasks: number;
  summary: string;
}

function operationalRange(flight: Pick<Flight, "startTime" | "endTime">): [number, number] | null {
  const start = timeToMinutes(flight.startTime);
  let end = timeToMinutes(flight.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end <= start) end += 24 * 60;
  return [start, end];
}

function activeRules(state: AppState, flight: Flight): PositionRule[] {
  const flightRules = state.positionRules.filter((rule) => rule.flightNo === flight.flightNo);
  const administrativeNames = new Set(flightRules
    .filter((rule) => rule.category === "行政支援")
    .map((rule) => rule.name.trim()));
  const configured = state.settings.adminSupportEnabled
    ? flightRules.filter((rule) => rule.category === "行政支援" || !administrativeNames.has(rule.name.trim()))
    : flightRules.filter((rule) => rule.category !== "行政支援");
  const preNoon = timeToMinutes(flight.startTime) < 12 * 60;
  return configured.filter((rule) => rule.category !== "引导"
    && (!rule.manual || (preNoon && rule.category === "常规")));
}

function eligibleStaff(state: AppState, flight: Flight, rule: PositionRule): Staff[] {
  return state.staff
    .filter((person) => person.status === "正常" && person.staffType === "常规")
    .filter((person) => rule.qualifiedStaffIds.includes(person.id))
    .filter((person) => !isNightInterval(flight.startTime, flight.endTime, state.settings.nightStart, state.settings.nightEnd) || person.nightShift);
}

export function buildWorkloadTasks(state: AppState): WorkloadTask[] {
  return state.flights.flatMap((flight) => activeRules(state, flight)
    .filter((rule) => (timeToMinutes(flight.startTime) < 12 * 60 && rule.category === "常规")
      || (rule.minPassengers ?? 0) <= flight.bookedPassengers)
    .map((rule) => ({
      flight,
      rule,
      eligibleStaffIds: eligibleStaff(state, flight, rule).map((person) => person.id)
    })));
}

function peakPressure(tasks: WorkloadTask[]): { demand: number; eligible: number; ratio: number } {
  const ranges = tasks.map((task) => ({ task, range: operationalRange(task.flight) })).filter((item): item is { task: WorkloadTask; range: [number, number] } => Boolean(item.range));
  const points = [...new Set(ranges.flatMap(({ range }) => range))].sort((left, right) => left - right);
  let peakDemand = 0;
  let peakEligible = 0;
  let peakRatio = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const midpoint = (points[index]! + points[index + 1]!) / 2;
    const active = ranges.filter(({ range }) => midpoint >= range[0] && midpoint < range[1]).map(({ task }) => task);
    if (!active.length) continue;
    const eligible = new Set(active.flatMap((task) => task.eligibleStaffIds));
    const ratio = eligible.size ? active.length / eligible.size : Number.POSITIVE_INFINITY;
    peakDemand = Math.max(peakDemand, active.length);
    peakEligible = Math.max(peakEligible, eligible.size);
    peakRatio = Math.max(peakRatio, ratio);
  }
  return { demand: peakDemand, eligible: peakEligible, ratio: peakRatio };
}

export function analyzeWorkloadPressure(state: AppState, tasks = buildWorkloadTasks(state)): Pick<WorkloadBalanceMetrics, "pressure" | "peakConcurrentPositions" | "peakEligibleStaff" | "peakStaffingRatio" | "scheduledHours" | "capacityHours" | "utilization" | "shortageTasks"> {
  const regular = state.staff.filter((person) => person.status === "正常" && person.staffType === "常规");
  const scheduledHours = tasks.reduce((sum, task) => sum + durationHours(task.flight.startTime, task.flight.endTime), 0);
  const capacityHours = regular.length * state.settings.maxDailyHours;
  const utilization = capacityHours > 0 ? scheduledHours / capacityHours : (scheduledHours ? Number.POSITIVE_INFINITY : 0);
  const peak = peakPressure(tasks);
  const shortageTasks = tasks.filter((task) => task.eligibleStaffIds.length === 0).length;
  const pressure: WorkloadPressure = shortageTasks > 0 || peak.ratio >= 0.9 || utilization >= 0.75
    ? "密集"
    : peak.ratio >= 0.6 || utilization >= 0.45
      ? "紧张"
      : "宽松";
  return {
    pressure,
    peakConcurrentPositions: peak.demand,
    peakEligibleStaff: peak.eligible,
    peakStaffingRatio: peak.ratio,
    scheduledHours,
    capacityHours,
    utilization,
    shortageTasks
  };
}

interface LoadSnapshot {
  id: string;
  todayHours: number;
  rollingHours: number;
  todayFatigue: number;
}

function snapshots(state: AppState, assignments: Assignment[], date: string, dutyStaffId: string | null): LoadSnapshot[] {
  const history = recentHistory(state.history, date, state.settings.historyWindowDays);
  return state.staff
    .filter((person) => person.status === "正常" && person.staffType === "常规")
    .map((person) => ({
      id: person.id,
      todayHours: assignments.filter((assignment) => assignment.staffId === person.id && assignment.status === "assigned").reduce((sum, assignment) => sum + assignment.workHours, 0),
      rollingHours: history.filter((record) => record.staffId === person.id).reduce((sum, record) => sum + record.workHours, 0),
      todayFatigue: assignments.filter((assignment) => assignment.staffId === person.id && assignment.status === "assigned").reduce((sum, assignment) => sum + assignment.fatiguePoints, 0)
        + (person.id === dutyStaffId ? state.settings.dutyFatiguePoints : 0)
    }));
}

export function evaluateWorkloadBalance(state: AppState, date: string, assignments = state.assignments): WorkloadBalanceMetrics {
  const pressure = analyzeWorkloadPressure(state);
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  const loads = snapshots(state, assignments, date, dutyStaffId);
  const workHours = loads.map((load) => load.todayHours);
  const rollingHours = loads.map((load) => load.todayHours + load.rollingHours);
  const todayFatigue = loads.map((load) => load.todayFatigue);
  const difference = (values: number[]): number => values.length ? Math.max(...values) - Math.min(...values) : 0;
  const workHoursDifference = difference(workHours);
  const rollingWorkHoursDifference = difference(rollingHours);
  const todayFatigueDifference = difference(todayFatigue);
  const withinConfiguredTargets = workHoursDifference <= state.settings.maxWorkHoursDifference
    && rollingWorkHoursDifference <= state.settings.maxWorkHoursDifference + state.settings.historyWindowDays
    && todayFatigueDifference <= state.settings.maxTodayFatigueDifference;
  const enabled = state.settings.workloadBalanceEnabled;
  const summary = !enabled
    ? "工时均衡已停用"
    : `${pressure.pressure}：当日工时差 ${workHoursDifference.toFixed(1)} 小时，滚动工时差 ${rollingWorkHoursDifference.toFixed(1)} 小时，疲劳差 ${todayFatigueDifference.toFixed(1)} 点`;
  return { enabled, ...pressure, workHoursDifference, rollingWorkHoursDifference, todayFatigueDifference, withinConfiguredTargets, summary };
}

export function workloadBalanceCost(
  person: Staff,
  assignments: Assignment[],
  state: AppState,
  targetHours: number,
  targetFatigue: number,
  dutyStaffId: string | null,
  date: string,
  pressure = analyzeWorkloadPressure(state)
): number {
  if (!state.settings.workloadBalanceEnabled) return 0;
  const loads = snapshots(state, assignments, date, dutyStaffId);
  const current = loads.find((load) => load.id === person.id);
  if (!current || !loads.length) return 0;
  if (pressure.pressure === "宽松" || state.flights.length < 4) {
    const nextToday = current.todayHours + targetHours;
    const nextRolling = current.rollingHours + current.todayHours + targetHours;
    const minimumToday = Math.min(...loads.map((load) => load.todayHours));
    const minimumRolling = Math.min(...loads.map((load) => load.rollingHours + load.todayHours));
    const todayExcess = Math.max(0, nextToday - minimumToday);
    const rollingExcess = Math.max(0, nextRolling - minimumRolling);
    const configuredHoursTarget = Math.max(0.5, state.settings.maxWorkHoursDifference);
    const rollingTarget = configuredHoursTarget + Math.max(0, state.settings.historyWindowDays / 2);
    return (Math.max(0, todayExcess - configuredHoursTarget) / configuredHoursTarget
      + Math.max(0, rollingExcess - rollingTarget) / rollingTarget) * 10000;
  }
  const intensity = pressure.pressure === "密集" ? 4 : pressure.pressure === "紧张" ? 1.5 : 0.35;
  const configuredHoursTarget = Math.max(0.5, state.settings.maxWorkHoursDifference);
  const rollingTarget = configuredHoursTarget + Math.max(0, state.settings.historyWindowDays / 2);
  const configuredFatigueTarget = Math.max(0.5, state.settings.maxTodayFatigueDifference);
  const projected = loads.map((load) => ({
    today: load.todayHours + (load.id === person.id ? targetHours : 0),
    rolling: load.rollingHours + load.todayHours + (load.id === person.id ? targetHours : 0),
    fatigue: load.todayFatigue + (load.id === person.id ? targetFatigue : 0)
  }));
  const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
  const todaySpread = spread(projected.map((load) => load.today));
  const rollingSpread = spread(projected.map((load) => load.rolling));
  const fatigueSpread = spread(projected.map((load) => load.fatigue));
  const hardExcess = Math.max(0, todaySpread - configuredHoursTarget) / configuredHoursTarget
    + Math.max(0, rollingSpread - rollingTarget) / rollingTarget
    + Math.max(0, fatigueSpread - configuredFatigueTarget) / configuredFatigueTarget;
  return hardExcess * 10000 * intensity
    + (todaySpread / configuredHoursTarget
      + rollingSpread / rollingTarget
      + fatigueSpread / configuredFatigueTarget * (pressure.pressure === "密集" ? 1.5 : 1)) * intensity;
}
