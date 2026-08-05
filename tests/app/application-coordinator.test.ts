import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationCoordinator } from "../../src/app/application-coordinator";
import type { ApplicationPreferences } from "../../src/app/application-preferences";
import { createAutoscheduleStore } from "../../src/app/store/autoschedule-store";
import { createDefaultState } from "../../src/defaults";
import type { ScheduleResult } from "../../src/model";

const preferences: ApplicationPreferences = {
  loadScheduleDate: () => null,
  saveScheduleDate: () => undefined,
  loadScheduleZoom: () => null,
  saveScheduleZoom: () => undefined,
};

afterEach(() => vi.unstubAllGlobals());

describe("application persistence feedback", () => {
  it("shows an important warning when saved data approaches browser capacity", () => {
    const state = createDefaultState();
    state.staff[0]!.remark = "a".repeat(4 * 1024 * 1024);
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      { preferences }
    );

    coordinator.commit("人员信息已保存");

    expect(coordinator.view().toast).toMatchObject({
      tone: "warning",
      message: expect.stringContaining("接近浏览器存储上限"),
    });
  });

  it("keeps in-memory data and reports a failed quota write", () => {
    const state = createDefaultState();
    state.history = [
      {
        id: "unsaved-history",
        date: "2026-07-20",
        flightNo: "TR121",
        position: "H02",
        staffId: state.staff[0]!.id,
        staffName: state.staff[0]!.name,
        startTime: "20:00",
        endTime: "22:00",
        workHours: 2,
        fatiguePoints: 4,
        remark: "一号",
      },
    ];
    const quotaError = new Error("quota exceeded");
    quotaError.name = "QuotaExceededError";
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw quotaError;
      },
    });
    const store = createAutoscheduleStore(state);
    const coordinator = new ApplicationCoordinator(store, { preferences });

    expect(() => coordinator.commit("历史排班已保存")).not.toThrow();
    expect(store.getState().model.history).toHaveLength(1);
    expect(coordinator.view().toast).toMatchObject({
      tone: "danger",
      message: expect.stringContaining("存储空间不足"),
    });
  });
});

describe("application scheduling exclusivity", () => {
  it("reserves a schedule run before asynchronous command routing", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const state = createDefaultState();
    state.settings.adminSupportEnabled = false;
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      { preferences }
    );
    const result: ScheduleResult = {
      assignments: [],
      warnings: [],
      unfilledCount: 0,
    };
    let running = false;
    let finishFirst!: () => void;
    const calculate = vi.fn(() => {
      if (running)
        return Promise.reject(new Error("排班正在运行，请等待当前任务完成"));
      running = true;
      return new Promise<ScheduleResult>((resolve) => {
        finishFirst = () => {
          running = false;
          resolve(result);
        };
      });
    });
    Object.defineProperty(coordinator, "scheduleRunner", {
      value: { calculate, isRunning: () => running },
    });

    const generate = coordinator.handle({ type: "generate-schedule" });
    const toggle = coordinator.handle({
      type: "toggle-administrative-mode",
      enabled: true,
    });

    await toggle;
    await vi.waitFor(() => expect(calculate).toHaveBeenCalled());
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(coordinator.model().settings.adminSupportEnabled).toBe(false);
    expect(coordinator.view().toast).toMatchObject({
      tone: "warning",
      message: "排班正在计算，请等待当前任务完成",
    });
    finishFirst();
    await generate;
  });

  it("blocks data-changing commands while a schedule calculation is running", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const state = createDefaultState();
    state.settings.adminSupportEnabled = false;
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      { preferences }
    );
    const calculate = vi
      .fn()
      .mockRejectedValue(new Error("排班正在运行，请等待当前任务完成"));
    Object.defineProperty(coordinator, "scheduleRunner", {
      value: { calculate, isRunning: () => true },
    });

    await coordinator.handle({
      type: "toggle-administrative-mode",
      enabled: true,
    });

    expect(coordinator.model().settings.adminSupportEnabled).toBe(false);
    expect(calculate).not.toHaveBeenCalled();
    expect(coordinator.view().toast).toMatchObject({
      tone: "warning",
      message: "排班正在计算，请等待当前任务完成",
    });
  });
});
