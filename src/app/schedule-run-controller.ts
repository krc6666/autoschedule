import type { ScheduleProgressStage } from "../domain/kernel/schedule-progress";
import {
  runScheduleInBackground,
  type ScheduleProgressListener,
} from "../infrastructure/schedule-runner";
import type { AppState, ScheduleResult } from "../model";

export interface ScheduleRunControllerDependencies {
  run: (
    state: AppState,
    date: string,
    onProgress: ScheduleProgressListener
  ) => Promise<ScheduleResult>;
  yieldToBrowser: () => Promise<void>;
  start: () => void;
  progress: (stage: ScheduleProgressStage, percent: number) => void;
  finish: (outcome: "completed" | "failed") => void;
}

export class ScheduleRunController {
  private running = false;

  constructor(
    private readonly dependencies: ScheduleRunControllerDependencies
  ) {}

  async calculate(state: AppState, date: string): Promise<ScheduleResult> {
    if (this.running) throw new Error("排班正在运行，请等待当前任务完成");
    this.running = true;
    this.dependencies.start();
    await this.dependencies.yieldToBrowser();
    try {
      const result = await this.dependencies.run(
        state,
        date,
        this.dependencies.progress
      );
      this.dependencies.finish("completed");
      return result;
    } catch (error) {
      this.dependencies.finish("failed");
      throw error;
    } finally {
      this.running = false;
    }
  }
}

export interface BrowserScheduleRunCallbacks {
  start(): void;
  progress(stage: ScheduleProgressStage, percent: number): void;
  finish(outcome: "completed" | "failed"): void;
}

export function createBrowserScheduleRunController(
  callbacks: BrowserScheduleRunCallbacks
): ScheduleRunController {
  return new ScheduleRunController({
    run: runScheduleInBackground,
    yieldToBrowser: () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    ...callbacks,
  });
}
