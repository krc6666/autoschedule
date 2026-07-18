import { describe, expect, it, vi } from "vitest";

import { createDefaultState } from "../defaults";
import { sortFlightCountersDescending, visiblePositionRemark } from "../utils";
import { intervalsOverlap } from "./time";
import { activeFlightPositions, canAssignStaff, generateSchedule } from "./scheduler";

describe("scheduler domain", () => {
  it("assigns only available and qualified staff without time conflicts", () => {
    const state = createDefaultState();
    const result = generateSchedule(state, "2026-07-18");
    const assigned = result.assignments.filter((item) => item.staffId);

    for (const assignment of assigned) {
      const person = state.staff.find((item) => item.id === assignment.staffId)!;
      const rule = state.positionRules.find((item) => item.id === assignment.positionRuleId)!;
      expect(person.status).toBe("正常");
      expect(rule.qualifiedStaffIds).toContain(person.id);
      const conflicts = assigned.filter((other) => other.id !== assignment.id && other.staffId === assignment.staffId && intervalsOverlap(other.startTime, other.endTime, assignment.startTime, assignment.endTime))
        .filter((other) => other.flightId !== assignment.flightId || (!other.position.startsWith("柜台引导1") && !assignment.position.startsWith("柜台引导1")));
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

  it("allows assigning a regular position when the only same-flight overlap is 柜台引导1", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    const guide = state.assignments.find((item) => item.position === "柜台引导1" && item.staffId)!;
    const source = state.assignments.find((item) => item.flightId === guide.flightId && item.id !== guide.id && item.staffId === guide.staffId)!;
    const target = state.assignments.find((item) => item.flightId === guide.flightId && item.id !== guide.id && item.id !== source.id
      && state.positionRules.find((rule) => rule.id === item.positionRuleId)?.qualifiedStaffIds.includes(guide.staffId!))!;
    expect(canAssignStaff(state, target.id, guide.staffId!, source.id)).toBeNull();
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

  it("assigns available roster staff to administrative support when basic positions are full", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 2);
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "督导", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "超规行李引导", category: "行政支援", qualifiedStaffIds: [state.staff[1]!.id] }
    ];
    const adminSupport = generateSchedule(state, "2026-07-18").assignments.find((item) => item.position === "超规行李引导");
    expect(adminSupport).toMatchObject({ status: "assigned", staffId: state.staff[1]!.id });
  });

  it("appends support rules as empty manual placeholders without consuming staff", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    const result = generateSchedule(state, "2026-07-18");
    const support = result.assignments.filter((assignment) => {
      const rule = state.positionRules.find((item) => item.id === assignment.positionRuleId);
      return rule?.category === "支援";
    });
    expect(support.map((item) => item.position)).toEqual(["超规柜台", "柜台引导2", "超规行李引导"]);
    expect(support.every((item) => item.status === "manual" && !item.staffId)).toBe(true);
    expect(result.unfilledCount).toBe(result.assignments.filter((item) => item.status === "unfilled").length);
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

  it("adds one empty generic support cell only for a short-staffed morning flight without configured support", () => {
    const state = createDefaultState();
    const flight = state.flights.find((item) => item.flightNo === "FD573")!;
    flight.startTime = "08:00";
    flight.endTime = "10:00";
    state.flights = [flight];
    state.staff.forEach((person) => { person.status = "休假"; });
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.filter((item) => item.position === "临时支援")).toHaveLength(1);
    expect(result.assignments.find((item) => item.position === "临时支援")).toMatchObject({ status: "manual", staffId: null });
  });

  it("reuses a same-flight worker without a primary-position remark for 柜台引导1", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    const result = generateSchedule(state, "2026-07-18");
    const guide = result.assignments.find((item) => item.position === "柜台引导1")!;
    const source = result.assignments.find((item) => item.flightId === guide.flightId && item.staffId === guide.staffId && item.id !== guide.id)!;
    expect(guide.workHours).toBe(0);
    expect(source.remark).toBe("");
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

  it("randomly selects 柜台引导1 from same-flight workers without remarks", () => {
    const state = createDefaultState();
    state.staff = state.staff.filter((person) => ["2", "3"].includes(person.id));
    state.flights = [state.flights[0]!];
    state.flights[0]!.positions = ["G12", "G13", "柜台引导1"];
    state.positionRules = state.positionRules.filter((rule) => rule.flightNo === "CX937" && ["G12", "G13", "柜台引导1"].includes(rule.name));
    state.positionRules.find((rule) => rule.name === "G12")!.qualifiedStaffIds = ["2"];
    state.positionRules.find((rule) => rule.name === "G13")!.qualifiedStaffIds = ["3"];
    state.positionRules.find((rule) => rule.name === "柜台引导1")!.qualifiedStaffIds = ["2", "3"];
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.position === "柜台引导1")!.staffId).toBe("3");
    } finally {
      random.mockRestore();
    }
  });

  it("uses an archived day to rotate the lower-load worker into the next day", () => {
    const state = createDefaultState();
    state.staff = state.staff.filter((person) => ["2", "3"].includes(person.id));
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
    expect(generateSchedule(state, "2026-07-19").assignments[0]!.staffId).toBe("3");
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
    expect(result.assignments.find((item) => item.position === "临时支援")).toMatchObject({ status: "manual", staffId: null });
    expect(result.assignments[0]!.endTime).toBe("10:00");
  });
});
