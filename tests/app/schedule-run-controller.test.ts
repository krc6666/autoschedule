import { describe, expect, it, vi } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { ScheduleResult } from "../../src/model";
import { ScheduleRunController } from "../../src/app/schedule-run-controller";
import type { ActiveScheduleRun } from "../../src/infrastructure/schedule-runner";

const result: ScheduleResult = {
  assignments: [],
  warnings: [],
  unfilledCount: 0,
};

function completedRun(value = result): ActiveScheduleRun {
  return {
    result: Promise.resolve({ kind: "completed", result: value }),
    stopWithoutResult: () => false,
    stopWithLatestResult: () => false,
    hasLatestSafeResult: () => false,
  };
}

describe("ScheduleRunController", () => {
  it("always restores controls after a successful run", async () => {
    const events: string[] = [];
    const controller = new ScheduleRunController({
      run: (_state, _date, progress) => {
        progress("assign", 30);
        return completedRun();
      },
      yieldToBrowser: async () => {
        events.push("yield");
      },
      start: () => {
        events.push("start");
      },
      progress: (stage) => {
        events.push(stage);
      },
      finish: () => {
        events.push("finish");
      },
    });

    await expect(
      controller.calculate(createDefaultState(), "2026-07-30")
    ).resolves.toEqual({ kind: "completed", result });
    expect(events).toEqual(["start", "yield", "assign", "finish"]);
  });

  it("rejects concurrent runs and recovers after a failed run", async () => {
    let rejectRun!: (error: Error) => void;
    const finish = vi.fn();
    const controller = new ScheduleRunController({
      run: () => ({
        result: new Promise((_resolve, reject) => {
          rejectRun = reject;
        }),
        stopWithoutResult: () => false,
        stopWithLatestResult: () => false,
        hasLatestSafeResult: () => false,
      }),
      yieldToBrowser: async () => undefined,
      start: vi.fn(),
      progress: vi.fn(),
      finish,
    });
    const first = controller.calculate(createDefaultState(), "2026-07-30");
    await Promise.resolve();

    await expect(
      controller.calculate(createDefaultState(), "2026-08-01")
    ).rejects.toThrow("排班正在运行");
    rejectRun(new Error("后台失败"));
    await expect(first).rejects.toThrow("后台失败");
    expect(finish).toHaveBeenCalledOnce();
  });

  it("exposes both stop choices and only adopts a safe snapshot", async () => {
    let resolveRun!: ActiveScheduleRun["result"] extends Promise<infer T>
      ? (value: T) => void
      : never;
    let latestSafe = false;
    const safeResult = {
      assignments: [],
      warnings: ["安全快照"],
      unfilledCount: 0,
    };
    const finish = vi.fn();
    const controller = new ScheduleRunController({
      run: () => ({
        result: new Promise((resolve) => {
          resolveRun = resolve;
        }),
        stopWithoutResult: () => {
          resolveRun({ kind: "stopped-without-result" });
          return true;
        },
        stopWithLatestResult: () => {
          if (!latestSafe) return false;
          resolveRun({ kind: "stopped-with-result", result: safeResult });
          return true;
        },
        hasLatestSafeResult: () => latestSafe,
      }),
      yieldToBrowser: async () => undefined,
      start: vi.fn(),
      progress: vi.fn(),
      safeResultAvailable: vi.fn(),
      finish,
    });
    const calculation = controller.calculate(
      createDefaultState(),
      "2026-08-01"
    );
    await Promise.resolve();

    expect(controller.canAdoptCurrentResult()).toBe(false);
    expect(controller.stopWithCurrentResult()).toBe(false);
    latestSafe = true;
    expect(controller.canAdoptCurrentResult()).toBe(true);
    expect(controller.stopWithCurrentResult()).toBe(true);
    await expect(calculation).resolves.toEqual({
      kind: "stopped-with-result",
      result: safeResult,
    });
    expect(finish).toHaveBeenCalledWith("stopped-with-result");
  });
});
