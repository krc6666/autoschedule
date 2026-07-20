import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { sortFlightCountersDescending, visiblePositionRemark } from "../utils";
import { intervalsOverlap } from "./time";
import { activeFlightPositions, canAssignStaff, generateSchedule } from "./scheduler";
import { getDutyRosterForDate } from "./duty-roster";

describe("scheduler domain", () => {
  it("assigns only available and qualified staff without time conflicts", () => {
    const state = createDefaultState();
    const result = generateSchedule(state, "2026-07-18");
    const assigned = result.assignments.filter((item) => item.staffId);

    for (const assignment of assigned) {
      const person = state.staff.find((item) => item.id === assignment.staffId)!;
      const rule = state.positionRules.find((item) => item.id === assignment.positionRuleId)!;
      expect(person.status).toBe("正常");
      if (rule.category !== "引导") expect(rule.qualifiedStaffIds).toContain(person.id);
      const conflicts = assigned.filter((other) => other.id !== assignment.id && other.staffId === assignment.staffId && intervalsOverlap(other.startTime, other.endTime, assignment.startTime, assignment.endTime))
        .filter((other) => other.flightId !== assignment.flightId
          || (state.positionRules.find((item) => item.id === other.positionRuleId)?.category !== "引导" && rule.category !== "引导"));
      expect(conflicts).toHaveLength(0);
    }
  });

  it("marks a position unfilled when every qualified person is unavailable", () => {
    const state = createDefaultState();
    const rule = state.positionRules.find((item) => item.flightNo === "TR121" && item.name === "收费/引导")!;
    state.staff.filter((item) => rule.qualifiedStaffIds.includes(item.id)).forEach((item) => { item.status = "休假"; });
    const result = generateSchedule(state, "2026-07-18");
    const assignment = result.assignments.find((item) => item.positionRuleId === rule.id)!;
    expect(assignment.staffId).toBeNull();
    expect(result.unfilledCount).toBeGreaterThan(0);
  });

  it("prefers the candidate with lower historical fatigue", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    state.flights[0]!.positions = ["G12"];
    state.history = [{ id: "h1", date: "2026-07-17", flightNo: "F", position: "P", staffId: "2", staffName: "华嘉慧", startTime: "08:00", endTime: "12:00", workHours: 4, fatiguePoints: 30, remark: "" }];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments[0]!.staffId).not.toBe("2");
  });

  it("prefers a rested worker for a high-load position during the recovery window", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "first-flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second-base-flight", flightNo: "F0", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "next-flight", flightNo: "F2", startTime: "11:00", endTime: "13:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "first-high", flightNo: "F1", name: "一号柜台", remark: "一号", fatiguePoints: 5, qualifiedStaffIds: [first!.id] },
      { ...base, id: "second-base", flightNo: "F0", name: "普通柜台", remark: "", fatiguePoints: 1, qualifiedStaffIds: [second!.id] },
      { ...base, id: "next-high", flightNo: "F2", name: "控制柜台", remark: "", fatiguePoints: 5, qualifiedStaffIds: [first!.id, second!.id] }
    ];
    state.history = [{ id: "history", date: "2026-07-17", flightNo: "OLD", position: "P", staffId: second!.id, staffName: second!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 20, remark: "" }];
    state.settings.highLoadProtectionEnabled = true;
    state.settings.highLoadFatigueThreshold = 4;
    state.settings.highLoadRecoveryMinutes = 180;
    state.settings.remarkedPositionHighLoad = true;
    state.settings.highLoadTransitionMode = "prefer";
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.positionRotationEnabled = false;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "next-high")?.staffId).toBe(second!.id);
    state.settings.highLoadProtectionEnabled = false;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "next-high")?.staffId).toBe(first!.id);
  });

  it("leaves a high-load position empty when strict transition protection excludes every candidate", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.flights = [
      { id: "first-flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second-flight", flightNo: "F2", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "next-flight", flightNo: "F3", startTime: "11:00", endTime: "13:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "first-high", flightNo: "F1", name: "一号", remark: "一号", fatiguePoints: 5, qualifiedStaffIds: [first!.id] },
      { ...base, id: "second-high", flightNo: "F2", name: "申报", remark: "申报", fatiguePoints: 5, qualifiedStaffIds: [second!.id] },
      { ...base, id: "next-high", flightNo: "F3", name: "控制", remark: "控制", fatiguePoints: 5, qualifiedStaffIds: [first!.id, second!.id] }
    ];
    state.settings.highLoadProtectionEnabled = true;
    state.settings.highLoadFatigueThreshold = 4;
    state.settings.highLoadRecoveryMinutes = 180;
    state.settings.remarkedPositionHighLoad = true;
    state.settings.highLoadTransitionMode = "forbid";
    const result = generateSchedule(state, "2026-07-18");
    const target = result.assignments.find((item) => item.positionRuleId === "next-high")!;
    expect(target).toMatchObject({ staffId: null, status: "unfilled" });
    state.assignments = result.assignments;
    expect(canAssignStaff(state, target.id, first!.id)).toContain("高负荷岗位恢复期");
  });

  it("applies an editable position-to-position preparation interval", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "source-flight", flightNo: "CX931", startTime: "17:50", endTime: "19:50", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second-base-flight", flightNo: "BASE", startTime: "17:50", endTime: "19:50", bookedPassengers: 100, positions: [], remark: "" },
      { id: "target-flight", flightNo: "TR121", startTime: "21:55", endTime: "23:55", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "source-g19", flightNo: "CX931", name: "G19", fatiguePoints: 2, remark: "", qualifiedStaffIds: [first!.id] },
      { ...base, id: "second-base", flightNo: "BASE", name: "普通柜台", fatiguePoints: 1, remark: "", qualifiedStaffIds: [second!.id] },
      { ...base, id: "target-h02", flightNo: "TR121", name: "H02", fatiguePoints: 2, remark: "", qualifiedStaffIds: [first!.id, second!.id] }
    ];
    state.history = [{ id: "history", date: "2026-07-17", flightNo: "OLD", position: "P", staffId: second!.id, staffName: second!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 20, remark: "" }];
    state.settings.positionTransitionPolicies = [{
      id: "cx931-h02", name: "H02准备保护", enabled: true,
      sourceFlightNo: "CX931", sourcePositions: ["G19"], targetFlightNo: "TR121", targetPosition: "H02",
      minimumGapMinutes: 180, mode: "prefer"
    }];
    const protectedSchedule = generateSchedule(state, "2026-07-18");
    expect(protectedSchedule.assignments.find((item) => item.positionRuleId === "target-h02")?.staffId).toBe(second!.id);
    state.assignments = protectedSchedule.assignments;
    state.settings.positionTransitionPolicies[0]!.mode = "forbid";
    const protectedTarget = state.assignments.find((item) => item.positionRuleId === "target-h02")!;
    expect(canAssignStaff(state, protectedTarget.id, first!.id)).toContain("最小衔接间隔");
    state.settings.positionTransitionPolicies[0]!.enabled = false;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "target-h02")?.staffId).toBe(first!.id);
  });

  it("protects a worker when projected fatigue exceeds the rolling-window limit", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "first-flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second-base-flight", flightNo: "F0", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "next-flight", flightNo: "F2", startTime: "11:00", endTime: "13:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "first-load", flightNo: "F1", name: "P1", fatiguePoints: 5, remark: "", qualifiedStaffIds: [first!.id] },
      { ...base, id: "second-base", flightNo: "F0", name: "P0", fatiguePoints: 1, remark: "", qualifiedStaffIds: [second!.id] },
      { ...base, id: "next-load", flightNo: "F2", name: "P2", fatiguePoints: 5, remark: "", qualifiedStaffIds: [first!.id, second!.id] }
    ];
    state.history = [{ id: "history", date: "2026-07-17", flightNo: "OLD", position: "P", staffId: second!.id, staffName: second!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 20, remark: "" }];
    state.settings.highLoadProtectionEnabled = false;
    state.settings.positionTransitionPolicies = [];
    state.settings.rollingLoadProtectionEnabled = true;
    state.settings.rollingLoadWindowMinutes = 360;
    state.settings.rollingLoadMaxFatigue = 8;
    state.settings.rollingLoadMode = "prefer";
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "next-load")?.staffId).toBe(second!.id);
    state.settings.rollingLoadProtectionEnabled = false;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "next-load")?.staffId).toBe(first!.id);
  });

  it("rotates a qualified worker away from a recently repeated flight position", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "g20", flightNo: "F1", name: "G20", fatiguePoints: 4, remark: "", qualifiedStaffIds: [first!.id, second!.id] }];
    state.history = [
      { id: "repeat", date: "2026-07-17", flightNo: "F1", position: "G20", staffId: first!.id, staffName: first!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: "" },
      { id: "other-load", date: "2026-07-17", flightNo: "OLD", position: "OTHER", staffId: second!.id, staffName: second!.name, startTime: "11:00", endTime: "13:00", workHours: 2, fatiguePoints: 20, remark: "" }
    ];
    state.settings.positionRotationEnabled = true;
    state.settings.positionRotationLookbackDays = 3;
    state.settings.positionRotationMode = "prefer";
    expect(generateSchedule(state, "2026-07-18").assignments[0]!.staffId).toBe(second!.id);
    state.settings.positionRotationEnabled = false;
    expect(generateSchedule(state, "2026-07-18").assignments[0]!.staffId).toBe(first!.id);
  });

  it("reduces the next late-shift load after a high-load final flight on the previous day", () => {
    const state = createDefaultState();
    const [protectedWorker, restedWorker] = state.staff;
    state.staff = [protectedWorker!, restedWorker!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "late-flight", flightNo: "TR121", startTime: "21:55", endTime: "23:55", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "late-high", flightNo: "TR121", name: "H02", fatiguePoints: 4, remark: "一号", qualifiedStaffIds: [protectedWorker!.id, restedWorker!.id] }
    ];
    state.history = [
      { id: "previous-late", date: "2026-07-18", flightNo: "TR121", position: "H02", staffId: protectedWorker!.id, staffName: protectedWorker!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 5, remark: "一号" },
      { id: "rested-worker-load", date: "2026-07-18", flightNo: "EARLY", position: "P", staffId: restedWorker!.id, staffName: restedWorker!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 20, remark: "" }
    ];
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.positionRotationEnabled = false;
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.lateShiftStartTime = "20:00";
    state.settings.lateShiftLatestWindowMinutes = 180;
    state.settings.nextDayLateMaxFatigue = 2;
    state.settings.lateShiftRecoveryMode = "prefer";
    expect(generateSchedule(state, "2026-07-20").assignments[0]!.staffId).toBe(restedWorker!.id);
    state.settings.lateShiftRecoveryEnabled = false;
    expect(generateSchedule(state, "2026-07-20").assignments[0]!.staffId).toBe(protectedWorker!.id);
  });

  it("keeps a protected late-shift worker for the lighter lower position when staffing is limited", () => {
    const state = createDefaultState();
    const [protectedWorker, restedWorker] = state.staff;
    state.staff = [protectedWorker!, restedWorker!];
    state.flights = [{ id: "late-flight", flightNo: "TR121", startTime: "21:55", endTime: "23:55", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "upper-high", flightNo: "TR121", name: "H02", fatiguePoints: 4, remark: "一号", qualifiedStaffIds: [protectedWorker!.id, restedWorker!.id] },
      { ...base, id: "lower-light", flightNo: "TR121", name: "H01", fatiguePoints: 1, remark: "", qualifiedStaffIds: [protectedWorker!.id, restedWorker!.id] }
    ];
    state.history = [{ id: "previous-late", date: "2026-07-17", flightNo: "TR121", position: "H02", staffId: protectedWorker!.id, staffName: protectedWorker!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 5, remark: "一号" }];
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.positionRotationEnabled = false;
    state.settings.lateShiftRecoveryMode = "prefer";
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.positionRuleId === "upper-high")?.staffId).toBe(restedWorker!.id);
    expect(result.assignments.find((item) => item.positionRuleId === "lower-light")?.staffId).toBe(protectedWorker!.id);
  });

  it("blocks an excessive next-day late position when late-shift recovery is strict", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.staff = [person];
    state.flights = [{ id: "late-flight", flightNo: "TR121", startTime: "21:55", endTime: "23:55", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "late-high", flightNo: "TR121", name: "H02", fatiguePoints: 4, remark: "一号", qualifiedStaffIds: [person.id] }];
    state.history = [{ id: "previous-late", date: "2026-07-17", flightNo: "TR121", position: "H02", staffId: person.id, staffName: person.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 5, remark: "一号" }];
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.positionRotationEnabled = false;
    state.settings.lateShiftRecoveryMode = "forbid";
    state.settings.nextDayLateMaxFatigue = 2;
    const result = generateSchedule(state, "2026-07-18");
    const target = result.assignments[0]!;
    expect(target).toMatchObject({ staffId: null, status: "unfilled" });
    state.assignments = result.assignments;
    state.activeScheduleDate = "2026-07-18";
    expect(canAssignStaff(state, target.id, person.id)).toContain("下个工作日晚班负荷上限");
  });

  it("rejects manual changes that violate time constraints", () => {
    const state = createDefaultState();
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    const pair = state.assignments.flatMap((first) => state.assignments
      .filter((other) => other.flightId === first.flightId && other.id !== first.id && first.staffId)
      .filter((other) => {
        const rule = state.positionRules.find((item) => item.id === other.positionRuleId);
        return rule?.qualifiedStaffIds.includes(first.staffId!) ?? false;
      })
      .map((other) => ({ first, other })))[0]!;
    expect(canAssignStaff(state, pair.other.id, pair.first.staffId!)).toMatch(/时段/);
  });

  it("allows assigning a regular position when the only same-flight overlap is a guide assignment", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    const base = state.positionRules[0]!;
    state.staff = [person];
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    state.positionRules = [
      { ...base, id: "source", flightNo: "F1", name: "G01", category: "常规", qualifiedStaffIds: [person.id] },
      { ...base, id: "target", flightNo: "F1", name: "G02", category: "常规", qualifiedStaffIds: [person.id] },
      { ...base, id: "guide", flightNo: "F1", name: "柜台引导", category: "引导", qualifiedStaffIds: [] }
    ];
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    const source = state.assignments.find((item) => item.positionRuleId === "source")!;
    const target = state.assignments.find((item) => item.positionRuleId === "target")!;
    const guide = state.assignments.find((item) => item.positionRuleId === "guide")!;
    expect(guide.staffId).toBe(person.id);
    expect(canAssignStaff(state, target.id, person.id, source.id)).toBeNull();
  });

  it("keeps positions visible below passenger thresholds and leaves them empty", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    state.flights[0]!.positions = ["G12", "G13"];
    state.positionRules = state.positionRules.filter((rule) => rule.flightNo === "CX937" && ["G12", "G13"].includes(rule.name));
    state.flights[0]!.bookedPassengers = 20;
    state.positionRules.find((rule) => rule.flightNo === "CX937" && rule.name === "G13")!.minPassengers = 30;
    const belowThreshold = generateSchedule(state, "2026-07-18").assignments;
    expect(belowThreshold.map((item) => item.position)).toEqual(["G12", "G13"]);
    expect(belowThreshold.find((item) => item.position === "G13")).toMatchObject({ staffId: null, status: "manual" });
    state.flights[0]!.bookedPassengers = 30;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.position === "G13")?.staffId).not.toBeNull();
  });

  it("puts supervisors first and otherwise follows position configuration order", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    state.flights = [flight];
    const rules = state.positionRules.filter((rule) => rule.flightNo === flight.flightNo);
    state.positionRules = [
      rules.find((rule) => rule.name === "G12")!,
      rules.find((rule) => rule.name === "督导")!,
      rules.find((rule) => rule.name === "G13")!,
      rules.find((rule) => rule.name === "超规柜台")!
    ];
    expect(activeFlightPositions(state, flight)).toEqual(["督导", "G12", "G13", "超规柜台"]);
  });

  it("sorts all G and H counters from high to low in one operation", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const rules = state.positionRules.filter((rule) => rule.flightNo === flight.flightNo);
    state.positionRules = [
      rules.find((rule) => rule.name === "G12")!,
      rules.find((rule) => rule.name === "柜台引导1")!,
      rules.find((rule) => rule.name === "G20")!,
      rules.find((rule) => rule.name === "督导")!,
      rules.find((rule) => rule.name === "G13")!
    ];
    state.positionRules = sortFlightCountersDescending(state.positionRules, flight.flightNo);
    expect(activeFlightPositions(state, flight)).toEqual(["督导", "G20", "G13", "G12", "柜台引导1"]);
  });

  it("keeps administrative support in its position role instead of moving the category to the bottom", () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = true;
    state.staff = state.staff.slice(0, 3);
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "G14", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "G13", category: "行政支援", qualifiedStaffIds: [state.staff[1]!.id] },
      { ...base, id: "p3", flightNo: "F1", name: "督导", category: "行政支援", qualifiedStaffIds: [state.staff[2]!.id] }
    ];
    expect(generateSchedule(state, "2026-07-18").assignments.map((item) => item.position)).toEqual(["督导", "G14", "G13"]);
  });

  it("leaves administrative support empty when a basic position is short-staffed", () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = true;
    state.staff = [state.staff[0]!];
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "督导", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "G12", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p3", flightNo: "F1", name: "超规行李引导", category: "行政支援", qualifiedStaffIds: [] }
    ];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.position === "G12")?.status).toBe("unfilled");
    expect(result.assignments.find((item) => item.position === "超规行李引导")).toMatchObject({ status: "manual", staffId: null });
  });

  it("keeps administrative support positions empty even when basic positions are full", () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = true;
    state.staff = state.staff.slice(0, 2);
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "督导", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "超规行李引导", category: "行政支援", qualifiedStaffIds: [state.staff[1]!.id] }
    ];
    const adminSupport = generateSchedule(state, "2026-07-18").assignments.find((item) => item.position === "超规行李引导");
    expect(adminSupport).toMatchObject({ status: "manual", staffId: null });
  });

  it("omits administrative support positions while the mode is disabled", () => {
    const state = createDefaultState();
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "G14", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "行政补位", category: "行政支援", qualifiedStaffIds: [] }
    ];
    expect(generateSchedule(state, "2026-07-18").assignments.map((item) => item.position)).toEqual(["G14"]);
  });

  it("lets administrative personnel bypass position qualifications only in support mode", () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = true;
    const person = state.staff[0]!;
    person.staffType = "行政支援";
    state.flights = [state.flights[0]!];
    const rule = state.positionRules.find((item) => item.flightNo === state.flights[0]!.flightNo && item.name === "G12")!;
    rule.qualifiedStaffIds = [];
    state.assignments = [{
      id: "target", flightId: state.flights[0]!.id, flightNo: state.flights[0]!.flightNo, positionRuleId: rule.id,
      position: rule.name, staffId: null, staffName: "", startTime: state.flights[0]!.startTime, endTime: state.flights[0]!.endTime,
      workHours: 2, fatiguePoints: rule.fatiguePoints, remark: "", manualRemark: "", status: "unfilled"
    }];
    expect(canAssignStaff(state, "target", person.id)).toBeNull();
    state.settings.adminSupportEnabled = false;
    expect(canAssignStaff(state, "target", person.id)).toContain("尚未启用");
  });

  it("generates one assignment for every configured rule id without inventing positions", () => {
    const state = createDefaultState();
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: ["未配置岗位"], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "督导", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "督导", qualifiedStaffIds: [state.staff[1]!.id] }
    ];
    const assignments = generateSchedule(state, "2026-07-18").assignments;
    expect(assignments.map((item) => item.positionRuleId)).toEqual(["p1", "p2"]);
    expect(assignments.map((item) => item.position)).toEqual(["督导", "督导"]);
  });

  it("replaces a same-name regular position in administrative support mode", () => {
    const state = createDefaultState();
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "regular-supervisor", flightNo: "F1", name: "督导", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "regular-counter", flightNo: "F1", name: "G14", category: "常规", qualifiedStaffIds: [state.staff[1]!.id] },
      { ...base, id: "admin-supervisor", flightNo: "F1", name: "督导", category: "行政支援", qualifiedStaffIds: [] }
    ];
    expect(generateSchedule(state, "2026-07-18").assignments.map((item) => item.positionRuleId)).toEqual(["regular-supervisor", "regular-counter"]);
    state.settings.adminSupportEnabled = true;
    expect(generateSchedule(state, "2026-07-18").assignments).toMatchObject([
      { positionRuleId: "admin-supervisor", status: "manual", staffId: null },
      { positionRuleId: "regular-counter", status: "assigned" }
    ]);
  });

  it("reserves versatile staff for a later overlapping position with fewer qualified workers", () => {
    const state = createDefaultState();
    state.staff = state.staff.filter((person) => ["2", "3"].includes(person.id));
    state.flights = [
      { id: "flex-flight", flightNo: "FLEX", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "rare-flight", flightNo: "RARE", startTime: "09:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "flex", flightNo: "FLEX", name: "普通柜台", qualifiedStaffIds: ["2", "3"] },
      { ...base, id: "rare", flightNo: "RARE", name: "限制柜台", qualifiedStaffIds: ["2"] }
    ];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.positionRuleId === "flex")?.staffId).toBe("3");
    expect(result.assignments.find((item) => item.positionRuleId === "rare")?.staffId).toBe("2");
    expect(result.unfilledCount).toBe(0);
  });

  it("fills guide rules from the bottom-most distinct regular positions", () => {
    const state = createDefaultState();
    const [topWorker, bottomWorker, diversionWorker] = state.staff;
    state.staff = [topWorker!, bottomWorker!, diversionWorker!];
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "regular-top", flightNo: "F1", name: "G03", category: "常规", qualifiedStaffIds: [topWorker!.id] },
      { ...base, id: "regular-bottom", flightNo: "F1", name: "G02", category: "常规", qualifiedStaffIds: [bottomWorker!.id] },
      { ...base, id: "diversion-lowest", flightNo: "F1", name: "G01", category: "分流", qualifiedStaffIds: [diversionWorker!.id] },
      { ...base, id: "guide-one", flightNo: "F1", name: "柜台引导1", category: "引导", qualifiedStaffIds: [] },
      { ...base, id: "guide-two", flightNo: "F1", name: "柜台引导2", category: "引导", qualifiedStaffIds: [] }
    ];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.positionRuleId === "guide-one")?.staffId).toBe(bottomWorker!.id);
    expect(result.assignments.find((item) => item.positionRuleId === "guide-two")?.staffId).toBe(topWorker!.id);
    expect(result.assignments.filter((item) => item.positionRuleId?.startsWith("guide-")).every((item) => item.workHours === 0)).toBe(true);
  });

  it("does not copy one flight's configured guide positions into every other flight", () => {
    const state = createDefaultState();
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.flightNo === "CX937" && item.position === "柜台引导1")?.staffId).toEqual(expect.any(String));
    expect(result.assignments.find((item) => item.flightNo === "FD573" && item.position === "柜台引导1")).toBeUndefined();
    expect(result.assignments.find((item) => item.flightNo === "TR121" && item.position === "收费/引导")).toBeDefined();
  });

  it("generates only configured positions and never adds generic support to afternoon flights", () => {
    const state = createDefaultState();
    const flight = state.flights.find((item) => item.flightNo === "FD573")!;
    flight.positions.push("未配置岗位");
    state.flights = [flight];
    state.staff.forEach((person) => { person.status = "休假"; });
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.some((item) => item.position === "未配置岗位")).toBe(false);
    expect(result.assignments.some((item) => item.position === "临时支援")).toBe(false);
    expect(result.assignments.filter((item) => !item.positionRuleId).every((item) => ["柜台引导1", "柜台引导2", "超规柜台", "超规行李引导"].includes(item.position))).toBe(true);
  });

  it("does not invent a generic support position for a short-staffed morning flight", () => {
    const state = createDefaultState();
    const flight = state.flights.find((item) => item.flightNo === "FD573")!;
    flight.startTime = "08:00";
    flight.endTime = "10:00";
    state.flights = [flight];
    state.staff.forEach((person) => { person.status = "休假"; });
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.filter((item) => item.position === "临时支援")).toHaveLength(0);
  });

  it("allows a guide to reuse its selected same-flight regular worker", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    const result = generateSchedule(state, "2026-07-18");
    const guide = result.assignments.find((item) => item.position === "柜台引导1")!;
    const source = result.assignments.find((item) => item.flightId === guide.flightId && item.staffId === guide.staffId && item.id !== guide.id)!;
    expect(guide.workHours).toBe(0);
    expect(state.positionRules.find((item) => item.id === source.positionRuleId)?.category).toBe("常规");
    state.assignments = result.assignments;
    guide.staffId = null;
    guide.staffName = "";
    guide.status = "unfilled";
    expect(canAssignStaff(state, guide.id, source.staffId!, source.id)).toBeNull();
  });

  it("hides 一号 while preserving the rest of a configured position remark", () => {
    expect(visiblePositionRemark("一号申报")).toBe("申报");
    expect(visiblePositionRemark("一号")).toBe("");
  });

  it("prioritizes regular workers who do not yet have working hours", () => {
    const state = createDefaultState();
    const workers = state.staff.slice(0, 3);
    state.staff = workers;
    state.flights = [
      { id: "f1", flightNo: "F1", startTime: "08:00", endTime: "09:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "f2", flightNo: "F2", startTime: "09:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "f3", flightNo: "F3", startTime: "10:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = state.flights.map((flight, index) => ({
      ...base, id: `p${index + 1}`, flightNo: flight.flightNo, name: `P${index + 1}`,
      fatiguePoints: 0, remark: "", qualifiedStaffIds: workers.map((person) => person.id)
    }));
    const assignments = generateSchedule(state, "2026-07-18").assignments;
    expect(new Set(assignments.map((item) => item.staffId))).toEqual(new Set(workers.map((person) => person.id)));
  });

  it("gives every available regular worker actual hours in the configured default schedule", () => {
    const state = createDefaultState();
    const assignments = generateSchedule(state, "2026-07-18").assignments;
    const workedIds = new Set(assignments.filter((item) => item.workHours > 0).map((item) => item.staffId));
    const requiredIds = state.staff
      .filter((person) => person.staffType === "常规" && person.status === "正常")
      .map((person) => person.id);
    expect(requiredIds.every((staffId) => workedIds.has(staffId))).toBe(true);
  });

  it("reserves the duty-qualified person for the first counter on the latest flight", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    state.flights = [
      { id: "early", flightNo: "EARLY", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "late", flightNo: "LATE", startTime: "21:00", endTime: "23:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    const qualifiedStaffIds = state.staff.map((person) => person.id);
    state.positionRules = [
      { ...base, id: "early-position", flightNo: "EARLY", name: "普通柜台", remark: "", fatiguePoints: 1, qualifiedStaffIds },
      { ...base, id: "late-supervisor", flightNo: "LATE", name: "督导", remark: "", fatiguePoints: 4, qualifiedStaffIds },
      { ...base, id: "late-first", flightNo: "LATE", name: "H02", remark: "一号", fatiguePoints: 5, qualifiedStaffIds }
    ];
    const dutyStaffId = getDutyRosterForDate(state, "2026-07-20").dutyStaffId;
    const assignments = generateSchedule(state, "2026-07-20").assignments;
    expect(assignments.find((item) => item.positionRuleId === "late-first")?.staffId).toBe(dutyStaffId);
  });

  it("keeps the duty person off earlier high-load work so they cover the latest noted position", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    const dutyStaffId = getDutyRosterForDate(state, "2026-07-20").dutyStaffId!;
    const other = state.staff.find((person) => person.id !== dutyStaffId)!;
    state.flights = [
      { id: "early", flightNo: "EARLY", startTime: "17:00", endTime: "19:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "late", flightNo: "LATE", startTime: "21:00", endTime: "23:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "early-control", flightNo: "EARLY", name: "G18", remark: "控制", fatiguePoints: 5, qualifiedStaffIds: [dutyStaffId, other.id] },
      { ...base, id: "late-first", flightNo: "LATE", name: "H02", remark: "一号", fatiguePoints: 5, qualifiedStaffIds: [dutyStaffId, other.id] }
    ];
    state.history = [{
      id: "other-history", date: "2026-07-18", flightNo: "EARLY", position: "G18", staffId: other.id, staffName: other.name,
      startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 50, remark: ""
    }];

    const assignments = generateSchedule(state, "2026-07-20").assignments;
    expect(assignments.find((item) => item.positionRuleId === "early-control")?.staffId).toBe(other.id);
    expect(assignments.find((item) => item.positionRuleId === "late-first")?.staffId).toBe(dutyStaffId);
  });

  it("falls back to a noted position on the second-latest flight when the latest has no eligible target", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    const dutyStaffId = getDutyRosterForDate(state, "2026-07-20").dutyStaffId!;
    const other = state.staff.find((person) => person.id !== dutyStaffId)!;
    state.flights = [
      { id: "early", flightNo: "EARLY", startTime: "17:00", endTime: "19:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second-latest", flightNo: "SECOND", startTime: "20:00", endTime: "22:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "latest", flightNo: "LATEST", startTime: "22:30", endTime: "00:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "early-position", flightNo: "EARLY", name: "P1", remark: "", fatiguePoints: 1, qualifiedStaffIds: [dutyStaffId, other.id] },
      { ...base, id: "second-declare", flightNo: "SECOND", name: "G17", remark: "申报", fatiguePoints: 4, qualifiedStaffIds: [dutyStaffId, other.id] },
      { ...base, id: "latest-first", flightNo: "LATEST", name: "H02", remark: "一号", fatiguePoints: 5, qualifiedStaffIds: [other.id] }
    ];

    const assignments = generateSchedule(state, "2026-07-20").assignments;
    expect(assignments.find((item) => item.positionRuleId === "second-declare")?.staffId).toBe(dutyStaffId);
    expect(assignments.find((item) => item.positionRuleId === "latest-first")?.staffId).toBe(other.id);
  });

  it("assigns the duty person to both a flight by 08:30 and the protected late position", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    const dutyStaffId = getDutyRosterForDate(state, "2026-07-20").dutyStaffId!;
    const qualifiedStaffIds = state.staff.map((person) => person.id);
    state.flights = [
      { id: "morning", flightNo: "MORNING", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" },
      { id: "middle", flightNo: "MIDDLE", startTime: "15:00", endTime: "17:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "late", flightNo: "LATE", startTime: "21:00", endTime: "23:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "morning-position", flightNo: "MORNING", name: "G12", remark: "", fatiguePoints: 1, qualifiedStaffIds },
      { ...base, id: "middle-position", flightNo: "MIDDLE", name: "G13", remark: "", fatiguePoints: 1, qualifiedStaffIds },
      { ...base, id: "late-first", flightNo: "LATE", name: "H02", remark: "一号", fatiguePoints: 5, qualifiedStaffIds }
    ];

    const dutyAssignments = generateSchedule(state, "2026-07-20").assignments.filter((item) => item.staffId === dutyStaffId);
    expect(dutyAssignments.some((item) => item.flightNo === "MORNING")).toBe(true);
    expect(dutyAssignments.some((item) => item.positionRuleId === "late-first")).toBe(true);
    expect(dutyAssignments.some((item) => item.flightNo === "MIDDLE")).toBe(false);
  });

  it("uses an archived day to rotate the lower-load worker into the next duty day", () => {
    const state = createDefaultState();
    state.settings.dutyFatiguePoints = 0;
    state.staff = state.staff.filter((person) => ["2", "3"].includes(person.id));
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [state.flights[0]!];
    state.flights[0]!.positions = ["G12"];
    state.positionRules = state.positionRules.filter((rule) => rule.flightNo === "CX937" && rule.name === "G12");
    const firstDay = generateSchedule(state, "2026-07-18").assignments[0]!;
    expect(firstDay.staffId).toBe("2");
    state.history = [{
      id: "archived", date: "2026-07-18", flightNo: firstDay.flightNo, position: firstDay.position,
      staffId: firstDay.staffId!, staffName: firstDay.staffName, startTime: firstDay.startTime, endTime: firstDay.endTime,
      workHours: firstDay.workHours, fatiguePoints: firstDay.fatiguePoints, remark: ""
    }];
    expect(generateSchedule(state, "2026-07-20").assignments[0]!.staffId).toBe("3");
  });

  it("allows an afternoon diversion position to release early for the next flight", () => {
    const state = createDefaultState();
    state.staff = [state.staff.find((person) => person.id === "2")!];
    state.flights = [
      { id: "f1", flightNo: "F1", startTime: "15:00", endTime: "17:00", bookedPassengers: 0, positions: ["P1"], remark: "" },
      { id: "f2", flightNo: "F2", startTime: "16:30", endTime: "18:30", bookedPassengers: 0, positions: ["P2"], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "P1", category: "分流", qualifiedStaffIds: ["2"], earlyReleaseMinutes: 60 },
      { ...base, id: "p2", flightNo: "F2", name: "P2", category: "常规", qualifiedStaffIds: ["2"], earlyReleaseMinutes: 0 }
    ];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.map((item) => item.staffId)).toEqual(["2", "2"]);
    expect(result.assignments[0]).toMatchObject({ endTime: "16:30", workHours: 1.5 });
  });

  it("does not apply diversion release to morning flights", () => {
    const state = createDefaultState();
    state.staff = [state.staff.find((person) => person.id === "2")!];
    state.flights = [
      { id: "f1", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 0, positions: ["P1"], remark: "" },
      { id: "f2", flightNo: "F2", startTime: "09:30", endTime: "11:30", bookedPassengers: 0, positions: ["P2"], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "P1", category: "分流", qualifiedStaffIds: ["2"], earlyReleaseMinutes: 60 },
      { ...base, id: "p2", flightNo: "F2", name: "P2", category: "常规", qualifiedStaffIds: ["2"], earlyReleaseMinutes: 0 }
    ];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.filter((item) => item.positionRuleId).map((item) => item.staffId)).toEqual(["2", null]);
    expect(result.assignments.find((item) => item.position === "临时支援")).toBeUndefined();
    expect(result.assignments[0]!.endTime).toBe("10:00");
  });
});
