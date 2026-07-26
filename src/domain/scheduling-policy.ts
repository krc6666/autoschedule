import type { PositionRule, SchedulingDecision, SchedulingRuleId, SchedulingRuleStage } from "../model";

export interface SchedulingRuleDefinition {
  id: SchedulingRuleId;
  stage: SchedulingRuleStage;
  label: string;
}

export const PRIORITY_ROTATION_POSITION_KEYWORDS = ["一号", "申报", "督导", "控制", "送资料"] as const;

export function isPriorityRotationPosition(rule: Pick<PositionRule, "category" | "name" | "remark">): boolean {
  if (rule.category !== "常规") return false;
  const searchable = `${rule.name} ${rule.remark}`;
  return PRIORITY_ROTATION_POSITION_KEYWORDS.some((keyword) => searchable.includes(keyword));
}

export const SCHEDULING_STAGE_ORDER = [
  "hard-constraint",
  "reserved-assignment",
  "coverage",
  "protection",
  "stable-order",
  "post-schedule-review"
] as const satisfies readonly SchedulingRuleStage[];

export const SCHEDULING_STAGE_LABELS: Readonly<Record<SchedulingRuleStage, string>> = {
  "hard-constraint": "硬约束",
  "reserved-assignment": "特殊岗位锁定",
  coverage: "岗位完整性",
  protection: "人员保护与公平",
  "stable-order": "稳定排序",
  "post-schedule-review": "排班后轮岗复核"
};

export const SCHEDULING_RULES: readonly SchedulingRuleDefinition[] = [
  { id: "staff-eligibility", stage: "hard-constraint", label: "人员与岗位硬约束" },
  { id: "duty-position", stage: "reserved-assignment", label: "值班岗位锁定" },
  { id: "ke166-supervisor", stage: "reserved-assignment", label: "KE166机动督导锁定" },
  { id: "scarce-qualification", stage: "coverage", label: "稀缺资质预留" },
  { id: "staff-coverage", stage: "coverage", label: "当日在岗覆盖" },
  { id: "position-compaction", stage: "coverage", label: "岗位空缺下沉" },
  { id: "position-transition", stage: "protection", label: "岗位衔接保护" },
  { id: "late-shift-recovery", stage: "protection", label: "跨工作日恢复保护" },
  { id: "rolling-load", stage: "protection", label: "滚动负荷保护" },
  { id: "high-load-recovery", stage: "protection", label: "连续高负荷保护" },
  { id: "position-frequency", stage: "protection", label: "重点岗位频率均衡" },
  { id: "position-frequency-review", stage: "protection", label: "重点岗位频率安全重排" },
  { id: "workload-balance", stage: "protection", label: "工时与疲劳均衡" },
  { id: "historical-fatigue", stage: "stable-order", label: "历史疲劳" },
  { id: "staff-id", stage: "stable-order", label: "人员编号" },
  { id: "position-rotation", stage: "post-schedule-review", label: "连续轮岗复核" }
] as const;

export const CANDIDATE_PRIORITY_ORDER = [
  "duty-position",
  "ke166-supervisor",
  "scarce-qualification",
  "staff-coverage",
  "position-transition",
  "late-shift-recovery",
  "rolling-load",
  "high-load-recovery",
  "position-frequency",
  "workload-balance",
  "historical-fatigue",
  "staff-id"
] as const satisfies readonly SchedulingRuleId[];

export type CandidatePriorityId = typeof CANDIDATE_PRIORITY_ORDER[number];

export interface CandidatePriority {
  dutyPosition: "reserved-target" | "unrelated" | "reserved-elsewhere";
  missingKe166SupervisorQualification: boolean;
  strictTransitionViolations: number;
  preferredTransitionViolations: number;
  scarceQualification: {
    futureTaskCount: number;
    minimumEligibleStaff: number | null;
  };
  alreadyAssignedToday: boolean;
  lateShiftRecovery: {
    protectedWorker: boolean;
    fatigueExcess: number;
  };
  rollingLoadExcess: number;
  highLoadRecoveryConflict: boolean;
  positionFrequency: {
    currentMonthCount: number;
    recentWorkdayCount: number;
  };
  workloadBalance: {
    violatesConfiguredTarget: boolean;
    todayHoursExcess: number;
    rollingHoursExcess: number;
    todayFatigueExcess: number;
    todayHoursSpread: number;
    rollingHoursSpread: number;
    todayFatigueSpread: number;
  };
  historicalFatigue: number;
  staffOrder: number;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

const DUTY_POSITION_ORDER: Readonly<Record<CandidatePriority["dutyPosition"], number>> = {
  "reserved-target": 0,
  unrelated: 1,
  "reserved-elsewhere": 2
};

function compareScarceQualification(left: CandidatePriority, right: CandidatePriority): number {
  const leftHasFutureTask = left.scarceQualification.futureTaskCount > 0;
  const rightHasFutureTask = right.scarceQualification.futureTaskCount > 0;
  if (leftHasFutureTask !== rightHasFutureTask) return Number(leftHasFutureTask) - Number(rightHasFutureTask);
  if (!leftHasFutureTask) return 0;
  const minimumEligibleDifference = (right.scarceQualification.minimumEligibleStaff ?? 0)
    - (left.scarceQualification.minimumEligibleStaff ?? 0);
  return minimumEligibleDifference
    || left.scarceQualification.futureTaskCount - right.scarceQualification.futureTaskCount;
}

function compareLateShiftRecovery(left: CandidatePriority, right: CandidatePriority): number {
  return Number(left.lateShiftRecovery.protectedWorker) - Number(right.lateShiftRecovery.protectedWorker)
    || left.lateShiftRecovery.fatigueExcess - right.lateShiftRecovery.fatigueExcess;
}

function compareWorkloadBalance(left: CandidatePriority, right: CandidatePriority): number {
  return Number(left.workloadBalance.violatesConfiguredTarget) - Number(right.workloadBalance.violatesConfiguredTarget)
    || left.workloadBalance.todayHoursExcess - right.workloadBalance.todayHoursExcess
    || left.workloadBalance.rollingHoursExcess - right.workloadBalance.rollingHoursExcess
    || left.workloadBalance.todayFatigueExcess - right.workloadBalance.todayFatigueExcess
    || left.workloadBalance.todayHoursSpread - right.workloadBalance.todayHoursSpread
    || left.workloadBalance.rollingHoursSpread - right.workloadBalance.rollingHoursSpread
    || left.workloadBalance.todayFatigueSpread - right.workloadBalance.todayFatigueSpread;
}

function comparePositionFrequency(left: CandidatePriority, right: CandidatePriority): number {
  return compareNumber(left.positionFrequency.currentMonthCount, right.positionFrequency.currentMonthCount)
    || compareNumber(left.positionFrequency.recentWorkdayCount, right.positionFrequency.recentWorkdayCount);
}

const CANDIDATE_PRIORITY_COMPARATORS: Readonly<Record<CandidatePriorityId, (left: CandidatePriority, right: CandidatePriority) => number>> = {
  "duty-position": (left, right) => compareNumber(DUTY_POSITION_ORDER[left.dutyPosition], DUTY_POSITION_ORDER[right.dutyPosition]),
  "ke166-supervisor": (left, right) => Number(left.missingKe166SupervisorQualification) - Number(right.missingKe166SupervisorQualification),
  "position-transition": (left, right) => compareNumber(left.strictTransitionViolations, right.strictTransitionViolations)
    || compareNumber(left.preferredTransitionViolations, right.preferredTransitionViolations),
  "scarce-qualification": compareScarceQualification,
  "staff-coverage": (left, right) => Number(left.alreadyAssignedToday) - Number(right.alreadyAssignedToday),
  "late-shift-recovery": compareLateShiftRecovery,
  "rolling-load": (left, right) => compareNumber(left.rollingLoadExcess, right.rollingLoadExcess),
  "high-load-recovery": (left, right) => Number(left.highLoadRecoveryConflict) - Number(right.highLoadRecoveryConflict),
  "position-frequency": comparePositionFrequency,
  "workload-balance": compareWorkloadBalance,
  "historical-fatigue": (left, right) => compareNumber(left.historicalFatigue, right.historicalFatigue),
  "staff-id": (left, right) => compareNumber(left.staffOrder, right.staffOrder)
};

export function firstDifferentCandidateRule(left: CandidatePriority, right: CandidatePriority): CandidatePriorityId | null {
  return CANDIDATE_PRIORITY_ORDER.find((ruleId) => CANDIDATE_PRIORITY_COMPARATORS[ruleId](left, right) !== 0) ?? null;
}

export function compareCandidatePriority(left: CandidatePriority, right: CandidatePriority): number {
  for (const ruleId of CANDIDATE_PRIORITY_ORDER) {
    const difference = CANDIDATE_PRIORITY_COMPARATORS[ruleId](left, right);
    if (difference) return difference;
  }
  return 0;
}

export function schedulingDecision(
  ruleId: SchedulingRuleId,
  outcome: SchedulingDecision["outcome"],
  message: string
): SchedulingDecision {
  const definition = SCHEDULING_RULES.find((rule) => rule.id === ruleId);
  if (!definition) throw new Error(`未登记的排班规则：${ruleId}`);
  return { ruleId, stage: definition.stage, outcome, message };
}

export function schedulingRuleLabel(ruleId: SchedulingRuleId): string {
  const definition = SCHEDULING_RULES.find((rule) => rule.id === ruleId);
  if (!definition) throw new Error(`未登记的排班规则：${ruleId}`);
  return definition.label;
}
