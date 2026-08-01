import type {
  ScheduleProgressStage,
  ScheduleProgressStep,
} from "../domain/kernel/schedule-progress";
import type { ScheduleProgressOutcome } from "../ui/projections/schedule-progress-tasks";
import type { FlightPlanReconciliation } from "../domain/flights/flight-plan-reconciliation";
import type { DutyRosterImportPreview } from "../infrastructure/duty-roster-excel";
import type { OnlineFlight } from "../infrastructure/flight-query";
import type { AppSection } from "../model";

export type ApplicationDialog =
  | { kind: "templates" }
  | { kind: "qualification"; positionRuleId: string }
  | {
      kind: "flight-query";
      date: string;
      loading: boolean;
      reconciliation: FlightPlanReconciliation<OnlineFlight> | null;
      fetchedAt: string;
      error: string;
    }
  | { kind: "duty-roster-import"; preview: DutyRosterImportPreview };

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
