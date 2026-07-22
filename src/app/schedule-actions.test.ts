import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { buildScheduleFeedback } from "../domain/schedule-feedback";
import type { AppState, Assignment, PositionRule } from "../model";
import { assignSupervisorFillToRegularPosition } from "./schedule-actions";

function supervisorCoverState(): AppState {
  const state = createDefaultState();
  const person = state.staff[0]!;
  person.name = "张奇";
  person.status = "正常";
  person.staffType = "常规";
  person.nightShift = true;
  state.staff = [person];
  state.flights = [
    { id: "ke166", flightNo: "KE166", startTime: "09:15", endTime: "11:15", bookedPassengers: 100, positions: [], remark: "" },
    { id: "other", flightNo: "OTHER", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }
  ];
  const base = state.positionRules[0]!;
  const rule = (id: string, flightNo: string, name: string, category: PositionRule["category"], qualifiedStaffIds: string[], fatiguePoints: number): PositionRule => ({
    ...base, id, flightNo, name, category, qualifiedStaffIds, fatiguePoints, manual: category === "督导补位"
  });
  state.positionRules = [
    rule("supervisor", "KE166", "督导", "常规", [person.id], 5),
    rule("h06", "KE166", "H06", "督导补位", [], 2),
    rule("h04", "KE166", "H04", "常规", [person.id], 7),
    rule("h03", "KE166", "H03", "常规", [], 6),
    rule("other-h04", "OTHER", "H04", "常规", [person.id], 7)
  ];
  const assignment = (
    id: string,
    flightId: string,
    flightNo: string,
    ruleId: string,
    position: string,
    staffId: string | null,
    status: Assignment["status"],
    workHours: number,
    fatiguePoints: number
  ): Assignment => ({
    id, flightId, flightNo, positionRuleId: ruleId, position,
    staffId, staffName: staffId ? person.name : "", startTime: flightId === "ke166" ? "09:15" : "13:00",
    endTime: flightId === "ke166" ? "11:15" : "15:00", workHours, fatiguePoints,
    remark: "", manualRemark: "", status
  });
  state.assignments = [
    assignment("supervisor-assignment", "ke166", "KE166", "supervisor", "督导", person.id, "assigned", 2, 5),
    { ...assignment("h06-assignment", "ke166", "KE166", "h06", "H06", person.id, "assigned", 0, 0), supervisorFillDetached: false },
    assignment("h04-assignment", "ke166", "KE166", "h04", "H04", null, "unfilled", 2, 7),
    assignment("h03-assignment", "ke166", "KE166", "h03", "H03", null, "unfilled", 2, 6),
    assignment("other-h04-assignment", "other", "OTHER", "other-h04", "H04", null, "unfilled", 2, 7)
  ];
  return state;
}

describe("supervisor mobile cover", () => {
  it("uses the linked H06 supervisor-fill token on an empty qualified H04 counter", () => {
    const state = supervisorCoverState();
    const result = assignSupervisorFillToRegularPosition(state, "h06-assignment", "h04-assignment");

    expect(result).toMatchObject({ handled: true, changed: true, message: "张奇已由督导机动补位至 H04" });
    expect(state.assignments.find((item) => item.id === "supervisor-assignment")).toMatchObject({ staffName: "张奇", status: "assigned", workHours: 2 });
    expect(state.assignments.find((item) => item.id === "h06-assignment")).toMatchObject({ staffId: null, staffName: "", status: "manual", supervisorFillDetached: true });
    expect(state.assignments.find((item) => item.id === "h04-assignment")).toMatchObject({
      staffName: "张奇", status: "assigned", workHours: 0, fatiguePoints: 7,
      supervisorCoverSourceAssignmentId: "supervisor-assignment"
    });
    expect(buildScheduleFeedback(state, "2026-07-22").find((item) => item.key === "coverage")?.text)
      .toContain("督导机动补位：张奇兼任KE166/H04");
  });

  it("rejects a target counter for which the supervisor is not qualified", () => {
    const state = supervisorCoverState();
    const snapshot = structuredClone(state.assignments);

    const result = assignSupervisorFillToRegularPosition(state, "h06-assignment", "h03-assignment");

    expect(result).toMatchObject({ handled: true, changed: false, error: "张奇 不具备 H03 岗位资质" });
    expect(state.assignments).toEqual(snapshot);
  });

  it("rejects occupied and cross-flight regular targets", () => {
    const occupied = supervisorCoverState();
    const target = occupied.assignments.find((item) => item.id === "h04-assignment")!;
    target.staffId = occupied.staff[0]!.id;
    target.staffName = occupied.staff[0]!.name;
    target.status = "assigned";
    expect(assignSupervisorFillToRegularPosition(occupied, "h06-assignment", "h04-assignment")).toMatchObject({
      handled: true, changed: false, error: "目标岗位已有人员，请先清空 H04"
    });

    const crossFlight = supervisorCoverState();
    expect(assignSupervisorFillToRegularPosition(crossFlight, "h06-assignment", "other-h04-assignment")).toMatchObject({
      handled: true, changed: false, error: "督导机动补位只能用于同一航班"
    });
  });
});
