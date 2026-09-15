export interface PositionTransitionPolicy {
  id: string;
  name: string;
  enabled: boolean;
  sourceFlightNo: string;
  sourcePositions: string[];
  targetFlightNo: string;
  targetPosition: string;
  minimumGapMinutes: number;
  mode: "prefer" | "forbid";
}

export interface DutyPositionPriority {
  id: string;
  flightNo: string;
  positionKeyword: string;
  enabled: boolean;
}

export interface NextWorkdayRecoveryTarget {
  id: string;
  flightNo: string;
  positionKeyword: string;
  enabled: boolean;
}

export interface LateShiftRecoveryPositionRule {
  id: string;
  enabled: boolean;
  flightNo: string;
  matchField: "position" | "remark";
  keyword: string;
  nextWorkdayCutoffTime: string;
}

export interface MobileSupervisorCoverageRule {
  id: string;
  enabled: boolean;
  flightNo: string;
  matchField: "position" | "remark";
  keyword: string;
  mode: "allow" | "forbid";
}

export interface CrossWorkdayQualificationReservation {
  id: string;
  enabled: boolean;
  flightNo: string;
  matchField: "position" | "remark";
  keyword: string;
  minimumStaffCount: number;
}

export interface CrossFlightPriorityPolicy {
  id: string;
  enabled: boolean;
  flightNo: string;
  positions: string[];
}

export interface SameFlightStaffExclusion {
  id: string;
  firstStaffId: string;
  secondStaffId: string;
  /** Empty means every flight. */
  flightNo: string;
}

export interface StructuredSchedulePolicies {
  sameFlightStaffExclusions: SameFlightStaffExclusion[];
  positionTransitionPolicies: PositionTransitionPolicy[];
  dutyPositionPriorities: DutyPositionPriority[];
  nextWorkdayRecoveryTargets: NextWorkdayRecoveryTarget[];
  lateShiftRecoveryPositionRules: LateShiftRecoveryPositionRule[];
  mobileSupervisorCoverageRules: MobileSupervisorCoverageRule[];
  crossWorkdayQualificationReservations: CrossWorkdayQualificationReservation[];
  crossFlightPriorityPolicies: CrossFlightPriorityPolicy[];
}

export const STRUCTURED_POLICY_KEYS = [
  "sameFlightStaffExclusions",
  "positionTransitionPolicies",
  "dutyPositionPriorities",
  "nextWorkdayRecoveryTargets",
  "lateShiftRecoveryPositionRules",
  "mobileSupervisorCoverageRules",
  "crossWorkdayQualificationReservations",
  "crossFlightPriorityPolicies",
] as const satisfies readonly (keyof StructuredSchedulePolicies)[];
