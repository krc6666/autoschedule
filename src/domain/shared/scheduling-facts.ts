import type {
  AppState,
  Assignment,
  DutyRosterOverride,
  Flight,
  FlightTemplate,
  HistoryRecord,
  PositionRule,
  ScheduleSettings,
  Staff,
} from "../../model";

/**
 * Domain-facing state projection. It deliberately excludes application
 * lifecycle, weekly-plan metadata, versioning and persistence timestamps.
 */
export interface SchedulingFacts {
  staff: Staff[];
  flights: Flight[];
  templates: FlightTemplate[];
  positionRules: PositionRule[];
  history: HistoryRecord[];
  dutyRosterOverrides: DutyRosterOverride[];
  assignments: Assignment[];
  settings: ScheduleSettings;
  activeScheduleDate: string | null;
}

export type ScheduleGenerationFacts = Pick<
  SchedulingFacts,
  | "staff"
  | "flights"
  | "templates"
  | "positionRules"
  | "history"
  | "dutyRosterOverrides"
  | "assignments"
  | "settings"
>;

export type AssignmentEligibilityFacts = Pick<
  ScheduleGenerationFacts,
  "staff" | "flights" | "positionRules" | "assignments" | "settings"
>;

export type AssignmentTimingFacts = Pick<
  ScheduleGenerationFacts,
  "flights" | "positionRules" | "assignments" | "settings"
>;

export type FlightRuleFacts = Pick<
  ScheduleGenerationFacts,
  "flights" | "positionRules" | "settings"
>;

export type HistoryRuleFacts = Pick<
  ScheduleGenerationFacts,
  "history" | "settings"
>;

export type PositionFrequencyFacts = Pick<
  ScheduleGenerationFacts,
  "history" | "positionRules" | "settings"
>;

export type ScheduleSettingsFacts = Pick<ScheduleGenerationFacts, "settings">;

export type WorkloadFacts = Pick<
  ScheduleGenerationFacts,
  | "staff"
  | "flights"
  | "positionRules"
  | "history"
  | "assignments"
  | "dutyRosterOverrides"
  | "settings"
>;

export type DutyRosterFacts = Pick<
  ScheduleGenerationFacts,
  "staff" | "history" | "dutyRosterOverrides" | "settings"
>;

export type WorkloadAccountingFacts = Pick<
  ScheduleGenerationFacts,
  "staff" | "positionRules" | "assignments"
>;

export type StaffAssignmentFacts = Pick<
  ScheduleGenerationFacts,
  "staff" | "positionRules" | "assignments"
>;

export function createScheduleGenerationFacts(
  state: Pick<
    AppState,
    | "staff"
    | "flights"
    | "templates"
    | "positionRules"
    | "history"
    | "dutyRosterOverrides"
    | "assignments"
    | "settings"
  >
): ScheduleGenerationFacts {
  return {
    staff: state.staff,
    flights: state.flights,
    templates: state.templates,
    positionRules: state.positionRules,
    history: state.history,
    dutyRosterOverrides: state.dutyRosterOverrides,
    assignments: state.assignments,
    settings: state.settings,
  };
}

export function createSchedulingFacts(
  state: Pick<
    AppState,
    | "staff"
    | "flights"
    | "templates"
    | "positionRules"
    | "history"
    | "dutyRosterOverrides"
    | "assignments"
    | "settings"
    | "activeScheduleDate"
  >
): SchedulingFacts {
  return {
    ...createScheduleGenerationFacts(state),
    activeScheduleDate: state.activeScheduleDate,
  };
}
