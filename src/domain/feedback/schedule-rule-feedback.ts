import type { AppState, Assignment } from "../../model";
import {
  RULE_FEEDBACK_ORDER,
  type RuleFeedbackKey,
} from "../rules/schedule-rule-contract";
import { recentArchivedWorkdays } from "../statistics/fatigue";
import {
  getDutyRosterForDate,
  getMonthlyDutyRoster,
  getMonthlyDutyRosterStats,
} from "../duty-roster/roster";
import {
  configuredDutyPositionPriority,
  dutyLatePositionPriority,
  isDutyMorningFlight,
} from "../assignments/duty-assignment";
import {
  isInFinalLateBatch,
  isNextWorkdayCutoffConflict,
  matchesLateShiftRecoveryPosition,
  matchesNextWorkdayRecoveryTarget,
  previousWorkdayLateProtection,
} from "../reviews/cross-day-recovery";
import { isHighLoadPosition } from "../reviews/schedule-protection";
import { isPreNoonFlight } from "../flights/schedule-tasks";
import {
  countedWorkloadAssignments,
  isCountedWorkloadAssignment,
} from "../shared/workload-accounting";
import { assignmentRule } from "../flights/schedule-position-rules";
import { PRIORITY_ROTATION_POSITION_KEYWORDS } from "../reviews/position-rotation-policy";
import {
  isNextDutyRestPriorityPosition,
  nextDutyRestProtection,
} from "../reviews/next-duty-rest";
import {
  assignmentDecisionMessages,
  assignmentDecisions,
} from "../assignments/assignment-evidence";
import {
  conciseNames,
  operationalStart,
  timedAssignments,
} from "./schedule-feedback-facts";
import {
  feedbackItem,
  type ScheduleFeedbackItem,
} from "./schedule-feedback-model";

function morningPriorityFeedback(state: AppState): ScheduleFeedbackItem {
  const assignments = state.assignments.filter((assignment) => {
    if (!isPreNoonFlight(assignment)) return false;
    const rule = assignment.positionRuleId
      ? state.positionRules.find(
          (item) => item.id === assignment.positionRuleId
        )
      : undefined;
    return rule?.category === "常规";
  });
  if (!assignments.length) {
    return feedbackItem(
      "rule-execution",
      "morning-priority",
      "12点前岗位完整性",
      "info",
      "当天没有12点以前开始航班的常规岗位，无法形成执行基准。"
    );
  }
  const issues = assignments.flatMap((assignment) =>
    (assignment.systemNotes ?? []).map(
      (note) => `${assignment.flightNo}/${assignment.position}：${note}`
    )
  );
  if (issues.length) {
    return feedbackItem(
      "rule-execution",
      "morning-priority",
      "12点前岗位完整性",
      "attention",
      `共 ${assignments.length} 个12点前常规岗位；${issues.join("；")}。`
    );
  }
  return feedbackItem(
    "rule-execution",
    "morning-priority",
    "12点前岗位完整性",
    "ok",
    `共 ${assignments.length} 个12点前常规岗位，已按单岗位可胜任人数从少到多安排且全部填满，未突破严格限制。`
  );
}

function highLoadFeedback(state: AppState): ScheduleFeedbackItem {
  const highLoadAssignments = timedAssignments(state)
    .filter((item) => isCountedWorkloadAssignment(state, item.assignment))
    .filter((item) =>
      isHighLoadPosition(
        item.assignment.fatiguePoints,
        item.assignment.remark,
        state
      )
    );
  if (!state.settings.highLoadProtectionEnabled) {
    return feedbackItem(
      "rule-execution",
      "high-load",
      "连续高负荷",
      "info",
      `高负荷衔接保护已停用；当前有 ${highLoadAssignments.length} 个高负荷岗位，无法判断该保护规则是否执行。`
    );
  }
  const staffIds = [
    ...new Set(highLoadAssignments.map((item) => item.assignment.staffId)),
  ];
  const repeated = staffIds.flatMap((staffId) => {
    const own = highLoadAssignments
      .filter((item) => item.assignment.staffId === staffId)
      .sort((left, right) => left.start - right.start);
    return own
      .slice(1)
      .filter(
        (item, index) =>
          item.start - own[index]!.end <= state.settings.highLoadRecoveryMinutes
      )
      .map((item) => item.assignment.staffName);
  });
  if (repeated.length) {
    return feedbackItem(
      "rule-execution",
      "high-load",
      "连续高负荷",
      "attention",
      `${conciseNames(repeated)}在 ${state.settings.highLoadRecoveryMinutes} 分钟恢复期内连续承担高负荷岗位；为保证岗位完整性，已超保护仍安排，请复核现场承受能力。`
    );
  }
  return feedbackItem(
    "rule-execution",
    "high-load",
    "连续高负荷",
    "ok",
    `${highLoadAssignments.length} 个高负荷岗位均未由同一人员在 ${state.settings.highLoadRecoveryMinutes} 分钟恢复期内连续承担。`
  );
}

function previousLateFeedback(
  state: AppState,
  date: string
): ScheduleFeedbackItem {
  const protection = previousWorkdayLateProtection(state, date);
  const { previousDate, protectedRecords, protectedStaffIds } = protection;
  if (!previousDate)
    return feedbackItem(
      "rule-execution",
      "previous-late",
      "上一工作日晚班人员跟踪",
      "info",
      "暂无最近工作日归档，无法核对跨工作日恢复保护。"
    );
  const protectedIds = [...protectedStaffIds];
  if (!protectedIds.length)
    return feedbackItem(
      "rule-execution",
      "previous-late",
      "上一工作日晚班人员跟踪",
      "ok",
      `${previousDate} 最后一批晚班没有命中已配置的末班重点岗位，无需跨工作日保护。`
    );
  const previousDetails = protectedIds
    .map((staffId) => {
      const own = protectedRecords.filter(
        (record) => record.staffId === staffId
      );
      const roles = [...new Set(own.map(compactFlightRole))].join("、");
      return `${own[0]?.staffName ?? staffId} ${roles}`;
    })
    .join("；");
  let needsReview = false;
  const currentDetails = protectedIds
    .map((staffId) => {
      const ownAssignments = countedWorkloadAssignments(state).filter(
        (assignment) =>
          assignment.staffId === staffId && assignment.status === "assigned"
      );
      const own = ownAssignments
        .filter((assignment) => assignment.workHours > 0)
        .sort(
          (left, right) =>
            operationalStart(left.startTime, state) -
            operationalStart(right.startTime, state)
        );
      const name =
        protectedRecords.find((record) => record.staffId === staffId)
          ?.staffName ?? staffId;
      if (!own.length) return `${name}今日未安排实际岗位，已休整`;
      const protectedMorningAssignments = ownAssignments.filter((assignment) =>
        matchesNextWorkdayRecoveryTarget(state, {
          flightNo: assignment.flightNo,
          position: assignment.position,
          remark: assignment.remark,
        })
      );
      const repeatedLatePriority = own.filter(
        (assignment) =>
          isInFinalLateBatch(assignment, state.flights, state) &&
          matchesLateShiftRecoveryPosition(state, assignment)
      );
      const cutoffConflicts = own.filter((assignment) =>
        isNextWorkdayCutoffConflict(state, staffId, assignment.startTime, date)
      );
      needsReview ||=
        protectedMorningAssignments.length > 0 ||
        repeatedLatePriority.length > 0 ||
        cutoffConflicts.length > 0;
      const protectedAssignments = [
        ...new Map(
          [
            ...protectedMorningAssignments,
            ...repeatedLatePriority,
            ...cutoffConflicts,
          ].map((assignment) => [assignment.id, assignment])
        ).values(),
      ];
      const overrideReasons = assignmentDecisionMessages(protectedAssignments, {
        ruleIds: new Set(["late-shift-recovery", "late-shift-cutoff"]),
        outcomes: new Set(["fallback"]),
      });
      if (!protectedAssignments.length) return `${name} 已避开`;
      return `${name} 未落实（${[...new Set(protectedAssignments.map(compactFlightRole))].join("、")}；${conciseProtectionReason(overrideReasons)}）`;
    })
    .join("；");
  return feedbackItem(
    "rule-execution",
    "previous-late",
    "上一工作日晚班人员跟踪",
    needsReview ? "attention" : "ok",
    `${previousDate}：${previousDetails}。本班：${currentDetails}。`
  );
}

function flightCode(flightNo: string): string {
  return (
    /^[A-Z]+/i.exec(flightNo.trim())?.[0]?.toUpperCase() ?? flightNo.trim()
  );
}

function compactFlightRole(
  item: Pick<Assignment, "flightNo" | "position" | "remark">
): string {
  const priorityRole = concisePriorityRoles([item]);
  const role =
    priorityRole === "重点岗位"
      ? `${item.position}${item.remark ? `（${item.remark}）` : ""}`
      : priorityRole;
  return `${flightCode(item.flightNo)} ${role}`;
}

function concisePriorityRoles(
  items:
    | Array<Pick<Assignment, "position" | "remark">>
    | Array<{ position: string; remark: string }>
): string {
  const roles = PRIORITY_ROTATION_POSITION_KEYWORDS.filter((keyword) =>
    items.some((item) => `${item.position} ${item.remark}`.includes(keyword))
  );
  return roles.length ? roles.join("、") : "重点岗位";
}

function conciseProtectionReason(messages: string[]): string {
  const text = messages.join("；");
  if (!text) return "人工调整或无自动原因";
  if (text.includes("唯一合格")) return "唯一合格人员";
  if (text.includes("值班上午")) return "值班上午上岗要求优先";
  if (text.includes("值班晚撤")) return "值班晚撤岗位锁定优先";
  if (text.includes("值班")) return "值班锁定优先";
  if (text.includes("KE166")) return "KE166机动督导锁定优先";
  if (text.includes("夜班")) return "夜班能力限制";
  if (text.includes("时间冲突")) return "其他人员时间冲突";
  if (text.includes("工时")) return "其他人员工时受限";
  if (text.includes("岗位空缺") || text.includes("岗位完整"))
    return "岗位完整性优先";
  return "无人可安全替代";
}

function nextDutyRestFeedback(
  state: AppState,
  date: string
): ScheduleFeedbackItem {
  if (!state.settings.nextDutyRestProtectionEnabled) {
    return feedbackItem(
      "rule-execution",
      "next-duty-rest",
      "下班次值班预休",
      "info",
      "下班次值班人员预休保护已停用。"
    );
  }
  const protection = nextDutyRestProtection(state, date);
  if (!protection.dutyStaffId) {
    return feedbackItem(
      "rule-execution",
      "next-duty-rest",
      "下班次值班预休",
      "info",
      `${protection.nextWorkdayDate}尚未配置值班人员。`
    );
  }
  const name = staffName(state, protection.dutyStaffId);
  const conflicts = state.assignments.filter(
    (assignment) =>
      assignment.staffId === protection.dutyStaffId &&
      assignment.status === "assigned" &&
      assignment.workHours > 0 &&
      Boolean(
        assignmentRule(state, assignment) &&
        isNextDutyRestPriorityPosition(assignmentRule(state, assignment)!)
      )
  );
  if (!conflicts.length) {
    return feedbackItem(
      "rule-execution",
      "next-duty-rest",
      "下班次值班预休",
      "ok",
      `${name}将在${protection.nextWorkdayDate}值班，本班已避开全部重点岗位。`
    );
  }
  const reasons = assignmentDecisionMessages(conflicts, {
    ruleIds: new Set(["next-duty-rest"]),
    outcomes: new Set(["fallback"]),
  });
  return feedbackItem(
    "rule-execution",
    "next-duty-rest",
    "下班次值班预休",
    "attention",
    `${name} 未避开${concisePriorityRoles(conflicts)}（${conciseProtectionReason(reasons)}），将在${protection.nextWorkdayDate}值班。`
  );
}

function positionRotationFeedback(state: AppState): ScheduleFeedbackItem {
  const unresolved = assignmentDecisionMessages(state.assignments, {
    ruleIds: new Set(["position-rotation"]),
    outcomes: new Set(["fallback"]),
  });
  if (unresolved.length) {
    return feedbackItem(
      "rule-execution",
      "position-rotation",
      "连续轮岗复核",
      "attention",
      unresolved.join("；")
    );
  }
  const fulfilled = assignmentDecisionMessages(state.assignments, {
    ruleIds: new Set(["position-rotation"]),
    outcomes: new Set(["selected"]),
  });
  if (fulfilled.length) {
    return feedbackItem(
      "rule-execution",
      "position-rotation",
      "连续轮岗复核",
      "ok",
      fulfilled.join("；")
    );
  }
  return feedbackItem(
    "rule-execution",
    "position-rotation",
    "连续轮岗复核",
    "info",
    "没有触发连续轮岗复核；上一工作班未出现同一人员承担相同航班与岗位的连续记录。"
  );
}

function crossWorkdayLoadFeedback(
  state: AppState,
  date: string
): ScheduleFeedbackItem {
  const unresolved = assignmentDecisionMessages(state.assignments, {
    ruleIds: new Set(["cross-workday-load"]),
    outcomes: new Set(["fallback"]),
  });
  if (unresolved.length) {
    return feedbackItem(
      "rule-execution",
      "cross-workday-load",
      "跨工作班动态平衡",
      "attention",
      unresolved.slice(0, 4).join("；")
    );
  }
  const fulfilled = assignmentDecisionMessages(state.assignments, {
    ruleIds: new Set(["cross-workday-load"]),
    outcomes: new Set(["selected"]),
  });
  if (fulfilled.length) {
    return feedbackItem(
      "rule-execution",
      "cross-workday-load",
      "跨工作班动态平衡",
      "ok",
      fulfilled.slice(0, 4).join("；")
    );
  }
  const previousDate = recentArchivedWorkdays(state.history, date, 1)[0]?.date;
  return previousDate
    ? feedbackItem(
        "rule-execution",
        "cross-workday-load",
        "跨工作班动态平衡",
        "ok",
        `${previousDate} 与本班没有出现需要由跨工作班负荷差裁决的同级候选人。`
      )
    : feedbackItem(
        "rule-execution",
        "cross-workday-load",
        "跨工作班动态平衡",
        "info",
        "暂无最近工作日归档，无法执行跨工作班动态负荷互补。"
      );
}

function positionFrequencyReviewFeedback(
  state: AppState
): ScheduleFeedbackItem {
  const unresolved = assignmentDecisionMessages(state.assignments, {
    ruleIds: new Set(["position-frequency", "position-frequency-review"]),
    outcomes: new Set(["fallback"]),
  });
  if (unresolved.length) {
    return feedbackItem(
      "rule-execution",
      "position-frequency-review",
      "重点岗位频率均衡",
      "attention",
      unresolved.join("；")
    );
  }
  const fulfilled = assignmentDecisionMessages(state.assignments, {
    ruleIds: new Set(["position-frequency", "position-frequency-review"]),
    outcomes: new Set(["selected"]),
  });
  if (fulfilled.length) {
    return feedbackItem(
      "rule-execution",
      "position-frequency-review",
      "重点岗位频率均衡",
      "ok",
      fulfilled.join("；")
    );
  }
  return feedbackItem(
    "rule-execution",
    "position-frequency-review",
    "重点岗位频率均衡",
    "info",
    "一号、申报、督导、控制和送资料岗位未出现需要调整的同岗高频安排。"
  );
}

function currentLateFeedback(state: AppState): ScheduleFeedbackItem {
  const finalLateAssignments = state.assignments
    .filter(
      (assignment) =>
        assignment.status === "assigned" &&
        assignment.staffId &&
        assignment.workHours > 0
    )
    .filter((assignment) => isCountedWorkloadAssignment(state, assignment))
    .filter((assignment) =>
      isInFinalLateBatch(assignment, state.flights, state)
    )
    .filter((assignment) =>
      matchesLateShiftRecoveryPosition(state, assignment)
    );
  const currentLate = finalLateAssignments;
  if (!state.flights.length) {
    return feedbackItem(
      "rule-execution",
      "current-late",
      "本班末班人员预告",
      "info",
      "当天没有航班，无法形成末班人员基准。"
    );
  }
  if (!currentLate.length) {
    return feedbackItem(
      "rule-execution",
      "current-late",
      "本班末班人员预告",
      "ok",
      "本班没有已安排的最后一批晚班岗位，下个工作日无需新增恢复保护人员。"
    );
  }
  const details = currentLate
    .map(
      (assignment) => `${assignment.staffName} ${compactFlightRole(assignment)}`
    )
    .join("、");
  return feedbackItem(
    "rule-execution",
    "current-late",
    "本班末班人员预告",
    "ok",
    `本班最后一批末班重点岗位人员：${details}；${conciseNames(currentLate.map((assignment) => assignment.staffName))}下个工作日需执行恢复保护。`
  );
}

function staffName(state: AppState, staffId: string | null): string {
  return staffId
    ? (state.staff.find((person) => person.id === staffId)?.name ??
        `#${staffId}`)
    : "未配置";
}

function assignmentSummary(state: AppState, staffId: string | null): string {
  if (!staffId) return "未配置";
  const latest = state.assignments
    .filter(
      (assignment) =>
        assignment.staffId === staffId &&
        assignment.status === "assigned" &&
        assignment.workHours > 0
    )
    .sort(
      (left, right) =>
        operationalStart(right.startTime, state) -
        operationalStart(left.startTime, state)
    )[0];
  return latest ? `${latest.flightNo}/${latest.position}` : "未安排实际岗位";
}

function monthlyCountDifference(counts: number[]): number {
  return counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
}

function dutyRosterFeedback(
  state: AppState,
  date: string
): ScheduleFeedbackItem {
  const roster = getDutyRosterForDate(state, date);
  const rosterIds = [
    roster.cxPreflightStaffId,
    roster.dutyStaffId,
    ...roster.standbyStaffIds,
  ].filter((id): id is string => Boolean(id));
  const cxName = staffName(state, roster.cxPreflightStaffId);
  const dutyName = staffName(state, roster.dutyStaffId);
  const dutyDescription = `值班${dutyName}（+${state.settings.dutyFatiguePoints} 点疲劳）`;
  const protectedDuty = Boolean(
    roster.dutyStaffId &&
    previousWorkdayLateProtection(state, date).protectedStaffIds.has(
      roster.dutyStaffId
    )
  );
  const dutyRecoveryNote = roster.recoveryAdjusted
    ? roster.recoveryAdjustmentRole === "future-counterpart"
      ? ` 自动值班恢复调整：本日原值班${staffName(state, roster.originalDutyStaffId ?? null)}已与 ${roster.recoverySwapDate} 的${dutyName}交换值班日期，月度值班次数不变。`
      : ` 自动值班恢复调整：原值班${staffName(state, roster.originalDutyStaffId ?? null)}已与未来工作日 ${roster.recoverySwapDate} 的${dutyName}交换值班日期，月度值班次数不变。`
    : roster.adjusted && protectedDuty
      ? ` 人工指定值班冲突：${dutyName}属于上一班末班重点岗位人员；人工指定优先，系统未自动调换值班日期。`
      : "";
  const standbyAssignments = roster.standbyStaffIds.map((staffId) => ({
    name: staffName(state, staffId),
    summary: assignmentSummary(state, staffId),
  }));
  const standbyDetails = standbyAssignments
    .map((item) => `${item.name}（${item.summary}）`)
    .join("、");
  const standbyMissingWork = standbyAssignments
    .filter((item) => item.summary === "未安排实际岗位")
    .map((item) => item.name);
  const monthlyRoster = getMonthlyDutyRoster(state, date);
  const allMonthlyStats = getMonthlyDutyRosterStats(state, date);
  const monthlyStats = allMonthlyStats.filter(
    (item) => item.staff.dutyQualified
  );
  const dutyCounts = monthlyStats.map((item) => item.dutyDates.length);
  const dutyDifference = monthlyCountDifference(dutyCounts);
  const dutyCoverageRequired =
    monthlyRoster.filter((item) => item.dutyStaffId).length >=
    monthlyStats.length;
  const monthlyMissing = monthlyStats.filter(
    (item) => item.dutyDates.length === 0
  );
  const cxStats = allMonthlyStats.filter(
    (item) => item.staff.cxPreflightQualified
  );
  const cxDifference = monthlyCountDifference(
    cxStats.map((item) => item.cxPreflightDates.length)
  );
  const standbyDifference = monthlyCountDifference(
    allMonthlyStats.map((item) => item.standbyDates.length)
  );
  const standbyMissing = allMonthlyStats.filter(
    (item) => item.standbyDates.length < 2
  );
  const standbyCapacity = monthlyRoster.reduce(
    (sum, item) =>
      sum +
      Math.min(
        2,
        Math.max(0, allMonthlyStats.length - (item.dutyStaffId ? 1 : 0))
      ),
    0
  );
  const standbySeatShortage = standbyCapacity < allMonthlyStats.length * 2;
  const monthlyDutyNote =
    (dutyCoverageRequired && monthlyMissing.length) || dutyDifference > 1
      ? ` 月度值班需纠偏：${monthlyStats.map((item) => `${item.staff.name} ${item.dutyDates.length} 次`).join("、")}；值班次数差 ${dutyDifference}。`
      : "";
  const monthlyFairnessNote = [
    cxDifference > 1 ? `CX航前差值 ${cxDifference}` : "",
    standbyDifference > 1 ? `备勤差值 ${standbyDifference}` : "",
    standbyMissing.length && !standbySeatShortage
      ? `备勤不足 2 次：${standbyMissing.map((item) => item.staff.name).join("、")}`
      : "",
  ]
    .filter(Boolean)
    .join("、");
  const monthlyBalanceNote = monthlyFairnessNote
    ? ` 月度轮值需均衡：${monthlyFairnessNote}。`
    : "";
  const monthlyCapacityNote =
    standbyMissing.length && standbySeatShortage
      ? ` 本月工作日不足，${standbyMissing.map((item) => item.staff.name).join("、")}备勤未满 2 次；值班优先，缺额只作说明、不计违约。`
      : "";
  const morningDutyText = "12点前上午航班";
  const standbyIds = roster.standbyStaffIds.filter((id): id is string =>
    Boolean(id)
  );
  const rosterConflict =
    Boolean(
      roster.dutyStaffId &&
      [roster.cxPreflightStaffId, ...roster.standbyStaffIds].includes(
        roster.dutyStaffId
      )
    ) || new Set(standbyIds).size !== standbyIds.length;
  if (rosterIds.length < 4 || rosterConflict) {
    return feedbackItem(
      "rule-execution",
      "duty-roster",
      "值班与轮值",
      "attention",
      `CX航前${cxName}；${dutyDescription}；备勤${standbyDetails}。轮值未完整配置，或值班与其他轮值发生冲突，需要调整；CX航前与备勤允许同人兼任。${morningDutyText}规则无法核验。${dutyRecoveryNote}${monthlyDutyNote}${monthlyBalanceNote}${monthlyCapacityNote}`
    );
  }
  const dutyAssignments = state.assignments.filter(
    (assignment) =>
      assignment.staffId === roster.dutyStaffId &&
      assignment.status === "assigned" &&
      assignment.workHours > 0
  );
  const morningDutyAssignment = dutyAssignments.find((assignment) =>
    isDutyMorningFlight({ startTime: assignment.startTime }, state)
  );
  const morningDutyEvidence = morningDutyAssignment
    ? `${morningDutyText}已安排在 ${morningDutyAssignment.flightNo}/${morningDutyAssignment.position}`
    : `${morningDutyText}未安排，需要复核值班人员是否在开始时间严格早于 12:00 的航班上岗`;
  if (!state.flights.length || !dutyAssignments.length) {
    return feedbackItem(
      "rule-execution",
      "duty-roster",
      "值班与轮值",
      "attention",
      `CX航前${cxName}；${dutyDescription}未安排实际航班岗位；备勤${standbyDetails}。${morningDutyEvidence}；需要复核值班人员的最晚航班安排。${dutyRecoveryNote}${monthlyDutyNote}${monthlyBalanceNote}${monthlyCapacityNote}`
    );
  }
  const latestStarts = [
    ...new Set(
      state.flights.map((flight) => operationalStart(flight.startTime, state))
    ),
  ]
    .sort((left, right) => right - left)
    .slice(0, 2);
  const configuredPreferred = [...dutyAssignments]
    .map((assignment) => ({
      assignment,
      priority: configuredDutyPositionPriority(state, assignment),
    }))
    .filter((item) => item.priority >= 0)
    .sort((left, right) => left.priority - right.priority)[0];
  if (configuredPreferred) {
    const standbyNote = standbyMissingWork.length
      ? `；${conciseNames(standbyMissingWork)}作为备勤但未安排实际岗位，需要复核`
      : "";
    const level =
      standbyMissingWork.length ||
      Boolean(monthlyDutyNote) ||
      Boolean(monthlyBalanceNote) ||
      !morningDutyAssignment
        ? "attention"
        : "ok";
    const { assignment, priority } = configuredPreferred;
    return feedbackItem(
      "rule-execution",
      "duty-roster",
      "值班与轮值",
      level,
      `CX航前${cxName}；${dutyDescription}安排在配置优先级第 ${priority + 1} 项 ${assignment.flightNo}/${assignment.position}，符合值班岗位优先顺序；${morningDutyEvidence}；备勤${standbyDetails}${standbyNote}。${dutyRecoveryNote}${monthlyDutyNote}${monthlyBalanceNote}${monthlyCapacityNote}`
    );
  }
  const preferred = [...dutyAssignments]
    .filter((assignment) =>
      latestStarts.includes(operationalStart(assignment.startTime, state))
    )
    .filter(
      (assignment) =>
        dutyLatePositionPriority(assignment.position, assignment.remark) < 4
    )
    .sort(
      (left, right) =>
        latestStarts.indexOf(operationalStart(left.startTime, state)) -
          latestStarts.indexOf(operationalStart(right.startTime, state)) ||
        dutyLatePositionPriority(left.position, left.remark) -
          dutyLatePositionPriority(right.position, right.remark)
    )[0];
  if (preferred) {
    const standbyNote = standbyMissingWork.length
      ? `；${conciseNames(standbyMissingWork)}作为备勤但未安排实际岗位，需要复核`
      : "";
    const flightRank = latestStarts.indexOf(
      operationalStart(preferred.startTime, state)
    );
    const placement =
      flightRank === 0
        ? `最晚航班 ${preferred.flightNo}/${preferred.position}`
        : `倒数第二晚航班 ${preferred.flightNo}/${preferred.position}（值班晚撤规则第二档位）`;
    const level =
      standbyMissingWork.length ||
      Boolean(monthlyDutyNote) ||
      Boolean(monthlyBalanceNote) ||
      !morningDutyAssignment
        ? "attention"
        : "ok";
    return feedbackItem(
      "rule-execution",
      "duty-roster",
      "值班与轮值",
      level,
      `CX航前${cxName}；${dutyDescription}安排在${placement}，未命中已配置优先项，按回退逻辑落位并符合值班晚撤规则；${morningDutyEvidence}；备勤${standbyDetails}${standbyNote}。${dutyRecoveryNote}${monthlyDutyNote}${monthlyBalanceNote}${monthlyCapacityNote}`
    );
  }
  const lastDuty = [...dutyAssignments].sort(
    (left, right) =>
      operationalStart(right.startTime, state) -
      operationalStart(left.startTime, state)
  )[0]!;
  const blockedDecision = assignmentDecisions(state.assignments, {
    ruleIds: new Set(["duty-position"]),
    outcomes: new Set(["blocked"]),
  })[0];
  const reason = blockedDecision?.message ?? "没有满足目标岗位的硬约束";
  return feedbackItem(
    "rule-execution",
    "duty-roster",
    "值班与轮值",
    "attention",
    `CX航前${cxName}；${dutyDescription}未满足值班晚撤规则：实际最晚只排到 ${lastDuty.flightNo}/${lastDuty.position}；目标岗位未落位原因：${reason}；${morningDutyEvidence}；备勤${standbyDetails}。${dutyRecoveryNote}${monthlyDutyNote}${monthlyBalanceNote}${monthlyCapacityNote}`
  );
}

export function buildRuleScheduleFeedback(
  state: AppState,
  date: string
): ScheduleFeedbackItem[] {
  return RULE_FEEDBACK_ORDER.map((key) =>
    RULE_FEEDBACK_BUILDERS[key](state, date)
  );
}

type RuleFeedbackBuilder = (
  state: AppState,
  date: string
) => ScheduleFeedbackItem;

const RULE_FEEDBACK_BUILDERS: Readonly<
  Record<RuleFeedbackKey, RuleFeedbackBuilder>
> = {
  "morning-priority": (state) => morningPriorityFeedback(state),
  "high-load": (state) => highLoadFeedback(state),
  "cross-workday-load": crossWorkdayLoadFeedback,
  "position-frequency-review": (state) =>
    positionFrequencyReviewFeedback(state),
  "position-rotation": (state) => positionRotationFeedback(state),
  "next-duty-rest": nextDutyRestFeedback,
  "previous-late": previousLateFeedback,
  "current-late": (state) => currentLateFeedback(state),
  "duty-roster": dutyRosterFeedback,
};
