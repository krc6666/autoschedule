import { generateSchedule } from "./domain/scheduler";
import type {
  ScheduleWorkerRequest,
  ScheduleWorkerResponse,
} from "./infrastructure/schedule-worker-protocol";

self.onmessage = (event: MessageEvent<ScheduleWorkerRequest>): void => {
  try {
    const result = generateSchedule(event.data.state, event.data.date, {
      onProgress: (stage, percent) => {
        self.postMessage({
          type: "progress",
          stage,
          percent,
        } satisfies ScheduleWorkerResponse);
      },
    });
    self.postMessage({
      type: "result",
      result,
    } satisfies ScheduleWorkerResponse);
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies ScheduleWorkerResponse);
  }
};
