import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationCoordinator } from "../../src/app/application-coordinator";
import type { ApplicationPreferences } from "../../src/app/application-preferences";
import { createAutoscheduleStore } from "../../src/app/store/autoschedule-store";
import { createDefaultState } from "../../src/defaults";
import { replaceWeeklyFlightPlan } from "../../src/domain/flights/weekly-flight-plan";
import { buildMonthlyLatePriorityStatistics } from "../../src/domain/statistics/monthly-late-priority-statistics";
import type { ScheduleResult } from "../../src/model";
import { generateSchedule } from "../helpers/generate-schedule";

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

    expect(coordinator.model().assignments[0]!.staffId).toBe(people[1]!.id);
    expect(coordinator.view().toast).toMatchObject({
      tone: "warning",
      message: expect.stringContaining("资质"),
    });
  });
});

describe("next workday flight picker workflow", () => {
  const nextWorkdayPreferences: ApplicationPreferences = {
    ...preferences,
    loadScheduleDate: () => "2026-08-15",
  };

  function stateWithCurrentSchedule() {
    const state = createDefaultState();
    state.weeklyFlightPlans = replaceWeeklyFlightPlan(
      state.weeklyFlightPlans,
      1,
      [state.templates[1]!.flightNo]
    );
    const flight = state.flights[0]!;
    const rule = state.positionRules.find(
      (item) => item.flightNo === flight.flightNo && item.category === "常规"
    )!;
    const person = state.staff.find((item) =>
      rule.qualifiedStaffIds.includes(item.id)
    )!;
    state.assignments = [
      {
        id: "current-assignment",
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: rule.id,
        position: rule.name,
        staffId: person.id,
        staffName: person.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: 2,
        fatiguePoints: rule.fatiguePoints,
        remark: rule.remark,
        manualRemark: "",
        status: "assigned" as const,
      },
    ];
    return state;
  }

  it("keeps manual late-priority balance through repeated archive-and-next-workday runs", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const state = createDefaultState();
    const qualified = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = qualified;
    state.staff.forEach((person) => {
      person.dutyQualified = false;
      person.nightShift = true;
    });
    state.flights = [
      {
        id: "late-declaration",
        flightNo: "LATE100",
        startTime: "21:00",
        endTime: "23:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    state.templates = [
      {
        id: "template-late-declaration",
        flightNo: "LATE100",
        startTime: "21:00",
        endTime: "23:30",
        positions: ["H04"],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "late-declaration-rule",
        flightNo: "LATE100",
        name: "H04",
        remark: "申报",
        category: "常规",
        qualifiedStaffIds: qualified.map((person) => person.id),
        minPassengers: 0,
        fatiguePoints: 1,
      },
    ];
    state.settings.latePriorityFlightNumbers = ["LATE100"];
    state.settings.minimumRegularTransitionMinutes = 0;
    state.settings.workloadBalanceEnabled = false;
    for (const weekday of [1, 3, 4, 6] as const) {
      state.weeklyFlightPlans = replaceWeeklyFlightPlan(
        state.weeklyFlightPlans,
        weekday,
        ["LATE100"]
      );
    }
    state.dutyRosterOverrides = [
      {
        date: "2026-08-18",
        cxPreflightStaffId: null,
        dutyStaffId: null,
        standbyStaffIds: [null, null],
      },
    ];
    state.latePriorityFrequencyAdjustments = [
      {
        month: "2026-08",
        staffId: qualified[0]!.id,
        flightNo: "LATE100",
        kind: "declaration",
        delta: 1,
      },
    ];
    const initialDate = "2026-08-18";
    const initialResult = await generateSchedule(state, initialDate);
    state.assignments = initialResult.assignments;
    state.activeScheduleDate = initialDate;
    let savedDate = initialDate;
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      {
        preferences: {
          ...preferences,
          loadScheduleDate: () => initialDate,
          saveScheduleDate: (date) => (savedDate = date),
        },
        confirm: () => true,
      }
    );
    Object.defineProperty(coordinator, "scheduleRunner", {
      value: {
        calculate: async (
          model: ReturnType<typeof coordinator.model>,
          date: string
        ) => ({
          kind: "completed" as const,
          result: await generateSchedule(model, date),
        }),
        isRunning: () => false,
      },
    });
    const assignedStaffIds = [state.assignments[0]!.staffId];

    for (let round = 0; round < 4; round += 1) {
      await coordinator.handle({ type: "archive-next-duty-day" });
      const dialog = coordinator.view().dialog;
      if (dialog?.kind !== "next-workday-flight-picker")
        throw new Error("缺少选择窗口");
      expect(dialog.selectedIds).toHaveLength(1);
      await coordinator.handle({
        type: "confirm-next-workday-flight-picker",
        selectedIds: dialog.selectedIds,
      });
      expect(coordinator.view().toast?.tone).not.toBe("danger");
      assignedStaffIds.push(coordinator.model().assignments[0]!.staffId);
    }

    expect(savedDate).toBe("2026-08-26");
    expect([
      ...new Set(coordinator.model().history.map((item) => item.date)),
    ]).toEqual(["2026-08-18", "2026-08-20", "2026-08-22", "2026-08-24"]);
    expect(coordinator.model().latePriorityFrequencyAdjustments).toEqual(
      state.latePriorityFrequencyAdjustments
    );
    expect(new Set(assignedStaffIds)).toEqual(
      new Set(qualified.map((person) => person.id))
    );
    const statistics = buildMonthlyLatePriorityStatistics(
      coordinator.model(),
      savedDate
    );
    expect(
      qualified.map(
        (person) =>
          statistics.rows.find((row) => row.staff.id === person.id)!.categories
            .申报.effectiveCount
      )
    ).toEqual([3, 3]);
  });

  it("opens local flight selection before changing history or starting calculation", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const state = stateWithCurrentSchedule();
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      { preferences: nextWorkdayPreferences, confirm: () => true }
    );
    const calculate = vi.fn();
    Object.defineProperty(coordinator, "scheduleRunner", {
      value: { calculate, isRunning: () => false },
    });

    await coordinator.handle({ type: "archive-next-duty-day" });

    expect(coordinator.view().dialog?.kind).toBe("next-workday-flight-picker");
    const dialog = coordinator.view().dialog;
    if (dialog?.kind !== "next-workday-flight-picker")
      throw new Error("缺少选择窗口");
    expect(dialog.weekday).toBe(1);
    expect(
      dialog.candidates
        .filter((candidate) => dialog.selectedIds.includes(candidate.id))
        .map((candidate) => candidate.flightNo)
    ).toEqual([state.templates[1]!.flightNo]);
    const weeklyBeforeTemporaryChange = structuredClone(
      coordinator.model().weeklyFlightPlans
    );
    await coordinator.handle({
      type: "update-next-workday-flight-picker-selection",
      selectedIds: dialog.candidates.map((candidate) => candidate.id),
    });
    await coordinator.handle({
      type: "update-next-workday-flight-picker-passengers",
      candidateId: dialog.candidates[0]!.id,
      bookedPassengers: 128,
    });
    expect(coordinator.model().weeklyFlightPlans).toEqual(
      weeklyBeforeTemporaryChange
    );
    const updatedDialog = coordinator.view().dialog;
    expect(
      updatedDialog?.kind === "next-workday-flight-picker"
        ? updatedDialog.candidates[0]!.bookedPassengers
        : null
    ).toBe(128);
    expect(coordinator.model().history).toHaveLength(0);
    expect(coordinator.model().activeScheduleDate).toBeNull();
    expect(calculate).not.toHaveBeenCalled();
  });

  it("keeps the original model when the selected next schedule fails", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const state = stateWithCurrentSchedule();
    const original = structuredClone(state);
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      { preferences: nextWorkdayPreferences, confirm: () => true }
    );
    Object.defineProperty(coordinator, "scheduleRunner", {
      value: {
        calculate: vi.fn().mockRejectedValue(new Error("测试失败")),
        isRunning: () => false,
      },
    });

    await coordinator.handle({ type: "archive-next-duty-day" });
    const dialog = coordinator.view().dialog;
    if (dialog?.kind !== "next-workday-flight-picker")
      throw new Error("缺少选择窗口");
    await coordinator.handle({
      type: "confirm-next-workday-flight-picker",
      selectedIds: dialog.selectedIds,
    });

    expect(coordinator.model()).toEqual(original);
    expect(coordinator.view().toast?.message).toContain("后天排班生成失败");
  });

  it("keeps the original model when the run is stopped, even with a latest result", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const state = stateWithCurrentSchedule();
    const original = structuredClone(state);
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      { preferences: nextWorkdayPreferences, confirm: () => true }
    );
    Object.defineProperty(coordinator, "scheduleRunner", {
      value: {
        calculate: vi.fn().mockResolvedValue({
          kind: "stopped-with-result",
          result: { assignments: [], warnings: [], unfilledCount: 0 },
        }),
        isRunning: () => false,
      },
    });

    await coordinator.handle({ type: "archive-next-duty-day" });
    const dialog = coordinator.view().dialog;
    if (dialog?.kind !== "next-workday-flight-picker")
      throw new Error("缺少选择窗口");
    await coordinator.handle({
      type: "confirm-next-workday-flight-picker",
      selectedIds: dialog.selectedIds,
    });

    expect(coordinator.model()).toEqual(original);
    expect(coordinator.view().toast?.message).toContain("原班表保持不变");
  });

  it("commits archive, selected flights, date, and result only after success", async () => {
    vi.stubGlobal("localStorage", { setItem: vi.fn() });
    const state = stateWithCurrentSchedule();
    state.templates.push({
      id: "template-ke166",
      flightNo: "KE166",
      startTime: "12:00",
      endTime: "14:00",
      positions: ["G18"],
      remark: "本地模板",
    });
    let savedDate: string | null = null;
    const coordinator = new ApplicationCoordinator(
      createAutoscheduleStore(state),
      {
        preferences: {
          ...nextWorkdayPreferences,
          saveScheduleDate: (date) => (savedDate = date),
        },
        confirm: () => true,
      }
    );
    const calculate = vi.fn().mockResolvedValue({
      kind: "completed",
      result: { assignments: [], warnings: [], unfilledCount: 0 },
    });
    Object.defineProperty(coordinator, "scheduleRunner", {
      value: { calculate, isRunning: () => false },
    });

    await coordinator.handle({ type: "archive-next-duty-day" });
    const dialog = coordinator.view().dialog;
    if (dialog?.kind !== "next-workday-flight-picker")
      throw new Error("缺少选择窗口");
    const selectedId = dialog.candidates.find(
      (item) => item.flightNo === "KE166"
    )?.id;
    if (!selectedId) throw new Error("缺少本地模板航班");
    await coordinator.handle({
      type: "update-next-workday-flight-picker-passengers",
      candidateId: selectedId,
      bookedPassengers: 186,
    });
    await coordinator.handle({
      type: "confirm-next-workday-flight-picker",
      selectedIds: [selectedId],
    });

    expect(calculate).toHaveBeenCalledWith(
      expect.objectContaining({
        flights: [
          expect.objectContaining({
            flightNo: "KE166",
            bookedPassengers: 186,
          }),
        ],
        assignments: [],
      }),
      "2026-08-17"
    );
    expect(coordinator.model().flights.map((item) => item.flightNo)).toEqual([
      "KE166",
    ]);
    expect(coordinator.model().history.length).toBeGreaterThan(0);
    expect(
      coordinator.model().history.every((item) => item.date === "2026-08-15")
    ).toBe(true);
    expect(coordinator.model().activeScheduleDate).toBe("2026-08-17");
    expect(savedDate).toBe("2026-08-17");
  });
});
