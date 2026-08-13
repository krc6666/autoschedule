import { generateSchedule } from "./domain/kernel/scheduling-kernel";
import type {
  ScheduleWorkerRequest,
  ScheduleWorkerResponse,
} from "./infrastructure/schedule-worker-protocol";
import {
  defaultHighsSolver,
  HighsSolver,
} from "./infrastructure/solver/highs-solver";

self.onmessage = async (
  event: MessageEvent<ScheduleWorkerRequest>
): Promise<void> => {
  try {
    const result = await generateSchedule(event.data.state, event.data.date, {
      solver: defaultHighsSolver,
      checkpointSolver: new HighsSolver(),
      onProgress: (stage, percent) => {
        self.postMessage({
          type: "progress",
          stage,
          percent,
        } satisfies ScheduleWorkerResponse);
      },
      onSafeResult: (safeResult) => {
        self.postMessage({
          type: "safe-result",
          result: safeResult,
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
