export const SCHEDULING_STAGE_ORDER = [
  "hard-constraint",
  "reserved-assignment",
  "coverage",
  "protection",
  "stable-order",
  "post-schedule-review",
] as const;

export type SchedulingRuleStage = (typeof SCHEDULING_STAGE_ORDER)[number];
export type SchedulingRuleFeedbackMode =
  "dedicated" | "aggregated" | "decision-only";

export const SCHEDULING_STAGE_LABELS: Readonly<
  Record<SchedulingRuleStage, string>
> = {
  "hard-constraint": "硬约束",
  "reserved-assignment": "特殊岗位锁定",
  coverage: "岗位完整性",
  protection: "人员保护与公平",
  "stable-order": "稳定排序",
  "post-schedule-review": "排班后轮岗复核",
};

export const SCHEDULING_RULES = [
  {
    id: "staff-eligibility",
    stage: "hard-constraint",
    label: "人员与岗位硬约束",
    feedbackMode: "aggregated",
  },
  {
    id: "ke166-supervisor",
    stage: "reserved-assignment",
    label: "KE166独立督导优先保留与缺员兼任",
    feedbackMode: "aggregated",
  },
  {
    id: "duty-position",
    stage: "reserved-assignment",
    label: "值班岗位锁定",
    feedbackMode: "dedicated",
    feedbackKey: "duty-roster",
  },
  {
    id: "scarce-qualification",
    stage: "coverage",
    label: "稀缺资质预留",
    feedbackMode: "decision-only",
  },
  {
    id: "position-compaction",
    stage: "coverage",
    label: "岗位空缺下沉",
    feedbackMode: "dedicated",
    feedbackKey: "morning-priority",
  },
  {
    id: "team-leader-concurrent-supervision",
    stage: "coverage",
    label: "分队长并行督导补缺",
    feedbackMode: "aggregated",
  },
  {
    id: "position-transition",
    stage: "protection",
    label: "严格岗位衔接",
    feedbackMode: "aggregated",
  },
  {
    id: "next-duty-rest",
    stage: "protection",
    label: "下班次值班人员预休",
    feedbackMode: "dedicated",
    feedbackKey: "next-duty-rest",
  },
  {
    id: "late-shift-recovery",
    stage: "protection",
    label: "跨工作日恢复保护",
    feedbackMode: "dedicated",
    feedbackKey: "previous-late",
  },
  {
    id: "late-shift-cutoff",
    stage: "protection",
    label: "末班重点岗位次班截止保护",
    feedbackMode: "dedicated",
    feedbackKey: "current-late",
  },
  {
    id: "priority-position-consecutive",
    stage: "protection",
    label: "重点岗位连续承担保护",
    feedbackMode: "aggregated",
  },
  {
    id: "high-fatigue-position-consecutive",
    stage: "protection",
    label: "高疲劳普通岗位连续承担保护",
    feedbackMode: "aggregated",
  },
  {
    id: "same-day-late-obligation",
    stage: "protection",
    label: "当天早晚负荷分散",
    feedbackMode: "aggregated",
  },
  {
    id: "preferred-position-transition",
    stage: "protection",
    label: "优先岗位衔接",
    feedbackMode: "aggregated",
  },
  {
    id: "staff-coverage",
    stage: "protection",
    label: "当日在岗覆盖",
    feedbackMode: "aggregated",
  },
  {
    id: "rolling-load",
    stage: "protection",
    label: "滚动负荷保护",
    feedbackMode: "aggregated",
  },
  {
    id: "high-load-recovery",
    stage: "protection",
    label: "连续高负荷保护",
    feedbackMode: "dedicated",
    feedbackKey: "high-load",
  },
  {
    id: "cross-workday-load",
    stage: "protection",
    label: "跨工作班负荷互补",
    feedbackMode: "dedicated",
    feedbackKey: "cross-workday-load",
  },
  {
    id: "position-frequency",
    stage: "protection",
    label: "重点岗位频率均衡",
    feedbackMode: "aggregated",
  },
  {
    id: "position-frequency-review",
    stage: "protection",
    label: "重点岗位频率安全重排",
    feedbackMode: "dedicated",
    feedbackKey: "position-frequency-review",
  },
  {
    id: "workload-balance",
    stage: "protection",
    label: "工时与疲劳均衡",
    feedbackMode: "aggregated",
  },
  {
    id: "historical-fatigue",
    stage: "stable-order",
    label: "历史疲劳",
    feedbackMode: "aggregated",
  },
  {
    id: "staff-id",
    stage: "stable-order",
    label: "人员编号",
    feedbackMode: "decision-only",
  },
  {
    id: "position-rotation",
    stage: "post-schedule-review",
    label: "连续轮岗复核",
    feedbackMode: "dedicated",
    feedbackKey: "position-rotation",
  },
] as const satisfies readonly (
  | {
      id: string;
      stage: SchedulingRuleStage;
      label: string;
      feedbackMode: Exclude<SchedulingRuleFeedbackMode, "dedicated">;
    }
  | {
      id: string;
      stage: SchedulingRuleStage;
      label: string;
      feedbackMode: "dedicated";
      feedbackKey: string;
    }
)[];

export type SchedulingRuleId = (typeof SCHEDULING_RULES)[number]["id"];
export type PluginSchedulingRuleId = `plugin:${string}`;
export type RuleFeedbackKey = Extract<
  (typeof SCHEDULING_RULES)[number],
  { feedbackMode: "dedicated" }
>["feedbackKey"];

export const RULE_FEEDBACK_ORDER = [
  "morning-priority",
  "high-load",
  "cross-workday-load",
  "position-frequency-review",
  "position-rotation",
  "next-duty-rest",
  "previous-late",
  "current-late",
  "duty-roster",
] as const satisfies readonly RuleFeedbackKey[];
export type SchedulingDecisionOutcome =
  "selected" | "blocked" | "fallback" | "preserved";

export interface SchedulingDecision {
  ruleId: SchedulingRuleId | PluginSchedulingRuleId;
  stage: SchedulingRuleStage;
  outcome: SchedulingDecisionOutcome;
  message: string;
  ruleLabel?: string;
}

const RULE_DEFINITION_BY_ID = Object.fromEntries(
  SCHEDULING_RULES.map((definition) => [definition.id, definition])
) as Readonly<Record<SchedulingRuleId, (typeof SCHEDULING_RULES)[number]>>;

export function schedulingRuleDefinition(
  ruleId: SchedulingRuleId
): (typeof SCHEDULING_RULES)[number] {
  return RULE_DEFINITION_BY_ID[ruleId];
}

export function schedulingDecision(
  ruleId: SchedulingRuleId,
  outcome: SchedulingDecisionOutcome,
  message: string
): SchedulingDecision {
  return {
    ruleId,
    stage: schedulingRuleDefinition(ruleId).stage,
    outcome,
    message,
  };
}

export function schedulingRuleLabel(ruleId: SchedulingRuleId): string {
  return schedulingRuleDefinition(ruleId).label;
}

export function pluginSchedulingDecision(
  ruleId: PluginSchedulingRuleId,
  ruleLabel: string,
  stage: Extract<SchedulingRuleStage, "protection" | "stable-order">,
  outcome: SchedulingDecisionOutcome,
  message: string
): SchedulingDecision {
  return { ruleId, ruleLabel, stage, outcome, message };
}
