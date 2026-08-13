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
  it("keeps the pre-run schedule when calculation is stopped without a result", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const state = createDefaultState();
    state.assignments = [
      {
        id: "existing",
        flightId: state.flights[0]!.id,
        flightNo: state.flights[0]!.flightNo,
        positionRuleId: null,
        position: "原岗位",
        staffId: state.staff[0]!.id,
        staffName: state.staff[0]!.name,
        startTime: state.flights[0]!.startTime,
        endTime: state.flights[0]!.endTime,
        workHours: 2,
        fatiguePoints: 2,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
    ];
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      { preferences }
    );
    Object.defineProperty(coordinator, "scheduleRunner", {
      value: {
        calculate: vi
          .fn()
          .mockResolvedValue({ kind: "stopped-without-result" }),
        isRunning: () => false,
      },
    });

    await coordinator.handle({ type: "generate-schedule" });

    expect(coordinator.model().assignments).toHaveLength(1);
    expect(coordinator.model().assignments[0]!.id).toBe("existing");
    expect(coordinator.view().toast?.message).toContain("原班表保持不变");
  });

  it("installs only the complete safe result selected by stop-and-adopt", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const state = createDefaultState();
    const safeResult: ScheduleResult = {
      assignments: [],
      warnings: ["已安全复核"],
      unfilledCount: 0,
    };
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      { preferences }
    );
    Object.defineProperty(coordinator, "scheduleRunner", {
      value: {
        calculate: vi.fn().mockResolvedValue({
          kind: "stopped-with-result",
          result: safeResult,
        }),
        isRunning: () => false,
      },
    });

    await coordinator.handle({ type: "generate-schedule" });

    expect(coordinator.model().activeScheduleDate).toBe(
      coordinator.view().date
    );
    expect(coordinator.view().toast?.message).toContain("完整安全方案");
  });

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

describe("manual swap analysis workflow", () => {
  it("rechecks a proposed swap before applying it", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const state = createDefaultState();
    const flight = state.flights.find((item) => item.flightNo === "TR121")!;
    const h02 = state.positionRules.find(
      (item) => item.flightNo === "TR121" && item.name === "H02"
    )!;
    const h08 = state.positionRules.find(
      (item) => item.flightNo === "TR121" && item.name === "H08"
    )!;
    const people = state.staff.slice(0, 2);
    h02.qualifiedStaffIds = people.map((person) => person.id);
    h08.qualifiedStaffIds = people.map((person) => person.id);
    state.settings.rollingLoadProtectionEnabled = false;
    state.assignments = [h02, h08].map((rule, index) => ({
      id: `swap-${index}`,
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: people[index]!.id,
      staffName: people[index]!.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      workHours: 2,
      fatiguePoints: rule.fatiguePoints,
      remark: rule.remark,
      manualRemark: "",
      status: "assigned" as const,
    }));
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      { preferences }
    );

    await coordinator.handle({
      type: "open-swap-analysis",
      assignmentId: "swap-0",
    });
    await coordinator.handle({
      type: "select-swap-target",
      assignmentId: "swap-1",
    });
    expect(coordinator.view().dialog).toMatchObject({
      kind: "swap-analysis",
      analysis: { outcome: "safe" },
    });

    h02.qualifiedStaffIds = [people[0]!.id];
    coordinator
      .model()
      .positionRules.find((item) => item.id === h02.id)!.qualifiedStaffIds = [
      people[0]!.id,
    ];
    await coordinator.handle({ type: "apply-swap-analysis" });

    expect(coordinator.model().assignments[0]!.staffId).toBe(people[0]!.id);
    expect(coordinator.view().toast).toMatchObject({
      tone: "danger",
      message: expect.stringContaining("资质"),
    });
  });
});
