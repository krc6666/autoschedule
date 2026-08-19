import type { SchedulingDecision } from "./domain/rules/schedule-rule-contract";
import type {
  CrossWorkdayQualificationReservation,
  CrossFlightPriorityPolicy,
  DutyPositionPriority,
  LateShiftRecoveryPositionRule,
  MobileSupervisorCoverageRule,
  NextWorkdayRecoveryTarget,
  PositionTransitionPolicy,
} from "./domain/rules/structured-policy-contract";
import type { LatePriorityFrequencyKind } from "./domain/reviews/late-priority-policy";

export type StaffStatus = "正常" | "病假" | "休假";
export type StaffType = "常规" | "行政支援";

export interface Staff {
  id: string;
  name: string;
  staffType: StaffType;
  teamLeader: boolean;
  cxPreflightQualified: boolean;
  dutyQualified: boolean;
  standbyQualified: boolean;
  nightShift: boolean;
  status: StaffStatus;
  remark: string;
}

export interface Flight {
  id: string;
  flightNo: string;
  startTime: string;
  endTime: string;
  bookedPassengers: number;
  positions: string[];
  remark: string;
}

export interface FlightTemplate extends Omit<
  Flight,
  "id" | "bookedPassengers"
> {
  id: string;
}

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WeeklyFlightPlanEntry {
  weekday: IsoWeekday;
  flightNos: string[];
}

export interface PositionRule {
  id: string;
  flightNo: string;
  name: string;
  category: "常规" | "引导" | "机动督导" | "分流" | "行政支援";
  remark: string;
  qualifiedStaffIds: string[];
  manual: boolean;
  fatiguePoints: number;
  minPassengers: number;
  earlyReleaseMinutes: number;
}

export interface HistoryRecord {
  id: string;
  date: string;
  flightNo: string;
  position: string;
  staffId: string;
  staffName: string;
  startTime: string;
  endTime: string;
  workHours: number;
  fatiguePoints: number;
  remark: string;
  /** Whether this record represents a complete day or a scoped legacy import. */
  historyCoverage?: "complete" | "late-priority-only";
}

export interface Assignment {
  id: string;
  flightId: string;
  flightNo: string;
  positionRuleId: string | null;
  position: string;
  staffId: string | null;
  staffName: string;
  startTime: string;
  endTime: string;
  workHours: number;
  fatiguePoints: number;
  remark: string;
  manualRemark: string;
  status: "assigned" | "unfilled" | "manual";
  systemNotes?: string[];
  decisionTrace?: SchedulingDecision[];
  manualOverrideWarnings?: Array<{ code: string; message: string }>;
  supervisorSourceAssignmentId?: string;
  layoutGroup?: "primary" | "bottom";
  layoutIndex?: number;
}

export interface DutyRosterOverride {
  date: string;
  cxPreflightStaffId: string | null;
  dutyStaffId: string | null;
  standbyStaffIds: [string | null, string | null];
}

export interface LatePriorityFrequencyAdjustment {
  month: string;
  staffId: string;
  flightNo: string;
  kind: LatePriorityFrequencyKind;
  delta: number;
}

export interface ScheduleSettings {
  maxDailyHours: number;
  historyWindowDays: number;
  nightStart: string;
  nightEnd: string;
  consecutiveDayPenalty: number;
  adminSupportEnabled: boolean;
  highLoadProtectionEnabled: boolean;
  highLoadFatigueThreshold: number;
  highLoadRecoveryMinutes: number;
  remarkedPositionHighLoad: boolean;
  minimumRegularTransitionMinutes: number;
  positionTransitionPolicies: PositionTransitionPolicy[];
  rollingLoadProtectionEnabled: boolean;
  rollingLoadWindowMinutes: number;
  rollingLoadMaxFatigue: number;
  positionRotationEnabled: boolean;
  latePriorityFlightNumbers: string[];
  lateShiftRecoveryEnabled: boolean;
  nextWorkdayRecoveryMode: "prefer" | "forbid";
  lateShiftEndTime: string;
  teamLeaderConcurrentSupervisionMaxOverlapMinutes: number;
  lateShiftRecoveryPositionRules: LateShiftRecoveryPositionRule[];
  nextWorkdayRecoveryTargets: NextWorkdayRecoveryTarget[];
  dutyFatiguePoints: number;
  dutyPositionPriorities: DutyPositionPriority[];
  mobileSupervisorCoverageRules: MobileSupervisorCoverageRule[];
  crossWorkdayQualificationReservations: CrossWorkdayQualificationReservation[];
  crossFlightPriorityPolicies: CrossFlightPriorityPolicy[];
  earlyDepartureCutoffTime: string;
  afternoonRestStartTime: string;
  afternoonRestEndTime: string;
  workloadBalanceEnabled: boolean;
  maxWorkHoursDifference: number;
  maxTodayFatigueDifference: number;
}

export interface AppState {
  version: 5;
  staff: Staff[];
  flights: Flight[];
  templates: FlightTemplate[];
  weeklyFlightPlans: WeeklyFlightPlanEntry[];
  positionRules: PositionRule[];
  history: HistoryRecord[];
  dutyRosterOverrides: DutyRosterOverride[];
  latePriorityFrequencyAdjustments: LatePriorityFrequencyAdjustment[];
  assignments: Assignment[];
  activeScheduleDate: string | null;
  schedulePolicyStale: boolean;
  settings: ScheduleSettings;
  updatedAt: string;
}

export interface ScheduleResult {
  assignments: Assignment[];
  unfilledCount: number;
  warnings: string[];
}

export type AppSection =
  | "overview"
  | "config"
  | "flights"
  | "schedule"
  | "policy"
  | "statistics"
  | "history";
