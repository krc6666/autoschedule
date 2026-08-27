import type { AppState, ScheduleResult } from "../model";
import { createScheduleGenerationFacts } from "../domain/shared/scheduling-facts";
import {
  generateSchedule,
  type ScheduleProgressStage,
} from "../domain/kernel/scheduling-kernel";
import type {
  ScheduleWorkerRequest,
  ScheduleWorkerResponse,
} from "./schedule-worker-protocol";
import {
  normalizeScheduleRunPreferences,
  type ScheduleRunPreferences,
} from "../domain/shared/schedule-run-preferences";

export type ScheduleProgressListener = (
  stage: ScheduleProgressStage,
  percent: number
) => void;

export type ScheduleRunOutcome =
  | { kind: "completed"; result: ScheduleResult }
  | { kind: "stopped-without-result" }
  | { kind: "stopped-with-result"; result: ScheduleResult };

export interface ActiveScheduleRun {
  result: Promise<ScheduleRunOutcome>;
  stopWithoutResult(): boolean;
  stopWithLatestResult(): boolean;
  hasLatestSafeResult(): boolean;
}

export function runScheduleInBackground(
  state: AppState,
  date: string,
  onProgress: ScheduleProgressListener,
  onSafeResultAvailable: () => void = () => undefined,
  preferences?: ScheduleRunPreferences
): ActiveScheduleRun {
  const schedulingFacts = createScheduleGenerationFacts(state);
  const runPreferences = normalizeScheduleRunPreferences(preferences);
  if (typeof Worker === "undefined") {
    let stopped = false;
    let latestSafeResult: ScheduleResult | undefined;
    const result = (async (): Promise<ScheduleRunOutcome> => {
      const { defaultHighsSolver, HighsSolver } =
        await import("./solver/highs-solver");
      const completed = await generateSchedule(schedulingFacts, date, {
        solver: defaultHighsSolver,
        checkpointSolver: new HighsSolver(),
        preferences: runPreferences,
        onProgress,
        onSafeResult: (safeResult) => {
          latestSafeResult = safeResult;
          onSafeResultAvailable();
        },
      });
      return stopped
        ? latestSafeResult
          ? { kind: "stopped-with-result", result: latestSafeResult }
          : { kind: "stopped-without-result" }
        : { kind: "completed", result: completed };
    })();
    return {
      result,
      stopWithoutResult: () => {
        stopped = true;
        latestSafeResult = undefined;
        return true;
      },
      stopWithLatestResult: () => {
        if (!latestSafeResult) return false;
        stopped = true;
        return true;
      },
      hasLatestSafeResult: () => Boolean(latestSafeResult),
    };
  }

  const worker = new Worker(new URL("../schedule.worker.ts", import.meta.url), {
    type: "module",
  });
  let finished = false;
  let latestSafeResult: ScheduleResult | undefined;
  let resolveResult!: (outcome: ScheduleRunOutcome) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<ScheduleRunOutcome>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const finish = (): boolean => {
    if (finished) return false;
    finished = true;
    worker.terminate();
    return true;
  };
  worker.onmessage = (event: MessageEvent<ScheduleWorkerResponse>): void => {
    const message = event.data;
    if (message.type === "progress") {
      onProgress(message.stage, message.percent);
      return;
    }
    if (message.type === "safe-result") {
      latestSafeResult = message.result;
      onSafeResultAvailable();
      return;
    }
    if (!finish()) return;
    if (message.type === "result")
      resolveResult({ kind: "completed", result: message.result });
    else rejectResult(new Error(message.message));
  };
  worker.onerror = (event): void => {
    if (!finish()) return;
    rejectResult(
      new Error(event.message || "排班后台线程无法启动，请刷新页面后重试")
    );
  };
  try {
    worker.postMessage({
      state: schedulingFacts,
      date,
      preferences: runPreferences,
    } satisfies ScheduleWorkerRequest);
  } catch (error) {
    finish();
    rejectResult(error);
  }
  return {
    result,
    stopWithoutResult: () => {
      if (!finish()) return false;
      latestSafeResult = undefined;
      resolveResult({ kind: "stopped-without-result" });
      return true;
    },
    stopWithLatestResult: () => {
      if (!latestSafeResult || !finish()) return false;
      resolveResult({ kind: "stopped-with-result", result: latestSafeResult });
      return true;
    },
    hasLatestSafeResult: () => Boolean(latestSafeResult),
  };
}
