import type { AppState, Assignment, Flight, PositionRule, ScheduleResult, Staff } from "../model";
import { createId } from "../utils";
import { historyFatigue } from "./fatigue";
import { durationHours, intervalsOverlap, isNightInterval } from "./time";

function findRule(rules: PositionRule[], flight: Flight, position: string): PositionRule | undefined {
  return rules.find((rule) => rule.flightNo === flight.flightNo && rule.name === position);
}

function assignedHours(assignments: Assignment[], staffId: string): number {
  return assignments
    .filter((assignment) => assignment.staffId === staffId)
    .reduce((sum, assignment) => sum + assignment.workHours, 0);
}

function hasConflict(assignments: Assignment[], staffId: string, flight: Flight): boolean {
  return assignments.some((assignment) =>
    assignment.staffId === staffId
    && intervalsOverlap(assignment.startTime, assignment.endTime, flight.startTime, flight.endTime)
  );
}

function candidateScore(
  person: Staff,
  assignments: Assignment[],
  state: AppState,
  date: string
): number {
  const prior = historyFatigue(state.history, person.id, date, state.settings);
  const current = assignments
    .filter((assignment) => assignment.staffId === person.id)
    .reduce((sum, assignment) => sum + assignment.fatiguePoints, 0);
  return prior + current;
}

function makeUnfilled(flight: Flight, position: string, rule: PositionRule | undefined): Assignment {
  return {
    id: createId("assignment"),
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule?.id ?? null,
    position,
    staffId: null,
    staffName: "",
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: durationHours(flight.startTime, flight.endTime),
    fatiguePoints: rule?.fatiguePoints ?? durationHours(flight.startTime, flight.endTime),
    remark: rule?.remark ?? "未找到岗位规则",
    status: rule?.manual ? "manual" : "unfilled"
  };
}

export function generateSchedule(state: AppState, date: string): ScheduleResult {
  const assignments: Assignment[] = [];
  const warnings: string[] = [];

  const flights = [...state.flights].sort((left, right) => left.startTime.localeCompare(right.startTime));
  for (const flight of flights) {
    for (const position of flight.positions) {
      const rule = findRule(state.positionRules, flight, position);
      if (!rule || rule.manual) {
        assignments.push(makeUnfilled(flight, position, rule));
        if (!rule) warnings.push(`${flight.flightNo} / ${position} 缺少岗位规则`);
        continue;
      }

      const hours = durationHours(flight.startTime, flight.endTime);
      const candidates = state.staff
        .filter((person) => person.status === "正常")
        .filter((person) => rule.qualifiedStaffIds.includes(person.id))
        .filter((person) => !isNightInterval(flight.startTime, flight.endTime, state.settings.nightStart, state.settings.nightEnd) || person.nightShift)
        .filter((person) => !hasConflict(assignments, person.id, flight))
        .filter((person) => assignedHours(assignments, person.id) + hours <= state.settings.maxDailyHours)
        .sort((left, right) => candidateScore(left, assignments, state, date) - candidateScore(right, assignments, state, date)
          || Number(left.id) - Number(right.id));

      const selected = candidates[0];
      if (!selected) {
        assignments.push(makeUnfilled(flight, position, rule));
        warnings.push(`${flight.flightNo} / ${position} 无可用人员`);
        continue;
      }

      assignments.push({
        id: createId("assignment"),
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: rule.id,
        position,
        staffId: selected.id,
        staffName: selected.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: hours,
        fatiguePoints: rule.fatiguePoints,
        remark: rule.remark,
        status: "assigned"
      });
    }
  }

  return {
    assignments,
    unfilledCount: assignments.filter((assignment) => assignment.status !== "assigned").length,
    warnings: [...new Set(warnings)]
  };
}

export function canAssignStaff(state: AppState, assignmentId: string, staffId: string): string | null {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const person = state.staff.find((item) => item.id === staffId);
  if (!assignment || !person) return "人员或岗位不存在";
  if (person.status !== "正常") return `${person.name} 当前状态为${person.status}`;
  const rule = assignment.positionRuleId
    ? state.positionRules.find((item) => item.id === assignment.positionRuleId)
    : undefined;
  if (rule && !rule.manual && !rule.qualifiedStaffIds.includes(person.id)) return `${person.name} 不具备该岗位资质`;
  if (isNightInterval(assignment.startTime, assignment.endTime, state.settings.nightStart, state.settings.nightEnd) && !person.nightShift) {
    return `${person.name} 不可上夜班`;
  }
  const others = state.assignments.filter((item) => item.id !== assignmentId && item.staffId === staffId);
  if (others.some((item) => intervalsOverlap(item.startTime, item.endTime, assignment.startTime, assignment.endTime))) {
    return `${person.name} 在该时段已有排班`;
  }
  if (assignedHours(others, staffId) + assignment.workHours > state.settings.maxDailyHours) {
    return `${person.name} 将超过每日 ${state.settings.maxDailyHours} 小时上限`;
  }
  return null;
}
