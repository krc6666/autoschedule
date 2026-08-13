import type { AppState, Assignment } from "../../model";
import { reassignmentSafetyReasons } from "./rotation-review-safety";

export type ManualSwapOutcome = "safe" | "soft-tradeoff" | "blocked";

export interface ManualSwapChange {
  assignmentId: string;
  flightNo: string;
  position: string;
  beforeStaffName: string;
  afterStaffName: string;
}

export interface ManualSwapAnalysis {
  sourceAssignmentId: string;
  targetAssignmentId: string;
  changes: ManualSwapChange[];
  improvements: string[];
  tradeoffs: string[];
  blockers: string[];
  outcome: ManualSwapOutcome;
}

const SOFT_TRADEOFF_MARKERS = [
  "连续轮岗",
  "同岗频率",
  "频率均衡",
  "跨工作班负荷互补",
  "跨工作日末班重点岗位恢复保护",
  "截止时间后的航班",
  "高负荷疲劳保护",
  "滚动负荷保护",
  "扩大工时或疲劳差",
  "本月已承担2次TR121一号",
] as const;

function isSoftTradeoff(reason: string): boolean {
  return SOFT_TRADEOFF_MARKERS.some((marker) => reason.includes(marker));
}

function invalidAnalysis(
  sourceAssignmentId: string,
  targetAssignmentId: string,
  reason: string
): ManualSwapAnalysis {
  return {
    sourceAssignmentId,
    targetAssignmentId,
    changes: [],
    improvements: [],
    tradeoffs: [],
    blockers: [reason],
    outcome: "blocked",
  };
}

function assignmentChange(
  assignment: Assignment,
  incoming: Assignment
): ManualSwapChange {
  return {
    assignmentId: assignment.id,
    flightNo: assignment.flightNo,
    position: assignment.position,
    beforeStaffName: assignment.staffName,
    afterStaffName: incoming.staffName,
  };
}

function improvementMessages(source: Assignment, target: Assignment): string[] {
  const warning = source.decisionTrace?.find(
    (decision) =>
      decision.outcome === "fallback" &&
      decision.ruleId !== "cross-workday-load"
  );
  const messages: string[] = [];
  const earlierFinish = target.endTime < source.endTime;
  const lighterPosition = target.fatiguePoints < source.fatiguePoints;
  const leavesRepeatedPosition =
    warning?.ruleId === "position-rotation" &&
    (target.flightNo !== source.flightNo ||
      target.position !== source.position);
  if (warning && (earlierFinish || lighterPosition || leavesRepeatedPosition))
    messages.push(`原提醒预计得到改善：${warning.message}`);
  if (target.fatiguePoints < source.fatiguePoints) {
    messages.push(
      `${source.staffName}从${source.flightNo}/${source.position}调整到${target.flightNo}/${target.position}，岗位疲劳更低`
    );
  }
  if (!messages.length)
    messages.push("可以完成两人岗位交换，但未发现明确的规则改善证据");
  return messages;
}

export function analyzeManualSwap(
  state: AppState,
  date: string,
  sourceAssignmentId: string,
  targetAssignmentId: string
): ManualSwapAnalysis {
  const source = state.assignments.find(
    (assignment) => assignment.id === sourceAssignmentId
  );
  const target = state.assignments.find(
    (assignment) => assignment.id === targetAssignmentId
  );
  if (!source || !target)
    return invalidAnalysis(
      sourceAssignmentId,
      targetAssignmentId,
      "目标岗位已经不存在，请关闭后重新选择"
    );
  if (source.id === target.id || !source.staffId || !target.staffId)
    return invalidAnalysis(
      sourceAssignmentId,
      targetAssignmentId,
      "只能分析两个已经安排人员的不同岗位"
    );
  if (source.staffId === target.staffId)
    return invalidAnalysis(
      sourceAssignmentId,
      targetAssignmentId,
      "两个岗位当前是同一名人员，不需要交换"
    );

  const reasons = reassignmentSafetyReasons({
    kind: "plan",
    state,
    assignments: state.assignments,
    date,
    primaryAssignmentId: source.id,
    review: "recovery",
    changes: [
      { assignmentId: source.id, staffId: target.staffId },
      { assignmentId: target.id, staffId: source.staffId },
    ],
  });
  const tradeoffs = reasons.filter(isSoftTradeoff);
  const blockers = reasons.filter((reason) => !isSoftTradeoff(reason));
  const changes = [
    assignmentChange(source, target),
    assignmentChange(target, source),
  ];
  return {
    sourceAssignmentId,
    targetAssignmentId,
    changes,
    improvements: improvementMessages(source, target),
    tradeoffs,
    blockers,
    outcome: blockers.length
      ? "blocked"
      : tradeoffs.length
        ? "soft-tradeoff"
        : "safe",
  };
}
