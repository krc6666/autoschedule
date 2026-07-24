import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { loadState, saveState, STORAGE_KEY } from "./storage";

describe("state persistence", () => {
  it("falls back to valid defaults for corrupt persisted data", () => {
    const state = loadState({ getItem: () => "not-json" });
    expect(state.version).toBe(2);
    expect(state.staff.length).toBeGreaterThan(0);
    expect(state.positionRules.some((rule) => rule.category === "机动督导")).toBe(false);
  });

  it("converts every previously selected mobile supervisor category to regular once", () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultState()));
    legacy.version = 1;
    legacy.positionRules[0].category = "机动督导";
    legacy.positionRules[1].category = "机动督导";

    const loaded = loadState({ getItem: () => JSON.stringify(legacy) });

    expect(loaded.version).toBe(2);
    expect(loaded.positionRules.some((rule) => rule.category === "机动督导")).toBe(false);
  });

  it("preserves a mobile supervisor category selected after the one-time migration", () => {
    const current = createDefaultState();
    current.positionRules[0]!.category = "机动督导";

    const loaded = loadState({ getItem: () => JSON.stringify(current) });

    expect(loaded.positionRules[0]!.category).toBe("机动督导");
  });

  it("round-trips the domain state", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    const state = createDefaultState();
    state.staff[0]!.remark = "changed";
    state.staff[0]!.teamLeader = true;
    state.staff[0]!.cxPreflightQualified = true;
    state.staff[0]!.dutyQualified = false;
    state.dutyRosterOverrides = [{ date: "2026-07-20", cxPreflightStaffId: "1", dutyStaffId: "2", standbyStaffIds: ["3", "4"] }];
    saveState(state, storage);
    expect(values.has(STORAGE_KEY)).toBe(true);
    expect(loadState(storage).staff[0]!.remark).toBe("changed");
    expect(loadState(storage).staff[0]!.teamLeader).toBe(true);
    expect(loadState(storage).staff[0]!.cxPreflightQualified).toBe(true);
    expect(loadState(storage).staff[0]!.dutyQualified).toBe(false);
    expect(loadState(storage).dutyRosterOverrides[0]).toEqual(state.dutyRosterOverrides[0]);
  });

  it("migrates personnel type, administrative mode, and scheduling policy defaults", () => {
    const state = createDefaultState();
    const legacy = JSON.parse(JSON.stringify(state));
    delete legacy.staff[0].staffType;
    delete legacy.staff[0].teamLeader;
    delete legacy.staff[0].cxPreflightQualified;
    delete legacy.staff[0].dutyQualified;
    delete legacy.dutyRosterOverrides;
    delete legacy.settings.adminSupportEnabled;
    delete legacy.settings.highLoadProtectionEnabled;
    delete legacy.settings.highLoadFatigueThreshold;
    delete legacy.settings.highLoadRecoveryMinutes;
    delete legacy.settings.remarkedPositionHighLoad;
    delete legacy.settings.highLoadTransitionMode;
    delete legacy.settings.positionTransitionPolicies;
    delete legacy.settings.rollingLoadProtectionEnabled;
    delete legacy.settings.rollingLoadWindowMinutes;
    delete legacy.settings.rollingLoadMaxFatigue;
    delete legacy.settings.rollingLoadMode;
    delete legacy.settings.positionRotationEnabled;
    delete legacy.settings.positionRotationLookbackDays;
    delete legacy.settings.positionRotationMode;
    delete legacy.settings.dutyFatiguePoints;
    delete legacy.settings.dutyPositionPriorities;
    delete legacy.settings.mobileSupervisorCoverageRules;
    delete legacy.settings.earlyDepartureCutoffTime;
    delete legacy.settings.afternoonRestStartTime;
    delete legacy.settings.afternoonRestEndTime;
    delete legacy.settings.workloadBalanceEnabled;
    delete legacy.settings.maxWorkHoursDifference;
    delete legacy.settings.maxTodayFatigueDifference;
    delete legacy.settings.lateShiftRecoveryEnabled;
    delete legacy.settings.lateShiftStartTime;
    delete legacy.settings.lateShiftLatestWindowMinutes;
    delete legacy.settings.nextDayLateMaxFatigue;
    delete legacy.settings.lateShiftRecoveryMode;
    const loaded = loadState({ getItem: () => JSON.stringify(legacy) });
    expect(loaded.staff[0]?.staffType).toBe("常规");
    expect(loaded.staff[0]?.teamLeader).toBe(false);
    expect(loaded.staff[0]?.cxPreflightQualified).toBe(false);
    expect(loaded.staff[0]?.dutyQualified).toBe(true);
    expect(loaded.dutyRosterOverrides).toEqual([]);
    expect(loaded.settings.adminSupportEnabled).toBe(false);
    expect(loaded.settings.highLoadProtectionEnabled).toBe(true);
    expect(loaded.settings.highLoadFatigueThreshold).toBe(4);
    expect(loaded.settings.highLoadRecoveryMinutes).toBe(360);
    expect(loaded.settings.remarkedPositionHighLoad).toBe(true);
    expect(loaded.settings.highLoadTransitionMode).toBe("prefer");
    expect(loaded.settings.positionTransitionPolicies).toMatchObject([{ targetFlightNo: "TR121", targetPosition: "H02" }]);
    expect(loaded.settings.rollingLoadProtectionEnabled).toBe(true);
    expect(loaded.settings.rollingLoadWindowMinutes).toBe(360);
    expect(loaded.settings.rollingLoadMaxFatigue).toBe(8);
    expect(loaded.settings.rollingLoadMode).toBe("prefer");
    expect(loaded.settings.positionRotationEnabled).toBe(true);
    expect(loaded.settings.positionRotationLookbackDays).toBe(3);
    expect(loaded.settings.positionRotationMode).toBe("prefer");
    expect(loaded.settings.dutyFatiguePoints).toBe(12);
    expect(loaded.settings.dutyPositionPriorities).toMatchObject([
      { flightNo: "TR121", positionKeyword: "一号", enabled: true },
      { flightNo: "TW616", positionKeyword: "一号", enabled: true }
    ]);
    expect(loaded.settings.mobileSupervisorCoverageRules).toMatchObject([
      { flightNo: "", matchField: "remark", keyword: "一号", mode: "forbid", enabled: true },
      { flightNo: "", matchField: "remark", keyword: "申报", mode: "forbid", enabled: true },
      { flightNo: "", matchField: "remark", keyword: "排查", mode: "forbid", enabled: true }
    ]);
    expect(loaded.settings.earlyDepartureCutoffTime).toBe("12:00");
    expect(loaded.settings.afternoonRestStartTime).toBe("12:00");
    expect(loaded.settings.afternoonRestEndTime).toBe("18:00");
    expect(loaded.settings.workloadBalanceEnabled).toBe(true);
    expect(loaded.settings.maxWorkHoursDifference).toBe(2);
    expect(loaded.settings.maxTodayFatigueDifference).toBe(4);
    expect(loaded.settings.lateShiftRecoveryEnabled).toBe(true);
    expect(loaded.settings.lateShiftStartTime).toBe("20:00");
    expect(loaded.settings.lateShiftLatestWindowMinutes).toBe(180);
    expect(loaded.settings.nextDayLateMaxFatigue).toBe(2);
    expect(loaded.settings.lateShiftRecoveryMode).toBe("prefer");
  });

  it("removes rules that use the retired support category", () => {
    const state = createDefaultState();
    const legacy = JSON.parse(JSON.stringify(state));
    legacy.positionRules[0].category = "支援";
    const removedRuleId = legacy.positionRules[0].id;
    const loaded = loadState({ getItem: () => JSON.stringify(legacy) });
    expect(loaded.positionRules.some((rule) => rule.id === removedRuleId)).toBe(false);
  });

  it("migrates retired supervisor-fill rules to regular positions", () => {
    const state = createDefaultState();
    const legacy = JSON.parse(JSON.stringify(state));
    legacy.positionRules[0].category = "督导补位";

    const loaded = loadState({ getItem: () => JSON.stringify(legacy) });

    expect(loaded.positionRules[0]).toMatchObject({ category: "常规", manual: false });
  });

  it("keeps an existing regular supervisor in the regular category", () => {
    const state = createDefaultState();
    const legacy = JSON.parse(JSON.stringify(state));
    legacy.positionRules.find((rule: { name: string }) => rule.name === "督导")!.category = "常规";

    const loaded = loadState({ getItem: () => JSON.stringify(legacy) });

    expect(loaded.positionRules.find((rule) => rule.name === "督导")?.category).toBe("常规");
  });

  it("normalizes the retired supervisor category to regular", () => {
    const state = createDefaultState();
    const legacy = JSON.parse(JSON.stringify(state));
    legacy.positionRules.find((rule: { name: string }) => rule.name === "督导")!.category = "督导";

    const loaded = loadState({ getItem: () => JSON.stringify(legacy) });

    expect(loaded.positionRules.find((rule) => rule.name === "督导")?.category).toBe("常规");
  });

  it("keeps a supervisor-linked target synchronized without duplicate work hours", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const supervisorRule = state.positionRules.find((rule) => rule.flightNo === flight.flightNo && rule.name === "督导")!;
    supervisorRule.category = "机动督导";
    const targetRule = state.positionRules.find((rule) => rule.flightNo === flight.flightNo && rule.category === "常规")!;
    const person = state.staff.find((item) => supervisorRule.qualifiedStaffIds.includes(item.id))!;
    state.assignments = [
      { id: "supervisor", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: supervisorRule.id, position: supervisorRule.name, staffId: person.id, staffName: person.name, startTime: flight.startTime, endTime: flight.endTime, workHours: 2, fatiguePoints: supervisorRule.fatiguePoints, remark: "", manualRemark: "", status: "assigned" },
      { id: "cover", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: targetRule.id, position: targetRule.name, staffId: person.id, staffName: person.name, startTime: flight.startTime, endTime: flight.endTime, workHours: 2, fatiguePoints: 0, remark: "", manualRemark: "", status: "assigned", supervisorSourceAssignmentId: "supervisor" }
    ];

    const loaded = loadState({ getItem: () => JSON.stringify(state) });
    expect(loaded.assignments.find((assignment) => assignment.id === "cover")).toMatchObject({ workHours: 0, fatiguePoints: targetRule.fatiguePoints, supervisorSourceAssignmentId: "supervisor" });
  });

  it("keeps generated scheduling notes used by feedback", () => {
    const state = createDefaultState();
    const rule = state.positionRules[0]!;
    const flight = state.flights.find((item) => item.flightNo === rule.flightNo)!;
    state.assignments = [{
      id: "noted-assignment", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: rule.id,
      position: rule.name, staffId: null, staffName: "", startTime: flight.startTime, endTime: flight.endTime,
      workHours: 2, fatiguePoints: 1, remark: "", manualRemark: "", status: "unfilled",
      systemNotes: ["因合格人数不足而无法填满（缺少 1 人：时段冲突 1 人）"]
    }];
    const loaded = loadState({ getItem: () => JSON.stringify(state) });
    expect(loaded.assignments[0]?.systemNotes).toEqual(state.assignments[0]?.systemNotes);
  });

  it("does not restore an unavailable worker from a stale persisted assignment", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    const rule = state.positionRules[0]!;
    const flight = state.flights.find((item) => item.flightNo === rule.flightNo)!;
    person.status = "休假";
    state.assignments = [{
      id: "stale-assignment", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: rule.id,
      position: rule.name, staffId: person.id, staffName: person.name, startTime: flight.startTime, endTime: flight.endTime,
      workHours: 2, fatiguePoints: 1, remark: "", manualRemark: "", status: "assigned"
    }];

    const loaded = loadState({ getItem: () => JSON.stringify(state) });

    expect(loaded.assignments[0]).toMatchObject({ staffId: null, staffName: "", status: "unfilled" });
  });

  it("removes obsolete generated cells that have no position rule", () => {
    const state = createDefaultState();
    const afternoon = state.flights.find((flight) => flight.flightNo === "FD573")!;
    state.assignments = [{
      id: "obsolete-support", flightId: afternoon.id, flightNo: afternoon.flightNo, positionRuleId: null,
      position: "临时支援", staffId: null, staffName: "", startTime: afternoon.startTime, endTime: afternoon.endTime,
      workHours: 2, fatiguePoints: 1, remark: "", manualRemark: "", status: "manual"
    }];
    const loaded = loadState({ getItem: () => JSON.stringify(state) });
    expect(loaded.assignments).toHaveLength(0);
  });

  it("does not restore administrative positions while support mode is disabled", () => {
    const state = createDefaultState();
    const rule = state.positionRules[0]!;
    rule.category = "行政支援";
    state.assignments = [{
      id: "admin-position", flightId: state.flights[0]!.id, flightNo: rule.flightNo, positionRuleId: rule.id,
      position: rule.name, staffId: null, staffName: "", startTime: state.flights[0]!.startTime, endTime: state.flights[0]!.endTime,
      workHours: 2, fatiguePoints: 1, remark: "", manualRemark: "", status: "manual"
    }];
    expect(loadState({ getItem: () => JSON.stringify(state) }).assignments).toHaveLength(0);
  });

  it("removes a persisted regular assignment replaced by an administrative position", () => {
    const state = createDefaultState();
    const regularRule = state.positionRules[0]!;
    const administrativeRule = { ...regularRule, id: "admin-duplicate", category: "行政支援" as const };
    state.settings.adminSupportEnabled = true;
    state.positionRules.push(administrativeRule);
    state.assignments = [regularRule, administrativeRule].map((rule) => ({
      id: `assignment-${rule.id}`, flightId: state.flights[0]!.id, flightNo: rule.flightNo, positionRuleId: rule.id,
      position: rule.name, staffId: null, staffName: "", startTime: state.flights[0]!.startTime, endTime: state.flights[0]!.endTime,
      workHours: 2, fatiguePoints: 1, remark: "", manualRemark: "", status: "manual" as const
    }));
    const loaded = loadState({ getItem: () => JSON.stringify(state) });
    expect(loaded.assignments.map((assignment) => assignment.positionRuleId)).toEqual([administrativeRule.id]);
  });

  it("removes obsolete guide rows that were copied into flights without a position rule", () => {
    const state = createDefaultState();
    const flight = state.flights.find((item) => item.flightNo === "TR121")!;
    state.assignments = [{
      id: "copied-guide", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: null,
      position: "柜台引导1", staffId: null, staffName: "", startTime: flight.startTime, endTime: flight.endTime,
      workHours: 0, fatiguePoints: 1, remark: "", manualRemark: "", status: "manual"
    }];
    const loaded = loadState({ getItem: () => JSON.stringify(state) });
    expect(loaded.assignments).toHaveLength(0);
  });
});
