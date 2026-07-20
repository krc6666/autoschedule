import type { AppState, Assignment, HistoryRecord } from "../model";
import { buildStaffLoads, recentHistory } from "./fatigue";
import { dutyFatigueByStaff, getDutyRosterForDate, getMonthlyDutyRosterStats } from "./duty-roster";
import { dutyLatePositionPriority, isHighLoadPosition, isInFinalLateBatch } from "./scheduler";
import { timeToMinutes } from "./time";

export type ScheduleFeedbackLevel = "ok" | "attention" | "info";

export interface ScheduleFeedbackItem {
  key: "coverage" | "fatigue" | "connections" | "high-load" | "previous-late" | "duty-roster";
  label: string;
  level: ScheduleFeedbackLevel;
  text: string;
}

interface TimedAssignment {
  assignment: Assignment;
  start: number;
  end: number;
}

interface Connection {
  previous: Assignment;
  next: Assignment;
  gap: number;
}

function conciseNames(names: string[]): string {
  const unique = [...new Set(names)];
  return unique.length <= 3 ? unique.join("、") : `${unique.slice(0, 3).join("、")}等 ${unique.length} 人`;
}

function timedAssignments(state: AppState): TimedAssignment[] {
  const nightEnd = timeToMinutes(state.settings.nightEnd);
  return state.assignments
    .filter((assignment) => assignment.status === "assigned" && assignment.staffId && assignment.workHours > 0)
    .map((assignment) => {
      const rawStart = timeToMinutes(assignment.startTime);
      const rawEnd = timeToMinutes(assignment.endTime);
      let start = rawStart;
      let end = rawEnd <= rawStart ? rawEnd + 24 * 60 : rawEnd;
      if (rawStart < nightEnd) {
        start += 24 * 60;
        end += 24 * 60;
      }
      return { assignment, start, end };
    })
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end));
}

function staffConnections(state: AppState): Connection[] {
  const timed = timedAssignments(state);
  const staffIds = [...new Set(timed.map((item) => item.assignment.staffId).filter((staffId): staffId is string => Boolean(staffId)))];
  return staffIds.flatMap((staffId) => {
    const own = timed.filter((item) => item.assignment.staffId === staffId).sort((left, right) => left.start - right.start);
    return own.slice(1).map((item, index) => ({
      previous: own[index]!.assignment,
      next: item.assignment,
      gap: item.start - own[index]!.end
    })).filter((connection) => connection.previous.flightId !== connection.next.flightId);
  });
}

function matchesTransitionPolicy(state: AppState, connection: Connection): boolean {
  const normalize = (value: string): string => value.trim().toUpperCase();
  return state.settings.positionTransitionPolicies.some((policy) => policy.enabled
    && normalize(policy.targetFlightNo) === normalize(connection.next.flightNo)
    && normalize(policy.targetPosition) === normalize(connection.next.position)
    && (!policy.sourceFlightNo.trim() || normalize(policy.sourceFlightNo) === normalize(connection.previous.flightNo))
    && (!policy.sourcePositions.length || policy.sourcePositions.some((position) => normalize(position) === normalize(connection.previous.position)))
    && connection.gap < policy.minimumGapMinutes);
}

function coverageFeedback(state: AppState, date: string): ScheduleFeedbackItem {
  const workers = state.staff.filter((person) => person.staffType === "常规" && person.status === "正常");
  const loads = buildStaffLoads(workers, state.assignments, state.history, date, state.settings, dutyFatigueByStaff(state, date));
  const unworked = loads.filter((load) => load.workHours <= 0).map((load) => load.staff.name);
  const unfilled = state.assignments.filter((assignment) => {
    if (assignment.status !== "unfilled") return false;
    const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
    return rule?.category !== "引导" && rule?.category !== "行政支援";
  }).length;
  if (unworked.length || unfilled) {
    const details = [unworked.length ? `${conciseNames(unworked)}为 0 工时` : "", unfilled ? `${unfilled} 个常规岗位待补位` : ""].filter(Boolean).join("；");
    return { key: "coverage", label: "人员覆盖", level: "attention", text: `${details}，需要人工复核。` };
  }
  return { key: "coverage", label: "人员覆盖", level: "ok", text: `${workers.length} 名正常常规人员均有实际工时，常规岗位无待补位。` };
}

function fatigueFeedback(state: AppState, date: string): ScheduleFeedbackItem {
  const workers = state.staff.filter((person) => person.staffType === "常规" && person.status === "正常");
  const loads = buildStaffLoads(workers, state.assignments, state.history, date, state.settings, dutyFatigueByStaff(state, date));
  if (!loads.length) return { key: "fatigue", label: "疲劳分布", level: "info", text: "暂无正常常规人员可统计。" };
  const highest = [...loads].sort((left, right) => right.totalFatigue - left.totalFatigue)[0]!;
  const average = loads.reduce((sum, load) => sum + load.todayFatigue, 0) / loads.length;
  return {
    key: "fatigue",
    label: "疲劳分布",
    level: highest.totalFatigue >= 20 ? "attention" : "ok",
    text: `总疲劳最高为${highest.staff.name} ${highest.totalFatigue.toFixed(1)} 点，当日平均 ${average.toFixed(1)} 点。`
  };
}

function connectionFeedback(state: AppState): ScheduleFeedbackItem {
  const connections = staffConnections(state);
  if (!connections.length) return { key: "connections", label: "航班衔接", level: "ok", text: "未发生同一人员跨航班连续任务。" };
  const overlap = connections.find((connection) => connection.gap < 0);
  const policyViolation = connections.find((connection) => matchesTransitionPolicy(state, connection));
  const tightest = [...connections].sort((left, right) => left.gap - right.gap)[0]!;
  const personName = (connection: Connection): string => state.staff.find((person) => person.id === connection.next.staffId)?.name ?? connection.next.staffName;
  const route = (connection: Connection): string => `${connection.previous.flightNo}→${connection.next.flightNo}`;
  if (overlap) return { key: "connections", label: "航班衔接", level: "attention", text: `${personName(overlap)}的 ${route(overlap)} 时间重叠，无法正常衔接。` };
  if (policyViolation) return { key: "connections", label: "航班衔接", level: "attention", text: `${personName(policyViolation)}的 ${route(policyViolation)} 间隔仅 ${policyViolation.gap} 分钟，未达到已配置的岗位衔接要求。` };
  if (tightest.gap < 30) return { key: "connections", label: "航班衔接", level: "attention", text: `${personName(tightest)}的 ${route(tightest)} 间隔仅 ${tightest.gap} 分钟，现场衔接可能紧张。` };
  return { key: "connections", label: "航班衔接", level: "ok", text: `未发现衔接冲突，最短跨航班间隔为 ${tightest.gap} 分钟。` };
}

function highLoadFeedback(state: AppState): ScheduleFeedbackItem {
  const highLoadAssignments = timedAssignments(state).filter((item) => isHighLoadPosition(item.assignment.fatiguePoints, item.assignment.remark, state));
  if (!state.settings.highLoadProtectionEnabled) {
    return { key: "high-load", label: "连续高负荷", level: "info", text: `高负荷衔接保护已停用；当前有 ${highLoadAssignments.length} 个高负荷岗位。` };
  }
  const staffIds = [...new Set(highLoadAssignments.map((item) => item.assignment.staffId))];
  const repeated = staffIds.flatMap((staffId) => {
    const own = highLoadAssignments.filter((item) => item.assignment.staffId === staffId).sort((left, right) => left.start - right.start);
    return own.slice(1).filter((item, index) => item.start - own[index]!.end <= state.settings.highLoadRecoveryMinutes).map((item) => item.assignment.staffName);
  });
  if (repeated.length) {
    return { key: "high-load", label: "连续高负荷", level: "attention", text: `${conciseNames(repeated)}在恢复期内连续承担高负荷岗位，属于人手不足兜底或人工调整，建议复核。` };
  }
  return { key: "high-load", label: "连续高负荷", level: "ok", text: `${highLoadAssignments.length} 个高负荷岗位均未由同一人员在恢复期内连续承担。` };
}

function previousLateFeedback(state: AppState, date: string): ScheduleFeedbackItem {
  const recent = recentHistory(state.history, date, 3);
  const previousDate = recent.map((record) => record.date).sort().at(-1);
  if (!previousDate) return { key: "previous-late", label: "上一工作日晚班", level: "info", text: "暂无最近工作日归档，无法核对跨工作日晚班减负。" };
  const previousDay = recent.filter((record) => record.date === previousDate);
  const protectedRecords = previousDay
    .filter((record) => isInFinalLateBatch(record, previousDay, state))
    .filter((record) => isHighLoadPosition(record.fatiguePoints, record.remark, state));
  const protectedIds = [...new Set(protectedRecords.map((record) => record.staffId))];
  if (!protectedIds.length) return { key: "previous-late", label: "上一工作日晚班", level: "ok", text: `${previousDate} 最后一批晚班没有高负荷人员需要跨工作日保护。` };
  const currentLate = state.assignments
    .filter((assignment) => assignment.status === "assigned" && assignment.staffId && assignment.workHours > 0)
    .filter((assignment) => isInFinalLateBatch(assignment, state.flights, state));
  const violations = currentLate.filter((assignment) => protectedIds.includes(assignment.staffId!)
    && assignment.fatiguePoints > state.settings.nextDayLateMaxFatigue);
  if (violations.length) {
    const details = violations.map((assignment) => `${assignment.staffName} ${assignment.flightNo}/${assignment.position}`).join("、");
    return { key: "previous-late", label: "上一工作日晚班", level: "attention", text: `${details}仍承担末班高负荷岗位，超过 ${state.settings.nextDayLateMaxFatigue} 点，建议复核。` };
  }
  const names = protectedRecords.map((record: HistoryRecord) => record.staffName);
  return { key: "previous-late", label: "上一工作日晚班", level: "ok", text: `${previousDate} 的${conciseNames(names)}本次均未承担超过 ${state.settings.nextDayLateMaxFatigue} 点的末班岗位，减负规则已落实。` };
}

function operationalStart(startTime: string, state: AppState): number {
  const start = timeToMinutes(startTime);
  const nightEnd = timeToMinutes(state.settings.nightEnd);
  return start < nightEnd ? start + 24 * 60 : start;
}

function staffName(state: AppState, staffId: string | null): string {
  return staffId ? state.staff.find((person) => person.id === staffId)?.name ?? `#${staffId}` : "未配置";
}

function assignmentSummary(state: AppState, staffId: string | null): string {
  if (!staffId) return "未配置";
  const latest = state.assignments
    .filter((assignment) => assignment.staffId === staffId && assignment.status === "assigned" && assignment.workHours > 0)
    .sort((left, right) => operationalStart(right.startTime, state) - operationalStart(left.startTime, state))[0];
  return latest ? `${latest.flightNo}/${latest.position}` : "未安排实际岗位";
}

function dutyRosterFeedback(state: AppState, date: string): ScheduleFeedbackItem {
  const roster = getDutyRosterForDate(state, date);
  const rosterIds = [roster.cxPreflightStaffId, roster.dutyStaffId, ...roster.standbyStaffIds].filter((id): id is string => Boolean(id));
  const cxName = staffName(state, roster.cxPreflightStaffId);
  const dutyName = staffName(state, roster.dutyStaffId);
  const dutyDescription = `值班${dutyName}（+${state.settings.dutyFatiguePoints} 点疲劳）`;
  const standbyAssignments = roster.standbyStaffIds.map((staffId) => ({ name: staffName(state, staffId), summary: assignmentSummary(state, staffId) }));
  const standbyDetails = standbyAssignments.map((item) => `${item.name}（${item.summary}）`).join("、");
  const standbyMissingWork = standbyAssignments.filter((item) => item.summary === "未安排实际岗位").map((item) => item.name);
  const monthlyStats = getMonthlyDutyRosterStats(state, date).filter((item) => item.staff.dutyQualified);
  const monthlyMissing = monthlyStats.filter((item) => item.dutyDates.length === 0);
  const monthlyRepeated = monthlyStats.filter((item) => item.dutyDates.length > 1);
  const monthlyDutyNote = monthlyMissing.length && monthlyRepeated.length
    ? ` 月度值班需纠偏：${monthlyMissing.map((item) => `${item.staff.name} 0 次`).join("、")}；${monthlyRepeated.map((item) => `${item.staff.name} ${item.dutyDates.length} 次`).join("、")}。`
    : "";
  if (rosterIds.length < 4 || new Set(rosterIds).size !== rosterIds.length) {
    return { key: "duty-roster", label: "轮值安排", level: "attention", text: `CX航前${cxName}；${dutyDescription}；备勤${standbyDetails}。四个人选未完整配置或发生重合，需要调整。${monthlyDutyNote}` };
  }
  const dutyAssignments = state.assignments.filter((assignment) => assignment.staffId === roster.dutyStaffId && assignment.status === "assigned" && assignment.workHours > 0);
  if (!state.flights.length || !dutyAssignments.length) {
    return { key: "duty-roster", label: "轮值安排", level: "attention", text: `CX航前${cxName}；${dutyDescription}未安排实际航班岗位；备勤${standbyDetails}。需要复核值班人员的最晚航班安排。${monthlyDutyNote}` };
  }
  const latestStart = Math.max(...state.flights.map((flight) => operationalStart(flight.startTime, state)));
  const latestDutyAssignments = dutyAssignments.filter((assignment) => operationalStart(assignment.startTime, state) === latestStart);
  const preferred = [...latestDutyAssignments]
    .filter((assignment) => dutyLatePositionPriority(assignment.position, assignment.remark) < 4)
    .sort((left, right) => dutyLatePositionPriority(left.position, left.remark) - dutyLatePositionPriority(right.position, right.remark))[0];
  if (preferred) {
    const standbyNote = standbyMissingWork.length ? `；${conciseNames(standbyMissingWork)}作为备勤但未安排实际岗位，需要复核` : "";
    return { key: "duty-roster", label: "轮值安排", level: standbyMissingWork.length || Boolean(monthlyDutyNote) ? "attention" : "ok", text: `CX航前${cxName}；${dutyDescription}安排在最晚航班 ${preferred.flightNo}/${preferred.position}，符合晚撤岗位优先；备勤${standbyDetails}${standbyNote}。${monthlyDutyNote}` };
  }
  const latestDuty = latestDutyAssignments[0];
  if (latestDuty) {
    return { key: "duty-roster", label: "轮值安排", level: "attention", text: `CX航前${cxName}；${dutyDescription}虽在最晚航班 ${latestDuty.flightNo}/${latestDuty.position}，但未落在一号、督导、申报或送资料岗位；备勤${standbyDetails}。${monthlyDutyNote}` };
  }
  const lastDuty = [...dutyAssignments].sort((left, right) => operationalStart(right.startTime, state) - operationalStart(left.startTime, state))[0]!;
  return { key: "duty-roster", label: "轮值安排", level: "attention", text: `CX航前${cxName}；${dutyDescription}最晚只排到 ${lastDuty.flightNo}/${lastDuty.position}，未进入当日最晚航班；备勤${standbyDetails}。${monthlyDutyNote}` };
}

export function buildScheduleFeedback(state: AppState, date: string): ScheduleFeedbackItem[] {
  return [
    coverageFeedback(state, date),
    fatigueFeedback(state, date),
    connectionFeedback(state),
    highLoadFeedback(state),
    previousLateFeedback(state, date),
    dutyRosterFeedback(state, date)
  ];
}
