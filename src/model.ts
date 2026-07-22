export type StaffStatus = "正常" | "病假" | "休假";
export type StaffType = "常规" | "行政支援";

export interface Staff {
  id: string;
  name: string;
  staffType: StaffType;
  cxPreflightQualified: boolean;
  dutyQualified: boolean;
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

export interface FlightTemplate extends Omit<Flight, "id" | "bookedPassengers"> {
  id: string;
}

export interface PositionRule {
  id: string;
  flightNo: string;
  name: string;
  category: "常规" | "引导" | "督导补位" | "分流" | "行政支援";
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
  supervisorFillDetached?: boolean;
  layoutGroup?: "primary" | "bottom";
  layoutIndex?: number;
}

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

export interface DutyRosterOverride {
  date: string;
  cxPreflightStaffId: string | null;
  dutyStaffId: string | null;
  standbyStaffIds: [string | null, string | null];
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
  highLoadTransitionMode: "prefer" | "forbid";
  positionTransitionPolicies: PositionTransitionPolicy[];
  rollingLoadProtectionEnabled: boolean;
  rollingLoadWindowMinutes: number;
  rollingLoadMaxFatigue: number;
  rollingLoadMode: "prefer" | "forbid";
  positionRotationEnabled: boolean;
  positionRotationLookbackDays: number;
  positionRotationMode: "prefer" | "forbid";
  lateShiftRecoveryEnabled: boolean;
  lateShiftStartTime: string;
  lateShiftLatestWindowMinutes: number;
  nextDayLateMaxFatigue: number;
  lateShiftRecoveryMode: "prefer" | "forbid";
  dutyFatiguePoints: number;
  workloadBalanceEnabled: boolean;
  maxWorkHoursDifference: number;
  maxTodayFatigueDifference: number;
}

export interface AppState {
  version: 1;
  staff: Staff[];
  flights: Flight[];
  templates: FlightTemplate[];
  positionRules: PositionRule[];
  history: HistoryRecord[];
  dutyRosterOverrides: DutyRosterOverride[];
  assignments: Assignment[];
  activeScheduleDate: string | null;
  settings: ScheduleSettings;
  updatedAt: string;
}

export interface ScheduleResult {
  assignments: Assignment[];
  unfilledCount: number;
  warnings: string[];
}

export type AppSection = "overview" | "config" | "flights" | "schedule" | "policy" | "history";
