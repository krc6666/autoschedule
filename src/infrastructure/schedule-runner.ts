import type { AppState, ScheduleResult } from "../model";
import {
  generateSchedule,
  type ScheduleProgressStage,
} from "../domain/kernel/scheduling-kernel";
import type {
  ScheduleWorkerRequest,
  ScheduleWorkerResponse,
} from "./schedule-worker-protocol";

export type ScheduleProgressListener = (
  stage: ScheduleProgressStage,
  percent: number
) => void;

export async function runScheduleInBackground(
  state: AppState,
  date: string,
  onProgress: ScheduleProgressListener
): Promise<ScheduleResult> {
  if (typeof Worker === "undefined") {
    const { defaultHighsSolver } = await import("./solver/highs-solver");
    return generateSchedule(state, date, {
      solver: defaultHighsSolver,
      onProgress,
    });
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../schedule.worker.ts", import.meta.url),
      { type: "module" }
    );
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<ScheduleWorkerResponse>): void => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress(message.stage, message.percent);
        return;
      }
      finish();
      if (message.type === "result") resolve(message.result);
      else reject(new Error(message.message));
    };
    worker.onerror = (event): void => {
      finish();
      reject(
        new Error(event.message || "排班后台线程无法启动，请刷新页面后重试")
      );
    };
    try {
      worker.postMessage({
        state,
        date,
      } satisfies ScheduleWorkerRequest);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
