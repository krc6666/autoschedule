import type { AppState } from "../../model";
import { dutyFatigueByStaff } from "../duty-roster/roster";
import { buildStaffLoads } from "../statistics/fatigue";
import {
  operationalStart,
  conciseNames,
  staffConnections,
  type AssignmentConnection,
} from "./schedule-feedback-facts";
import {
  feedbackItem,
  type ScheduleFeedbackItem,
} from "./schedule-feedback-model";
import { countedWorkloadAssignments } from "../shared/workload-accounting";
import { evaluateWorkloadBalance } from "../reviews/workload-balance";

function matchesTransitionPolicy(
  state: AppState,
  connection: AssignmentConnection
): boolean {
  const normalize = (value: string): string => value.trim().toUpperCase();
  return state.settings.positionTransitionPolicies.some(
    (policy) =>
      policy.enabled &&
      normalize(policy.targetFlightNo) ===
        normalize(connection.next.flightNo) &&
      normalize(policy.targetPosition) ===
        normalize(connection.next.position) &&
      (!policy.sourceFlightNo.trim() ||
        normalize(policy.sourceFlightNo) ===
          normalize(connection.previous.flightNo)) &&
      (!policy.sourcePositions.length ||
        policy.sourcePositions.some(
          (position) =>
            normalize(position) === normalize(connection.previous.position)
        )) &&
      connection.gap < policy.minimumGapMinutes
  );
}

function flightDensityEvidence(state: AppState): string {
  if (!state.flights.length) return "当天无航班";
  if (state.flights.length === 1) return "当天 1 个航班，无相邻航班密集区间";
  const starts = state.flights
    .map((flight) => operationalStart(flight.startTime, state))
    .sort((left, right) => left - right);
  const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
  const densePairs = gaps.filter((gap) => gap <= 120).length;
  const minimumGap = Math.min(...gaps);
  return `当天 ${state.flights.length} 个航班，${densePairs} 组相邻航班起飞间隔不超过 120 分钟，最短 ${minimumGap} 分钟`;
}

function coverageFeedback(state: AppState, date: string): ScheduleFeedbackItem {
  const workers = state.staff.filter(
    (person) => person.staffType === "常规" && person.status === "正常"
  );
  const loads = buildStaffLoads(
    workers,
    countedWorkloadAssignments(state),
    state.history,
    date,
    state.settings,
    dutyFatigueByStaff(state, date)
  );
  const unworked = loads
    .filter((load) => load.workHours <= 0)
    .map((load) => load.staff.name);
  const unfilled = state.assignments.filter((assignment) => {
    if (assignment.status !== "unfilled") return false;
    const rule = assignment.positionRuleId
      ? state.positionRules.find(
          (item) => item.id === assignment.positionRuleId
        )
      : undefined;
    return rule?.category !== "引导" && rule?.category !== "行政支援";
  }).length;
  const supervisorAssignments = state.assignments
    .filter(
      (assignment) =>
        assignment.status === "assigned" &&
        assignment.supervisorSourceAssignmentId
    )
    .map(
      (assignment) =>
        `${assignment.staffName}兼任${assignment.flightNo}/${assignment.position}`
    );
  const density = flightDensityEvidence(state);
  if (unworked.length || unfilled || supervisorAssignments.length) {
    const details = [
      unworked.length ? `${conciseNames(unworked)}为 0 工时` : "",
      unfilled ? `${unfilled} 个常规岗位待补位` : "",
      supervisorAssignments.length
        ? `督导机动补位：${supervisorAssignments.join("、")}`
        : "",
    ]
      .filter(Boolean)
      .join("；");
    return feedbackItem(
      "flight-staff",
      "coverage",
      "人员覆盖",
      "attention",
      `${density}；${details}，需要人工复核。`
    );
  }
  return feedbackItem(
    "flight-staff",
    "coverage",
    "人员覆盖",
    "ok",
    `${density}；${workers.length} 名正常常规人员均有实际工时，常规岗位无待补位。`
  );
}

function fatigueFeedback(state: AppState, date: string): ScheduleFeedbackItem {
  const workers = state.staff.filter(
    (person) => person.staffType === "常规" && person.status === "正常"
  );
  const loads = buildStaffLoads(
    workers,
    countedWorkloadAssignments(state),
    state.history,
    date,
    state.settings,
    dutyFatigueByStaff(state, date)
  );
  if (!loads.length)
    return feedbackItem(
      "flight-staff",
      "fatigue",
      "负荷均衡",
      "info",
      "暂无正常常规人员，无法形成工时与疲劳均衡基准。"
    );
  const byHours = [...loads].sort(
    (left, right) => left.workHours - right.workHours
  );
  const byTodayFatigue = [...loads].sort(
    (left, right) => left.todayFatigue - right.todayFatigue
  );
  const highestTotal = [...loads].sort(
    (left, right) => right.totalFatigue - left.totalFatigue
  )[0]!;
  const lowestHours = byHours[0]!;
  const highestHours = byHours.at(-1)!;
  const lowestTodayFatigue = byTodayFatigue[0]!;
  const highestTodayFatigue = byTodayFatigue.at(-1)!;
  const hoursDifference = highestHours.workHours - lowestHours.workHours;
  const fatigueDifference =
    highestTodayFatigue.todayFatigue - lowestTodayFatigue.todayFatigue;
  const workload = evaluateWorkloadBalance(state, date);
  const exceeded =
    state.settings.workloadBalanceEnabled && !workload.withinConfiguredTargets;
  const target = state.settings.workloadBalanceEnabled
    ? `规则目标为工时差不超过 ${state.settings.maxWorkHoursDifference.toFixed(1)} 小时、当日疲劳差不超过 ${state.settings.maxTodayFatigueDifference.toFixed(1)} 点`
    : "当日负荷均衡规则已停用";
  const evidence = `航班负荷${workload.pressure}；工时差 ${hoursDifference.toFixed(1)} 小时（${lowestHours.staff.name} ${lowestHours.workHours.toFixed(1)}h，${highestHours.staff.name} ${highestHours.workHours.toFixed(1)}h）；滚动工时差 ${workload.rollingWorkHoursDifference.toFixed(1)} 小时；当日疲劳差 ${fatigueDifference.toFixed(1)} 点（${lowestTodayFatigue.staff.name} ${lowestTodayFatigue.todayFatigue.toFixed(1)}，${highestTodayFatigue.staff.name} ${highestTodayFatigue.todayFatigue.toFixed(1)}）；总疲劳最高为${highestTotal.staff.name} ${highestTotal.totalFatigue.toFixed(1)} 点。${target}。`;
  return feedbackItem(
    "flight-staff",
    "fatigue",
    "负荷均衡",
    state.settings.workloadBalanceEnabled
      ? exceeded
        ? "attention"
        : "ok"
      : "info",
    evidence
  );
}

function connectionFeedback(state: AppState): ScheduleFeedbackItem {
  const connections = staffConnections(state);
  if (!connections.length)
    return feedbackItem(
      "flight-staff",
      "connections",
      "航班衔接",
      "ok",
      "未发生同一人员跨航班连续任务。"
    );
  const overlap = connections.find((connection) => connection.gap < 0);
  const policyViolation = connections.find((connection) =>
    matchesTransitionPolicy(state, connection)
  );
  const tightest = [...connections].sort(
    (left, right) => left.gap - right.gap
  )[0]!;
  const personName = (connection: AssignmentConnection): string =>
    state.staff.find((person) => person.id === connection.next.staffId)?.name ??
    connection.next.staffName;
  const route = (connection: AssignmentConnection): string =>
    `${connection.previous.flightNo}→${connection.next.flightNo}`;
  if (overlap)
    return feedbackItem(
      "flight-staff",
      "connections",
      "航班衔接",
      "attention",
      `${personName(overlap)}的 ${route(overlap)} 时间重叠，无法正常衔接。`
    );
  if (policyViolation)
    return feedbackItem(
      "flight-staff",
      "connections",
      "航班衔接",
      "attention",
      `${personName(policyViolation)}的 ${route(policyViolation)} 间隔仅 ${policyViolation.gap} 分钟，未达到已配置的岗位衔接要求。`
    );
  if (tightest.gap < 30)
    return feedbackItem(
      "flight-staff",
      "connections",
      "航班衔接",
      "attention",
      `${personName(tightest)}的 ${route(tightest)} 间隔仅 ${tightest.gap} 分钟，现场衔接可能紧张。`
    );
  return feedbackItem(
    "flight-staff",
    "connections",
    "航班衔接",
    "ok",
    `未发现衔接冲突，最短跨航班间隔为 ${tightest.gap} 分钟。`
  );
}

export function buildOperationalScheduleFeedback(
  state: AppState,
  date: string
): ScheduleFeedbackItem[] {
  return [
    coverageFeedback(state, date),
    fatigueFeedback(state, date),
    connectionFeedback(state),
  ];
}
