import type { PluginSession } from "../infrastructure/plugin-session";
import type { AppState } from "../model";
import type { AutoscheduleStore } from "./store/autoschedule-store";
import type { ScheduleRunController } from "./schedule-run-controller";
import type { ApplicationViewState } from "./application-view-state";

export interface ApplicationContext {
  readonly store: AutoscheduleStore;
  readonly pluginSession: PluginSession;
  readonly scheduleRunner: ScheduleRunController;
  view(): ApplicationViewState;
  model(): AppState;
  updateView(patch: Partial<ApplicationViewState>): void;
  commit(message?: string): void;
  toast(message: string, tone?: "success" | "danger" | "warning"): void;
  confirm(message: string): boolean;
}

export interface UiCommandController {
  handle(
    command: import("../ui/events/ui-command").UiCommand
  ): boolean | Promise<boolean>;
}
