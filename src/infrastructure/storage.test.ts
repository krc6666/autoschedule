import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { loadState, saveState, STORAGE_KEY } from "./storage";

describe("state persistence", () => {
  it("falls back to valid defaults for corrupt persisted data", () => {
    const state = loadState({ getItem: () => "not-json" });
    expect(state.version).toBe(1);
    expect(state.staff.length).toBeGreaterThan(0);
  });

  it("round-trips the domain state", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    const state = createDefaultState();
    state.staff[0]!.remark = "changed";
    state.staff[0]!.cxPreflightQualified = true;
    state.staff[0]!.dutyQualified = false;
    state.dutyRosterOverrides = [{ date: "2026-07-20", cxPreflightStaffId: "1", dutyStaffId: "2", standbyStaffIds: ["3", "4"] }];
    saveState(state, storage);
    expect(values.has(STORAGE_KEY)).toBe(true);
    expect(loadState(storage).staff[0]!.remark).toBe("changed");
    expect(loadState(storage).staff[0]!.cxPreflightQualified).toBe(true);
    expect(loadState(storage).staff[0]!.dutyQualified).toBe(false);
    expect(loadState(storage).dutyRosterOverrides[0]).toEqual(state.dutyRosterOverrides[0]);
  });

  it("migrates personnel type, administrative mode, and scheduling policy defaults", () => {
    const state = createDefaultState();
    const legacy = JSON.parse(JSON.stringify(state));
    delete legacy.staff[0].staffType;
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
    delete legacy.settings.lateShiftRecoveryEnabled;
    delete legacy.settings.lateShiftStartTime;
    delete legacy.settings.lateShiftLatestWindowMinutes;
    delete legacy.settings.nextDayLateMaxFatigue;
    delete legacy.settings.lateShiftRecoveryMode;
    const loaded = loadState({ getItem: () => JSON.stringify(legacy) });
    expect(loaded.staff[0]?.staffType).toBe("常规");
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
