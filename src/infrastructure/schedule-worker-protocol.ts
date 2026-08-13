import type { AppState, ScheduleResult } from "../model";
import type { ScheduleProgressStage } from "../domain/kernel/scheduling-kernel";

export interface ScheduleWorkerRequest {
  state: AppState;
  date: string;
}

export type ScheduleWorkerResponse =
  | { type: "progress"; stage: ScheduleProgressStage; percent: number }
  | { type: "safe-result"; result: ScheduleResult }
  | { type: "result"; result: ScheduleResult }
  | { type: "error"; message: string };
