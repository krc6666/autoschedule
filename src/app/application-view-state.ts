import type {
  ScheduleProgressStage,
  ScheduleProgressStep,
} from "../domain/kernel/schedule-progress";
import type { ScheduleProgressOutcome } from "../ui/projections/schedule-progress-tasks";
import type { FlightPlanReconciliation } from "../domain/flights/flight-plan-reconciliation";
import type { DutyRosterImportPreview } from "../infrastructure/duty-roster-excel";
import type { OnlineFlight } from "../infrastructure/flight-query";
import type { AppSection, AppState, IsoWeekday } from "../model";
import type { ManualSwapAnalysis } from "../domain/reviews/manual-swap-analysis";
import type { NextWorkdayFlightCandidate } from "../domain/flights/next-workday-flight-plan";

export type ApplicationDialog =
  | { kind: "templates" }
  | {
      kind: "next-workday-flight-picker";
      date: string;
      weekday: IsoWeekday;
      candidates: NextWorkdayFlightCandidate[];
      selectedIds: string[];
    }
  | { kind: "qualification"; positionRuleId: string }
  | {
      kind: "flight-query";
      date: string;
      loading: boolean;
      reconciliation: FlightPlanReconciliation<OnlineFlight> | null;
      fetchedAt: string;
      error: string;
    }
  | { kind: "duty-roster-import"; preview: DutyRosterImportPreview }
  | {
      kind: "workbook-import";
      mode: "all" | "config" | "history";
      importedState: AppState;
      recognized: string;
      warnings: string[];
    }
  | {
      kind: "swap-analysis";
      sourceAssignmentId: string;
      targetAssignmentId: string | null;
      analysis: ManualSwapAnalysis | null;
    };

export interface ApplicationToast {
  id: number;
  message: string;
  tone: "success" | "danger" | "warning";
}

export interface ScheduleProgressView {
  outcome: ScheduleProgressOutcome;
  visible: boolean;
  stage: ScheduleProgressStage;
  percent: number;
  steps: readonly ScheduleProgressStep[];
  canAdoptCurrentResult: boolean;
}

export interface ApplicationViewState {
  section: AppSection;
  date: string;
  zoom: number;
  loadSortField:
    "workHours" | "todayFatigue" | "historyFatigue" | "totalFatigue";
  loadSortDirection: "asc" | "desc";
  dialog: ApplicationDialog | null;
  toast: ApplicationToast | null;
  progress: ScheduleProgressView;
}
