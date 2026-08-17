import type { ScheduleResult } from "../model";
import type { ScheduleProgressStage } from "../domain/kernel/scheduling-kernel";
import type { ScheduleGenerationFacts } from "../domain/shared/scheduling-facts";

export interface ScheduleWorkerRequest {
  state: ScheduleGenerationFacts;
  date: string;
}

export type ScheduleWorkerResponse =
  | { type: "progress"; stage: ScheduleProgressStage; percent: number }
  | { type: "safe-result"; result: ScheduleResult }
  | { type: "result"; result: ScheduleResult }
  | { type: "error"; message: string };
