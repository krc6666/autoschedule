import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { visiblePositionRemark } from "../utils";
import { intervalsOverlap } from "./time";
import { canAssignStaff, generateSchedule } from "./scheduler";

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

  it("uses passenger thresholds to scale the active positions for a flight", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    state.flights[0]!.positions = ["G12", "G13"];
    state.positionRules = state.positionRules.filter((rule) => rule.flightNo === "CX937" && ["G12", "G13"].includes(rule.name));
    state.flights[0]!.bookedPassengers = 20;
    state.positionRules.find((rule) => rule.flightNo === "CX937" && rule.name === "G13")!.minPassengers = 30;
    expect(generateSchedule(state, "2026-07-18").assignments.map((item) => item.position)).toEqual(["G12"]);
    state.flights[0]!.bookedPassengers = 30;
    expect(generateSchedule(state, "2026-07-18").assignments.map((item) => item.position)).toEqual(["G12", "G13"]);
  });

  it("appends support rules and allows them to remain empty without becoming unfilled", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    const result = generateSchedule(state, "2026-07-18");
    const support = result.assignments.filter((assignment) => {
      const rule = state.positionRules.find((item) => item.id === assignment.positionRuleId);
      return rule?.category === "支援";
    });
    expect(support.map((item) => item.position)).toEqual(["柜台引导2", "超规柜台", "超规行李引导"]);
    expect(support.every((item) => item.status === "manual" && item.staffName === "")).toBe(true);
    expect(result.unfilledCount).toBe(result.assignments.filter((item) => item.status === "unfilled").length);
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
});
