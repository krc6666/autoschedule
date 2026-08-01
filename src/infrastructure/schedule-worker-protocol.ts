import type { AppState, ScheduleResult } from "../model";
import type { ScheduleProgressStage } from "../domain/kernel/scheduling-kernel";
import type { PluginManifest } from "./plugin-protocol";

export interface ScheduleWorkerRequest {
  state: AppState;
  date: string;
  plugins: PluginManifest[];
}

export type ScheduleWorkerResponse =
  | { type: "progress"; stage: ScheduleProgressStage; percent: number }
  | { type: "result"; result: ScheduleResult }
  | { type: "error"; message: string };
