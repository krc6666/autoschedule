import type { AppState, Assignment, HistoryRecord } from "../model";
import { buildStaffLoads, recentHistory } from "./fatigue";
import { dutyFatigueByStaff, getDutyRosterForDate, getMonthlyDutyRoster, getMonthlyDutyRosterStats } from "./duty-roster";
import { dutyLatePositionPriority, isDutyMorningFlight, isHighLoadPosition, isInFinalLateBatch } from "./scheduler";
import { timeToMinutes } from "./time";

export type ScheduleFeedbackLevel = "ok" | "attention" | "info";
export type ScheduleFeedbackGroup = "flight-staff" | "rule-execution";
export type ScheduleFeedbackStatus = "已执行" | "需复核" | "无基准";

export interface ScheduleFeedbackItem {
  key: "coverage" | "fatigue" | "connections" | "high-load" | "previous-late" | "duty-roster";
  group: ScheduleFeedbackGroup;
  label: string;
  level: ScheduleFeedbackLevel;
  status: ScheduleFeedbackStatus;
  evidence: string;
  text: string;
}

function feedbackItem(
  group: ScheduleFeedbackGroup,
  key: ScheduleFeedbackItem["key"],
  label: string,
  level: ScheduleFeedbackLevel,
  text: string
): ScheduleFeedbackItem {
  const status: ScheduleFeedbackStatus = level === "ok" ? "已执行" : level === "attention" ? "需复核" : "无基准";
  return { group, key, label, level, status, evidence: text, text };
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

function flightDensityEvidence(state: AppState): string {
  if (!state.flights.length) return "当天无航班";
  if (state.flights.length === 1) return "当天 1 个航班，无相邻航班密集区间";
  const starts = state.flights.map((flight) => operationalStart(flight.startTime, state)).sort((left, right) => left - right);
  const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
  const densePairs = gaps.filter((gap) => gap <= 120).length;
  const minimumGap = Math.min(...gaps);
  return `当天 ${state.flights.length} 个航班，${densePairs} 组相邻航班起飞间隔不超过 120 分钟，最短 ${minimumGap} 分钟`;
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
  const density = flightDensityEvidence(state);
  if (unworked.length || unfilled) {
    const details = [unworked.length ? `${conciseNames(unworked)}为 0 工时` : "", unfilled ? `${unfilled} 个常规岗位待补位` : ""].filter(Boolean).join("；");
    return feedbackItem("flight-staff", "coverage", "人员覆盖", "attention", `${density}；${details}，需要人工复核。`);
  }
  return feedbackItem("flight-staff", "coverage", "人员覆盖", "ok", `${density}；${workers.length} 名正常常规人员均有实际工时，常规岗位无待补位。`);
}

function fatigueFeedback(state: AppState, date: string): ScheduleFeedbackItem {
  const workers = state.staff.filter((person) => person.staffType === "常规" && person.status === "正常");
  const loads = buildStaffLoads(workers, state.assignments, state.history, date, state.settings, dutyFatigueByStaff(state, date));
  if (!loads.length) return feedbackItem("flight-staff", "fatigue", "负荷均衡", "info", "暂无正常常规人员，无法形成工时与疲劳均衡基准。");
  const byHours = [...loads].sort((left, right) => left.workHours - right.workHours);
  const byTodayFatigue = [...loads].sort((left, right) => left.todayFatigue - right.todayFatigue);
  const highestTotal = [...loads].sort((left, right) => right.totalFatigue - left.totalFatigue)[0]!;
  const lowestHours = byHours[0]!;
  const highestHours = byHours.at(-1)!;
  const lowestTodayFatigue = byTodayFatigue[0]!;
  const highestTodayFatigue = byTodayFatigue.at(-1)!;
  const hoursDifference = highestHours.workHours - lowestHours.workHours;
  const fatigueDifference = highestTodayFatigue.todayFatigue - lowestTodayFatigue.todayFatigue;
  const exceeded = state.settings.workloadBalanceEnabled
    && (hoursDifference > state.settings.maxWorkHoursDifference || fatigueDifference > state.settings.maxTodayFatigueDifference);
  const target = state.settings.workloadBalanceEnabled
    ? `规则目标为工时差不超过 ${state.settings.maxWorkHoursDifference.toFixed(1)} 小时、当日疲劳差不超过 ${state.settings.maxTodayFatigueDifference.toFixed(1)} 点`
    : "当日负荷均衡规则已停用";
  const evidence = `工时差 ${hoursDifference.toFixed(1)} 小时（${lowestHours.staff.name} ${lowestHours.workHours.toFixed(1)}h，${highestHours.staff.name} ${highestHours.workHours.toFixed(1)}h）；当日疲劳差 ${fatigueDifference.toFixed(1)} 点（${lowestTodayFatigue.staff.name} ${lowestTodayFatigue.todayFatigue.toFixed(1)}，${highestTodayFatigue.staff.name} ${highestTodayFatigue.todayFatigue.toFixed(1)}）；总疲劳最高为${highestTotal.staff.name} ${highestTotal.totalFatigue.toFixed(1)} 点。${target}。`;
  return feedbackItem("flight-staff", "fatigue", "负荷均衡", state.settings.workloadBalanceEnabled ? (exceeded ? "attention" : "ok") : "info", evidence);
}

function connectionFeedback(state: AppState): ScheduleFeedbackItem {
  const connections = staffConnections(state);
  if (!connections.length) return feedbackItem("flight-staff", "connections", "航班衔接", "ok", "未发生同一人员跨航班连续任务。");
  const overlap = connections.find((connection) => connection.gap < 0);
  const policyViolation = connections.find((connection) => matchesTransitionPolicy(state, connection));
  const tightest = [...connections].sort((left, right) => left.gap - right.gap)[0]!;
  const personName = (connection: Connection): string => state.staff.find((person) => person.id === connection.next.staffId)?.name ?? connection.next.staffName;
  const route = (connection: Connection): string => `${connection.previous.flightNo}→${connection.next.flightNo}`;
  if (overlap) return feedbackItem("flight-staff", "connections", "航班衔接", "attention", `${personName(overlap)}的 ${route(overlap)} 时间重叠，无法正常衔接。`);
  if (policyViolation) return feedbackItem("flight-staff", "connections", "航班衔接", "attention", `${personName(policyViolation)}的 ${route(policyViolation)} 间隔仅 ${policyViolation.gap} 分钟，未达到已配置的岗位衔接要求。`);
  if (tightest.gap < 30) return feedbackItem("flight-staff", "connections", "航班衔接", "attention", `${personName(tightest)}的 ${route(tightest)} 间隔仅 ${tightest.gap} 分钟，现场衔接可能紧张。`);
  return feedbackItem("flight-staff", "connections", "航班衔接", "ok", `未发现衔接冲突，最短跨航班间隔为 ${tightest.gap} 分钟。`);
}

function highLoadFeedback(state: AppState): ScheduleFeedbackItem {
  const highLoadAssignments = timedAssignments(state).filter((item) => isHighLoadPosition(item.assignment.fatiguePoints, item.assignment.remark, state));
  if (!state.settings.highLoadProtectionEnabled) {
    return feedbackItem("rule-execution", "high-load", "连续高负荷", "info", `高负荷衔接保护已停用；当前有 ${highLoadAssignments.length} 个高负荷岗位，无法判断该保护规则是否执行。`);
  }
  const staffIds = [...new Set(highLoadAssignments.map((item) => item.assignment.staffId))];
  const repeated = staffIds.flatMap((staffId) => {
    const own = highLoadAssignments.filter((item) => item.assignment.staffId === staffId).sort((left, right) => left.start - right.start);
    return own.slice(1).filter((item, index) => item.start - own[index]!.end <= state.settings.highLoadRecoveryMinutes).map((item) => item.assignment.staffName);
  });
  if (repeated.length) {
    return feedbackItem("rule-execution", "high-load", "连续高负荷", "attention", `${conciseNames(repeated)}在 ${state.settings.highLoadRecoveryMinutes} 分钟恢复期内连续承担高负荷岗位，属于人手不足兜底或人工调整，建议复核。`);
  }
  return feedbackItem("rule-execution", "high-load", "连续高负荷", "ok", `${highLoadAssignments.length} 个高负荷岗位均未由同一人员在 ${state.settings.highLoadRecoveryMinutes} 分钟恢复期内连续承担。`);
}

function previousLateFeedback(state: AppState, date: string): ScheduleFeedbackItem {
  const recent = recentHistory(state.history, date, 3);
  const previousDate = recent.map((record) => record.date).sort().at(-1);
  if (!previousDate) return feedbackItem("rule-execution", "previous-late", "上一工作日晚班", "info", "暂无最近工作日归档，无法核对跨工作日晚班减负。");
  const previousDay = recent.filter((record) => record.date === previousDate);
  const protectedRecords = previousDay
    .filter((record) => isInFinalLateBatch(record, previousDay, state))
    .filter((record) => isHighLoadPosition(record.fatiguePoints, record.remark, state));
  const protectedIds = [...new Set(protectedRecords.map((record) => record.staffId))];
  if (!protectedIds.length) return feedbackItem("rule-execution", "previous-late", "上一工作日晚班", "ok", `${previousDate} 最后一批晚班没有高负荷人员需要跨工作日保护。`);
  const currentLate = state.assignments
    .filter((assignment) => assignment.status === "assigned" && assignment.staffId && assignment.workHours > 0)
    .filter((assignment) => isInFinalLateBatch(assignment, state.flights, state));
  const violations = currentLate.filter((assignment) => protectedIds.includes(assignment.staffId!)
    && assignment.fatiguePoints > state.settings.nextDayLateMaxFatigue);
  if (violations.length) {
    const details = violations.map((assignment) => `${assignment.staffName} ${assignment.flightNo}/${assignment.position}`).join("、");
    return feedbackItem("rule-execution", "previous-late", "上一工作日晚班", "attention", `${details}仍承担末班高负荷岗位，超过 ${state.settings.nextDayLateMaxFatigue} 点，建议复核。`);
  }
  const names = protectedRecords.map((record: HistoryRecord) => record.staffName);
  return feedbackItem("rule-execution", "previous-late", "上一工作日晚班", "ok", `${previousDate} 的${conciseNames(names)}本次均未承担超过 ${state.settings.nextDayLateMaxFatigue} 点的末班岗位，减负规则已落实。`);
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

function monthlyCountDifference(counts: number[]): number {
  return counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
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
  const monthlyRoster = getMonthlyDutyRoster(state, date);
  const allMonthlyStats = getMonthlyDutyRosterStats(state, date);
  const monthlyStats = allMonthlyStats.filter((item) => item.staff.dutyQualified);
  const monthlyMissing = monthlyStats.filter((item) => item.dutyDates.length === 0);
  const monthlyRepeated = monthlyStats.filter((item) => item.dutyDates.length > 1);
  const cxStats = allMonthlyStats.filter((item) => item.staff.cxPreflightQualified);
  const cxDifference = monthlyCountDifference(cxStats.map((item) => item.cxPreflightDates.length));
  const standbyDifference = monthlyCountDifference(allMonthlyStats.map((item) => item.standbyDates.length));
  const monthlyDutyNote = monthlyMissing.length && monthlyRepeated.length
    ? ` 月度值班需纠偏：${monthlyMissing.map((item) => `${item.staff.name} 0 次`).join("、")}；${monthlyRepeated.map((item) => `${item.staff.name} ${item.dutyDates.length} 次`).join("、")}。`
    : "";
  const monthlyFairnessNote = [
    cxDifference > 1 ? `CX航前差值 ${cxDifference}` : "",
    standbyDifference > 1 && monthlyRoster.some((item) => item.adjusted) ? `备勤差值 ${standbyDifference}` : ""
  ].filter(Boolean).join("、");
  const monthlyBalanceNote = monthlyFairnessNote ? ` 月度轮值需均衡：${monthlyFairnessNote}。` : "";
  const morningDutyText = "08:30前早班";
  if (rosterIds.length < 4 || new Set(rosterIds).size !== rosterIds.length) {
    return feedbackItem("rule-execution", "duty-roster", "值班与轮值", "attention", `CX航前${cxName}；${dutyDescription}；备勤${standbyDetails}。四个人选未完整配置或发生重合，需要调整；${morningDutyText}规则无法核验。${monthlyDutyNote}${monthlyBalanceNote}`);
  }
  const dutyAssignments = state.assignments.filter((assignment) => assignment.staffId === roster.dutyStaffId && assignment.status === "assigned" && assignment.workHours > 0);
  const morningDutyAssignment = dutyAssignments.find((assignment) => isDutyMorningFlight({ startTime: assignment.startTime }, state));
  const morningDutyEvidence = morningDutyAssignment
    ? `${morningDutyText}已安排在 ${morningDutyAssignment.flightNo}/${morningDutyAssignment.position}`
    : `${morningDutyText}未安排，需要复核值班人员是否在 08:30 前航班上岗`;
  if (!state.flights.length || !dutyAssignments.length) {
    return feedbackItem("rule-execution", "duty-roster", "值班与轮值", "attention", `CX航前${cxName}；${dutyDescription}未安排实际航班岗位；备勤${standbyDetails}。${morningDutyEvidence}；需要复核值班人员的最晚航班安排。${monthlyDutyNote}${monthlyBalanceNote}`);
  }
  const latestStarts = [...new Set(state.flights.map((flight) => operationalStart(flight.startTime, state)))]
    .sort((left, right) => right - left)
    .slice(0, 2);
  const preferred = [...dutyAssignments]
    .filter((assignment) => latestStarts.includes(operationalStart(assignment.startTime, state)))
    .filter((assignment) => dutyLatePositionPriority(assignment.position, assignment.remark) < 4)
    .sort((left, right) => latestStarts.indexOf(operationalStart(left.startTime, state))
      - latestStarts.indexOf(operationalStart(right.startTime, state))
      || dutyLatePositionPriority(left.position, left.remark) - dutyLatePositionPriority(right.position, right.remark))[0];
  if (preferred) {
    const standbyNote = standbyMissingWork.length ? `；${conciseNames(standbyMissingWork)}作为备勤但未安排实际岗位，需要复核` : "";
    const flightRank = latestStarts.indexOf(operationalStart(preferred.startTime, state));
    const placement = flightRank === 0
      ? `最晚航班 ${preferred.flightNo}/${preferred.position}`
      : `倒数第二晚航班 ${preferred.flightNo}/${preferred.position}（值班晚撤规则第二档位）`;
    const level = standbyMissingWork.length || Boolean(monthlyDutyNote) || Boolean(monthlyBalanceNote) || !morningDutyAssignment ? "attention" : "ok";
    return feedbackItem("rule-execution", "duty-roster", "值班与轮值", level, `CX航前${cxName}；${dutyDescription}安排在${placement}，符合值班晚撤规则；${morningDutyEvidence}；备勤${standbyDetails}${standbyNote}。${monthlyDutyNote}${monthlyBalanceNote}`);
  }
  const lastDuty = [...dutyAssignments].sort((left, right) => operationalStart(right.startTime, state) - operationalStart(left.startTime, state))[0]!;
  return feedbackItem("rule-execution", "duty-roster", "值班与轮值", "attention", `CX航前${cxName}；${dutyDescription}未满足值班晚撤规则：实际最晚只排到 ${lastDuty.flightNo}/${lastDuty.position}，应落在最晚或倒数第二晚航班的一号、督导、申报或送资料岗位，请复核资质、夜班能力或严格限制；${morningDutyEvidence}；备勤${standbyDetails}。${monthlyDutyNote}${monthlyBalanceNote}`);
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
