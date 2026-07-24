import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { buildScheduleFeedback } from "../domain/schedule-feedback";
import type { AppState, Assignment } from "../model";
import { assignStaff } from "./schedule-actions";

function supervisorSchedule(): AppState {
  const state = createDefaultState();
  const person = state.staff[0]!;
  person.name = "张奇";
  state.staff = [person];
  state.flights = [{ id: "ke166", flightNo: "KE166", startTime: "09:15", endTime: "11:15", bookedPassengers: 100, positions: [], remark: "" }];
  const base = state.positionRules[0]!;
  state.positionRules = [
    { ...base, id: "supervisor", flightNo: "KE166", name: "督导", category: "机动督导", qualifiedStaffIds: [person.id], fatiguePoints: 5 },
    { ...base, id: "h04", flightNo: "KE166", name: "H04", category: "常规", qualifiedStaffIds: [], fatiguePoints: 7 }
  ];
  const assignment = (id: string, ruleId: string, position: string, staffId: string | null, status: Assignment["status"]): Assignment => ({
    id, flightId: "ke166", flightNo: "KE166", positionRuleId: ruleId, position, staffId, staffName: staffId ? person.name : "",
    startTime: "09:15", endTime: "11:15", workHours: 2, fatiguePoints: 2, remark: "", manualRemark: "", status
  });
  state.assignments = [
    assignment("supervisor-assignment", "supervisor", "督导", person.id, "assigned"),
    assignment("h04-assignment", "h04", "H04", null, "unfilled")
  ];
  return state;
}

describe("督导机动补位编辑", () => {
  it("拖动顶部督导到空柜台时保留顶部并跳过目标资质限制", () => {
    const state = supervisorSchedule();
    const result = assignStaff(state, "h04-assignment", state.staff[0]!.id, "supervisor-assignment");

    expect(result).toMatchObject({ changed: true, message: "督导已机动补位至目标岗位" });
    expect(state.assignments.find((item) => item.id === "supervisor-assignment")).toMatchObject({ staffName: "张奇", workHours: 2 });
    expect(state.assignments.find((item) => item.id === "h04-assignment")).toMatchObject({
      staffName: "张奇", workHours: 0, fatiguePoints: 7, supervisorSourceAssignmentId: "supervisor-assignment"
    });
    expect(buildScheduleFeedback(state, "2026-07-22").find((item) => item.key === "coverage")?.text)
      .toContain("督导机动补位：张奇兼任KE166/H04");
  });

  it("拒绝把督导拖入已有人员的柜台", () => {
    const state = supervisorSchedule();
    const target = state.assignments.find((item) => item.id === "h04-assignment")!;
    target.staffId = state.staff[0]!.id;
    target.staffName = state.staff[0]!.name;
    target.status = "assigned";

    expect(assignStaff(state, "h04-assignment", state.staff[0]!.id, "supervisor-assignment")).toMatchObject({
      changed: false, error: "目标岗位已有人员，请先清空 H04"
    });
  });

  it("人工拖拽不能绕过机动督导兼任范围", () => {
    const state = supervisorSchedule();
    state.assignments.find((item) => item.id === "h04-assignment")!.remark = "申报";

    expect(assignStaff(state, "h04-assignment", state.staff[0]!.id, "supervisor-assignment")).toMatchObject({
      changed: false,
      error: expect.stringContaining("机动督导不能兼任 KE166/H04")
    });
  });
});
