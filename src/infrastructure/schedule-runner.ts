import type { AppState, ScheduleResult } from "../model";
import {
  generateSchedule,
  type ScheduleProgressStage,
} from "../domain/kernel/scheduling-kernel";
import type {
  ScheduleWorkerRequest,
  ScheduleWorkerResponse,
} from "./schedule-worker-protocol";
import type { PluginManifest } from "./plugin-protocol";

export type ScheduleProgressListener = (
  stage: ScheduleProgressStage,
  percent: number
) => void;

export async function runScheduleInBackground(
  state: AppState,
  date: string,
  onProgress: ScheduleProgressListener,
  plugins: readonly PluginManifest[] = []
): Promise<ScheduleResult> {
  if (typeof Worker === "undefined") {
    const { defaultHighsSolver } = await import("./solver/highs-solver");
    return generateSchedule(state, date, {
      solver: defaultHighsSolver,
      onProgress,
      plugins,
    });
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../schedule.worker.ts", import.meta.url),
      { type: "module" }
    );
    const finish = (): void => worker.terminate();
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
      reject(new Error(event.message || "排班后台线程运行失败"));
    };
    worker.postMessage({
      state,
      date,
      plugins: plugins.map((plugin) => structuredClone(plugin)),
    } satisfies ScheduleWorkerRequest);
  });
}
