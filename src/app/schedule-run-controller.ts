import type { ScheduleProgressStage } from "../domain/schedule-progress";
import {
  runScheduleInBackground,
  type ScheduleProgressListener,
} from "../infrastructure/schedule-runner";
import type { AppState, ScheduleResult } from "../model";
import {
  hideScheduleProgress,
  setScheduleControlsDisabled,
  updateScheduleProgress,
} from "../ui/schedule-progress";

export interface ScheduleRunControllerDependencies {
  run: (
    state: AppState,
    date: string,
    onProgress: ScheduleProgressListener
  ) => Promise<ScheduleResult>;
  yieldToBrowser: () => Promise<void>;
  start: () => void;
  progress: (stage: ScheduleProgressStage, percent: number) => void;
  finish: () => void;
  hide: () => void;
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
      return await this.dependencies.run(
        state,
        date,
        this.dependencies.progress
      );
    } finally {
      this.running = false;
      this.dependencies.finish();
    }
  }

  hideProgress(): void {
    this.dependencies.hide();
  }
}

export function createBrowserScheduleRunController(
  root: HTMLElement
): ScheduleRunController {
  return new ScheduleRunController({
    run: runScheduleInBackground,
    yieldToBrowser: () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    start: () => {
      setScheduleControlsDisabled(root, true);
      updateScheduleProgress(root, "prepare", 0);
    },
    progress: (stage, percent) => updateScheduleProgress(root, stage, percent),
    finish: () => setScheduleControlsDisabled(root, false),
    hide: () => hideScheduleProgress(root),
  });
}
