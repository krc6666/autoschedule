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

  it("keeps supervisor-fill position rules", () => {
    const state = createDefaultState();
    state.positionRules[0]!.category = "督导补位";
    const loaded = loadState({ getItem: () => JSON.stringify(state) });
    expect(loaded.positionRules[0]?.category).toBe("督导补位");
  });

  it("keeps legacy copied supervisor-fill assignments linked to the regular supervisor", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const supervisorRule = state.positionRules.find((rule) => rule.flightNo === flight.flightNo && rule.name === "督导")!;
    const fillRule = { ...supervisorRule, id: "supervisor-fill", name: "G16", category: "督导补位" as const, qualifiedStaffIds: [] };
    state.positionRules.push(fillRule);
    const person = state.staff.find((item) => supervisorRule.qualifiedStaffIds.includes(item.id) && item.status === "正常")!;
    state.assignments = [supervisorRule, fillRule].map((rule) => ({
      id: `assignment-${rule.id}`, flightId: flight.id, flightNo: flight.flightNo, positionRuleId: rule.id,
      position: rule.name, staffId: person.id, staffName: person.name, startTime: flight.startTime, endTime: flight.endTime,
      workHours: rule.category === "督导补位" ? 0 : 2, fatiguePoints: rule.fatiguePoints, remark: "", manualRemark: "", status: "assigned" as const
    }));

    const loaded = loadState({ getItem: () => JSON.stringify(state) });
    const fill = loaded.assignments.find((assignment) => assignment.positionRuleId === fillRule.id);
    expect(fill).toMatchObject({ staffId: person.id, staffName: person.name, status: "assigned", workHours: 0, fatiguePoints: 0, supervisorFillDetached: false });
  });

  it("restores an old blank supervisor-fill assignment from its regular supervisor", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const supervisorRule = state.positionRules.find((rule) => rule.flightNo === flight.flightNo && rule.name === "督导")!;
    const fillRule = { ...supervisorRule, id: "supervisor-fill", name: "H06", category: "督导补位" as const, qualifiedStaffIds: [] };
    state.positionRules.push(fillRule);
    const person = state.staff.find((item) => supervisorRule.qualifiedStaffIds.includes(item.id) && item.status === "正常")!;
    state.assignments = [
      {
        id: "regular-supervisor", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: supervisorRule.id,
        position: supervisorRule.name, staffId: person.id, staffName: person.name, startTime: flight.startTime, endTime: flight.endTime,
        workHours: 2, fatiguePoints: supervisorRule.fatiguePoints, remark: "", manualRemark: "", status: "assigned"
      },
      {
        id: "blank-fill", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: fillRule.id,
        position: fillRule.name, staffId: null, staffName: "", startTime: flight.startTime, endTime: flight.endTime,
        workHours: 2, fatiguePoints: fillRule.fatiguePoints, remark: "", manualRemark: "", status: "manual"
      }
    ];

    const loaded = loadState({ getItem: () => JSON.stringify(state) });

    expect(loaded.assignments.find((assignment) => assignment.id === "blank-fill")).toMatchObject({
      staffId: person.id, staffName: person.name, status: "assigned", workHours: 0, fatiguePoints: 0, supervisorFillDetached: false
    });
  });

  it("keeps a manually detached supervisor-fill slot empty after loading", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const supervisorRule = state.positionRules.find((rule) => rule.flightNo === flight.flightNo && rule.name === "督导")!;
    const fillRule = { ...supervisorRule, id: "supervisor-fill", name: "H06", category: "督导补位" as const, qualifiedStaffIds: [] };
    state.positionRules.push(fillRule);
    const person = state.staff.find((item) => supervisorRule.qualifiedStaffIds.includes(item.id) && item.status === "正常")!;
    state.assignments = [
      {
        id: "regular-supervisor", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: supervisorRule.id,
        position: supervisorRule.name, staffId: person.id, staffName: person.name, startTime: flight.startTime, endTime: flight.endTime,
        workHours: 2, fatiguePoints: supervisorRule.fatiguePoints, remark: "", manualRemark: "", status: "assigned"
      },
      {
        id: "detached-fill", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: fillRule.id,
        position: fillRule.name, staffId: null, staffName: "", startTime: flight.startTime, endTime: flight.endTime,
        workHours: 2, fatiguePoints: fillRule.fatiguePoints, remark: "", manualRemark: "", status: "manual", supervisorFillDetached: true
      }
    ];

    const loaded = loadState({ getItem: () => JSON.stringify(state) });

    expect(loaded.assignments.find((assignment) => assignment.id === "detached-fill")).toMatchObject({
      staffId: null, staffName: "", status: "manual", supervisorFillDetached: true
    });
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
