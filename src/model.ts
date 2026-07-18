export type StaffStatus = "正常" | "病假" | "休假";

export interface Staff {
  id: string;
  name: string;
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
  category: "常规" | "支援";
  remark: string;
  qualifiedStaffIds: string[];
  manual: boolean;
  fatiguePoints: number;
  minPassengers: number;
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
}

export interface ScheduleSettings {
  maxDailyHours: number;
  historyWindowDays: number;
  nightStart: string;
  nightEnd: string;
  nightMultiplier: number;
  consecutiveDayPenalty: number;
}

export interface AppState {
  version: 1;
  staff: Staff[];
  flights: Flight[];
  templates: FlightTemplate[];
  positionRules: PositionRule[];
  history: HistoryRecord[];
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

export type AppSection = "overview" | "config" | "flights" | "schedule" | "history";
