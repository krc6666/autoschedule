import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { generateSchedule } from "./scheduler";
import { clearMonthlyDutyRosterOverrides, getDutyRosterForDate, getMonthlyDutyRoster, getMonthlyDutyRosterStats, updateDutyRosterSlot } from "./duty-roster";

describe("monthly duty roster", () => {
  it("keeps duty exclusive while allowing CX preflight to overlap standby", () => {
    const state = createDefaultState();
    state.staff.slice(0, 3).forEach((person) => { person.cxPreflightQualified = true; });
    state.staff[3]!.status = "休假";
    state.staff[4]!.staffType = "行政支援";
    const rows = getMonthlyDutyRoster(state, "2026-07-20");
    expect(rows[0]?.date).toBe("2026-07-02");
    expect(rows.every((row) => row.cxPreflightStaffId && state.staff.find((person) => person.id === row.cxPreflightStaffId)?.cxPreflightQualified)).toBe(true);
    expect(rows.every((row) => row.dutyStaffId !== row.cxPreflightStaffId && !row.standbyStaffIds.includes(row.dutyStaffId))).toBe(true);
    expect(rows.every((row) => new Set(row.standbyStaffIds.filter(Boolean)).size === row.standbyStaffIds.filter(Boolean).length)).toBe(true);
    expect(rows.flatMap((row) => [row.dutyStaffId, ...row.standbyStaffIds]).filter(Boolean)).not.toContain(state.staff[3]!.id);
    expect(rows.flatMap((row) => [row.dutyStaffId, ...row.standbyStaffIds]).filter(Boolean)).not.toContain(state.staff[4]!.id);
  });

  it("allows the same person to hold CX preflight and standby on one day", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 3);
    state.staff.forEach((person, index) => {
      person.dutyQualified = true;
      person.cxPreflightQualified = index === 0;
    });
    const automatic = getMonthlyDutyRoster(state, "2026-08-01");
    expect(automatic.some((row) => row.cxPreflightStaffId && row.standbyStaffIds.includes(row.cxPreflightStaffId))).toBe(true);
    const row = automatic.find((item) => item.cxPreflightStaffId && item.dutyStaffId !== state.staff[0]!.id)!;
    expect(updateDutyRosterSlot(state, row.date, "standby-0", state.staff[0]!.id)).toBeNull();
    const adjusted = getDutyRosterForDate(state, row.date);
    expect(adjusted.adjusted).toBe(true);
    expect(adjusted.cxPreflightStaffId).toBe(state.staff[0]!.id);
    expect(adjusted.standbyStaffIds).toContain(state.staff[0]!.id);
    expect(updateDutyRosterSlot(state, row.date, "duty", state.staff[0]!.id)).toContain("值班不能与CX航前");
  });

  it("limits duty to qualified staff and keeps monthly duty counts balanced", () => {
    const state = createDefaultState();
    state.staff.slice(0, 3).forEach((person) => { person.cxPreflightQualified = true; });
    state.staff.forEach((person, index) => { person.dutyQualified = index < 5; });
    const rows = getMonthlyDutyRoster(state, "2026-07-20");
    const qualifiedIds = new Set(state.staff.filter((person) => person.dutyQualified).map((person) => person.id));
    expect(rows.every((row) => !row.dutyStaffId || qualifiedIds.has(row.dutyStaffId))).toBe(true);
    const counts = getMonthlyDutyRosterStats(state, "2026-07-20").filter((item) => item.staff.dutyQualified).map((item) => item.dutyDates.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    const unqualified = state.staff.find((person) => !person.dutyQualified && person.status === "正常")!;
    expect(updateDutyRosterSlot(state, "2026-07-20", "duty", unqualified.id)).toContain("值班资质");
  });

  it("finishes the first duty round before assigning a second duty", () => {
    const state = createDefaultState();
    state.staff = state.staff.filter((person) => person.status === "正常");
    state.staff.forEach((person, index) => {
      person.dutyQualified = true;
      person.cxPreflightQualified = index < 6;
    });
    const stats = getMonthlyDutyRosterStats(state, "2026-07-20");
    const dutyCounts = stats.map((item) => item.dutyDates.length).sort((left, right) => left - right);
    const cxCounts = stats.filter((item) => item.staff.cxPreflightQualified).map((item) => item.cxPreflightDates.length).sort((left, right) => left - right);
    const standbyCounts = stats.map((item) => item.standbyDates.length).sort((left, right) => left - right);
    expect(dutyCounts).toEqual([0, ...Array.from({ length: 15 }, () => 1)]);
    expect(cxCounts).toEqual([2, 2, 2, 3, 3, 3]);
    expect(Math.max(...standbyCounts) - Math.min(...standbyCounts)).toBeLessThanOrEqual(1);
    const fullMonthStats = getMonthlyDutyRosterStats(state, "2026-08-01");
    expect(fullMonthStats.every((item) => item.dutyDates.length === 1)).toBe(true);
    expect(fullMonthStats.every((item) => item.standbyDates.length === 2)).toBe(true);
  });

  it("rotates a monthly duty shortage instead of always skipping the same person", () => {
    const state = createDefaultState();
    state.staff = state.staff.filter((person) => person.status === "正常");
    state.staff.forEach((person) => { person.dutyQualified = true; });
    const julyMissing = getMonthlyDutyRosterStats(state, "2026-07-20").find((item) => item.dutyDates.length === 0)?.staff.id;
    const septemberMissing = getMonthlyDutyRosterStats(state, "2026-09-02").find((item) => item.dutyDates.length === 0)?.staff.id;
    expect(julyMissing).toBeTruthy();
    expect(septemberMissing).toBeTruthy();
    expect(septemberMissing).not.toBe(julyMissing);
  });

  it("gives duty priority even when the same person is the only CX-qualified worker", () => {
    const state = createDefaultState();
    state.staff = state.staff.filter((person) => person.status === "正常");
    state.staff.forEach((person) => {
      person.dutyQualified = true;
      person.cxPreflightQualified = person.name === "刘翔";
    });
    const stats = getMonthlyDutyRosterStats(state, "2026-08-01");
    expect(stats.find((item) => item.staff.name === "刘翔")?.dutyDates).toHaveLength(1);
    expect(stats.every((item) => item.dutyDates.length === 1)).toBe(true);
    expect(getMonthlyDutyRoster(state, "2026-08-01").filter((row) => !row.cxPreflightStaffId)).toHaveLength(1);
  });

  it("clears only the selected month when restoring automatic balance", () => {
    const state = createDefaultState();
    state.dutyRosterOverrides = [
      { date: "2026-07-02", cxPreflightStaffId: null, dutyStaffId: "2", standbyStaffIds: ["3", "4"] },
      { date: "2026-08-01", cxPreflightStaffId: null, dutyStaffId: "5", standbyStaffIds: ["6", "7"] }
    ];
    clearMonthlyDutyRosterOverrides(state, "2026-07-20");
    expect(state.dutyRosterOverrides.map((item) => item.date)).toEqual(["2026-08-01"]);
  });

  it("swaps duty and standby people directly in the monthly table", () => {
    const state = createDefaultState();
    state.staff.slice(0, 3).forEach((person) => { person.cxPreflightQualified = true; });
    const before = getDutyRosterForDate(state, "2026-07-20");
    const duty = before.dutyStaffId!;
    const standby = before.standbyStaffIds[0]!;
    expect(updateDutyRosterSlot(state, "2026-07-20", "duty", standby)).toBeNull();
    const after = getDutyRosterForDate(state, "2026-07-20");
    expect(after.dutyStaffId).toBe(standby);
    expect(after.standbyStaffIds[0]).toBe(duty);
    expect(after.adjusted).toBe(true);
  });

  it("uses the high duty fatigue when choosing flight-position staff", () => {
    const state = createDefaultState();
    const workers = state.staff.slice(0, 4);
    state.staff = workers;
    workers[3]!.cxPreflightQualified = true;
    state.flights = [
      { id: "early", flightNo: "F1", startTime: "09:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "late", flightNo: "F2", startTime: "20:00", endTime: "22:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    const roster = getDutyRosterForDate(state, "2026-07-02");
    const dutyStaffId = roster.dutyStaffId!;
    const alternative = workers.find((person) => person.id !== dutyStaffId && person.id !== roster.cxPreflightStaffId)!;
    const lateWorker = workers.find((person) => ![dutyStaffId, alternative.id].includes(person.id))!;
    state.positionRules = [
      { ...base, id: "early-position", flightNo: "F1", name: "P1", fatiguePoints: 0, remark: "", qualifiedStaffIds: [dutyStaffId, alternative.id] },
      { ...base, id: "late-position", flightNo: "F2", name: "P2", fatiguePoints: 0, remark: "", qualifiedStaffIds: [lateWorker.id] }
    ];
    expect(generateSchedule(state, "2026-07-02").assignments.find((item) => item.positionRuleId === "early-position")?.staffId).toBe(alternative.id);
    state.settings.dutyFatiguePoints = 0;
    const expectedById = [dutyStaffId, alternative.id].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0];
    expect(generateSchedule(state, "2026-07-02").assignments.find((item) => item.positionRuleId === "early-position")?.staffId).toBe(expectedById);
  });
});
