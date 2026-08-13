import type { ScheduleProgressStage } from "../domain/kernel/schedule-progress";
import {
  runScheduleInBackground,
  type ActiveScheduleRun,
  type ScheduleProgressListener,
  type ScheduleRunOutcome,
} from "../infrastructure/schedule-runner";
import type { AppState } from "../model";

export type ScheduleRunFinishOutcome =
  "completed" | "failed" | "stopped-without-result" | "stopped-with-result";

export interface ScheduleRunControllerDependencies {
  run: (
    state: AppState,
    date: string,
    onProgress: ScheduleProgressListener,
    onSafeResultAvailable: () => void
  ) => ActiveScheduleRun;
  yieldToBrowser: () => Promise<void>;
  start: () => void;
  progress: (stage: ScheduleProgressStage, percent: number) => void;
  safeResultAvailable?: () => void;
  finish: (outcome: ScheduleRunFinishOutcome) => void;
}

export class ScheduleRunController {
  private running = false;
  private activeRun: ActiveScheduleRun | null = null;

  constructor(
    private readonly dependencies: ScheduleRunControllerDependencies
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  canAdoptCurrentResult(): boolean {
    return this.activeRun?.hasLatestSafeResult() ?? false;
  }

  stopWithoutResult(): boolean {
    return this.activeRun?.stopWithoutResult() ?? false;
  }

  stopWithCurrentResult(): boolean {
    return this.activeRun?.stopWithLatestResult() ?? false;
  }

  async calculate(state: AppState, date: string): Promise<ScheduleRunOutcome> {
    if (this.running) throw new Error("排班正在运行，请等待当前任务完成");
    this.running = true;
    this.dependencies.start();
    await this.dependencies.yieldToBrowser();
    try {
      this.activeRun = this.dependencies.run(
        state,
        date,
        this.dependencies.progress,
        () => this.dependencies.safeResultAvailable?.()
      );
      const outcome = await this.activeRun.result;
      this.dependencies.finish(outcome.kind);
      return outcome;
    } catch (error) {
      this.dependencies.finish("failed");
      throw error;
    } finally {
      this.activeRun = null;
      this.running = false;
    }
  }
}

export interface BrowserScheduleRunCallbacks {
  start(): void;
  progress(stage: ScheduleProgressStage, percent: number): void;
  safeResultAvailable(): void;
  finish(outcome: ScheduleRunFinishOutcome): void;
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
