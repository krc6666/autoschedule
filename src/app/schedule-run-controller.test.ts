import { describe, expect, it, vi } from "vitest";

import { createDefaultState } from "../defaults";
import type { ScheduleResult } from "../model";
import { ScheduleRunController } from "./schedule-run-controller";

const result: ScheduleResult = {
  assignments: [],
  warnings: [],
  unfilledCount: 0,
};

describe("ScheduleRunController", () => {
  it("always restores controls after a successful run", async () => {
    const events: string[] = [];
    const controller = new ScheduleRunController({
      run: async (_state, _date, progress) => {
        progress("assign", 30);
        return result;
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
      hide: vi.fn(),
    });

    await expect(
      controller.calculate(createDefaultState(), "2026-07-30")
    ).resolves.toBe(result);
    expect(events).toEqual(["start", "yield", "assign", "finish"]);
  });

  it("rejects concurrent runs and recovers after a failed run", async () => {
    let rejectRun!: (error: Error) => void;
    const finish = vi.fn();
    const controller = new ScheduleRunController({
      run: () =>
        new Promise((_resolve, reject) => {
          rejectRun = reject;
        }),
      yieldToBrowser: async () => undefined,
      start: vi.fn(),
      progress: vi.fn(),
      finish,
      hide: vi.fn(),
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
});
