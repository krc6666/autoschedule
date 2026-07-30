import type {
  DutyPositionPriority,
  LateShiftRecoveryPositionRule,
  MobileSupervisorCoverageRule,
  NextWorkdayRecoveryTarget,
  PositionTransitionPolicy,
  StructuredSchedulePolicies,
} from "../structured-policy-contract";

const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_STRUCTURED_POLICIES: StructuredSchedulePolicies = {
  lateShiftRecoveryPositionRules: [
    {
      id: "late-recovery-supervisor",
      enabled: true,
      flightNo: "",
      matchField: "position",
      keyword: "督导",
      nextWorkdayCutoffTime: "",
    },
    {
      id: "late-recovery-one",
      enabled: true,
      flightNo: "",
      matchField: "remark",
      keyword: "一号",
      nextWorkdayCutoffTime: "",
    },
    {
      id: "late-recovery-declaration",
      enabled: true,
      flightNo: "",
      matchField: "remark",
      keyword: "申报",
      nextWorkdayCutoffTime: "",
    },
    {
      id: "late-recovery-delivery",
      enabled: true,
      flightNo: "",
      matchField: "remark",
      keyword: "送资料",
      nextWorkdayCutoffTime: "",
    },
  ],
  nextWorkdayRecoveryTargets: [
    {
      id: "recovery-target-cx937-one",
      flightNo: "CX937",
      positionKeyword: "一号",
      enabled: true,
    },
    {
      id: "recovery-target-cx937-control",
      flightNo: "CX937",
      positionKeyword: "控制",
      enabled: true,
    },
    {
      id: "recovery-target-ke166-one",
      flightNo: "KE166",
      positionKeyword: "一号",
      enabled: true,
    },
  ],
  dutyPositionPriorities: [
    {
      id: "duty-priority-tr121-h02",
      flightNo: "TR121",
      positionKeyword: "H02",
      enabled: true,
    },
    {
      id: "duty-priority-tw616-one",
      flightNo: "TW616",
      positionKeyword: "一号",
      enabled: true,
    },
  ],
  mobileSupervisorCoverageRules: [
    {
      id: "supervisor-forbid-one",
      enabled: true,
      flightNo: "",
      matchField: "remark",
      keyword: "一号",
      mode: "forbid",
    },
    {
      id: "supervisor-forbid-declare",
      enabled: true,
      flightNo: "",
      matchField: "remark",
      keyword: "申报",
      mode: "forbid",
    },
    {
      id: "supervisor-forbid-check",
      enabled: true,
      flightNo: "",
      matchField: "remark",
      keyword: "排查",
      mode: "forbid",
    },
  ],
  positionTransitionPolicies: [
    {
      id: "transition-cx931-tr121-h02",
      name: "TR121 H02 准备保护",
      enabled: true,
      sourceFlightNo: "CX931",
      sourcePositions: ["督导", "G20", "G19"],
      targetFlightNo: "TR121",
      targetPosition: "H02",
      minimumGapMinutes: 180,
      mode: "prefer",
    },
  ],
};

export function createDefaultStructuredPolicies(): StructuredSchedulePolicies {
  return structuredClone(DEFAULT_STRUCTURED_POLICIES);
}

function sourceArray<T>(value: unknown, fallback: T[]): T[] {
  return Array.isArray(value) ? value : fallback;
}

function normalizeTransitionPolicies(
  value: unknown,
  fallback: PositionTransitionPolicy[]
): PositionTransitionPolicy[] {
  return sourceArray(value, fallback)
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const policy = item as Partial<PositionTransitionPolicy>;
      const minimumGapMinutes = Number(policy.minimumGapMinutes);
      return {
        id: String(policy.id ?? "").trim() || `transition-policy-${index + 1}`,
        name: String(policy.name ?? "").trim() || "未命名衔接规则",
        enabled: policy.enabled !== false,
        sourceFlightNo: String(policy.sourceFlightNo ?? "")
          .trim()
          .toUpperCase(),
        sourcePositions: Array.isArray(policy.sourcePositions)
          ? policy.sourcePositions
              .map((position) => String(position).trim())
              .filter(Boolean)
          : [],
        targetFlightNo: String(policy.targetFlightNo ?? "")
          .trim()
          .toUpperCase(),
        targetPosition: String(policy.targetPosition ?? "").trim(),
        minimumGapMinutes: Math.min(
          1440,
          Math.max(
            0,
            Number.isFinite(minimumGapMinutes)
              ? Math.round(minimumGapMinutes)
              : 0
          )
        ),
        mode: policy.mode === "forbid" ? "forbid" : "prefer",
      };
    });
}

function normalizeDutyPriorities(
  value: unknown,
  fallback: DutyPositionPriority[]
): DutyPositionPriority[] {
  return sourceArray(value, fallback)
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const priority = item as Partial<DutyPositionPriority>;
      return {
        id: String(priority.id ?? "").trim() || `duty-priority-${index + 1}`,
        flightNo: String(priority.flightNo ?? "")
          .trim()
          .toUpperCase(),
        positionKeyword: String(priority.positionKeyword ?? "").trim(),
        enabled: priority.enabled !== false,
      };
    });
}

function normalizeRecoveryTargets(
  value: unknown,
  fallback: NextWorkdayRecoveryTarget[]
): NextWorkdayRecoveryTarget[] {
  return sourceArray(value, fallback)
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const target = item as Partial<NextWorkdayRecoveryTarget>;
      return {
        id: String(target.id ?? "").trim() || `recovery-target-${index + 1}`,
        flightNo: String(target.flightNo ?? "")
          .trim()
          .toUpperCase(),
        positionKeyword: String(target.positionKeyword ?? "").trim(),
        enabled: target.enabled !== false,
      };
    });
}

function normalizeLateShiftRules(
  value: unknown,
  fallback: LateShiftRecoveryPositionRule[]
): LateShiftRecoveryPositionRule[] {
  return sourceArray(value, fallback)
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const rule = item as Partial<LateShiftRecoveryPositionRule>;
      const cutoff = String(rule.nextWorkdayCutoffTime ?? "");
      return {
        id:
          String(rule.id ?? "").trim() || `late-recovery-position-${index + 1}`,
        enabled: rule.enabled !== false,
        flightNo: String(rule.flightNo ?? "")
          .trim()
          .toUpperCase(),
        matchField: rule.matchField === "position" ? "position" : "remark",
        keyword: String(rule.keyword ?? "").trim(),
        nextWorkdayCutoffTime: CLOCK_PATTERN.test(cutoff) ? cutoff : "",
      };
    });
}

function normalizeSupervisorRules(
  value: unknown,
  fallback: MobileSupervisorCoverageRule[]
): MobileSupervisorCoverageRule[] {
  return sourceArray(value, fallback)
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const rule = item as Partial<MobileSupervisorCoverageRule>;
      return {
        id: String(rule.id ?? "").trim() || `supervisor-coverage-${index + 1}`,
        enabled: rule.enabled !== false,
        flightNo: String(rule.flightNo ?? "")
          .trim()
          .toUpperCase(),
        matchField: rule.matchField === "position" ? "position" : "remark",
        keyword: String(rule.keyword ?? "").trim(),
        mode: rule.mode === "allow" ? "allow" : "forbid",
      };
    });
}

export function normalizeStructuredPolicies(
  input: Partial<StructuredSchedulePolicies>,
  fallback = createDefaultStructuredPolicies()
): StructuredSchedulePolicies {
  return {
    positionTransitionPolicies: normalizeTransitionPolicies(
      input.positionTransitionPolicies,
      fallback.positionTransitionPolicies
    ),
    dutyPositionPriorities: normalizeDutyPriorities(
      input.dutyPositionPriorities,
      fallback.dutyPositionPriorities
    ),
    nextWorkdayRecoveryTargets: normalizeRecoveryTargets(
      input.nextWorkdayRecoveryTargets,
      fallback.nextWorkdayRecoveryTargets
    ),
    lateShiftRecoveryPositionRules: normalizeLateShiftRules(
      input.lateShiftRecoveryPositionRules,
      fallback.lateShiftRecoveryPositionRules
    ),
    mobileSupervisorCoverageRules: normalizeSupervisorRules(
      input.mobileSupervisorCoverageRules,
      fallback.mobileSupervisorCoverageRules
    ),
  };
}
