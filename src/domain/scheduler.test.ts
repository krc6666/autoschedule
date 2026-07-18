import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
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
      const conflicts = assigned.filter((other) => other.id !== assignment.id && other.staffId === assignment.staffId && intervalsOverlap(other.startTime, other.endTime, assignment.startTime, assignment.endTime));
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
});
