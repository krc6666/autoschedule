import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { deleteStaff, updateConfigurationField } from "./configuration-actions";

describe("configuration actions", () => {
  it("applies a flight template and invalidates the active schedule", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const template = state.templates[1]!;
    state.assignments = [{
      id: "assignment", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: null,
      position: "临时岗位", staffId: null, staffName: "", startTime: flight.startTime, endTime: flight.endTime,
      workHours: 0, fatiguePoints: 0, remark: "", manualRemark: "", status: "manual"
    }];
    state.activeScheduleDate = "2026-07-25";

    expect(updateConfigurationField(state, "flight", flight.id, "flightNo", template.flightNo.toLowerCase())).toBe("updated");
    expect(flight).toMatchObject({
      flightNo: template.flightNo,
      startTime: template.startTime,
      endTime: template.endTime,
      positions: template.positions
    });
    expect(state.assignments).toEqual([]);
    expect(state.activeScheduleDate).toBeNull();
  });

  it("keeps mobile-supervisor positions automatic and removes a deleted staff member from references", () => {
    const state = createDefaultState();
    const rule = state.positionRules[0]!;
    const person = state.staff.find((item) => rule.qualifiedStaffIds.includes(item.id))!;
    rule.manual = true;

    expect(updateConfigurationField(state, "position", rule.id, "category", "机动督导")).toBe("updated");
    expect(rule.manual).toBe(false);
    expect(deleteStaff(state, person.id)).toBe(true);
    expect(state.staff.some((item) => item.id === person.id)).toBe(false);
    expect(state.positionRules.every((item) => !item.qualifiedStaffIds.includes(person.id))).toBe(true);
  });
});
