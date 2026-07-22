import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { AppState, Assignment } from "../model";
import { moveSupervisorWithinFlight, normalizeSupervisorFillAssignments } from "./schedule-adjustment";

function supervisorMoveState(): AppState {
  const state = createDefaultState();
  const [first, second, regular] = state.staff;
  state.staff = [first!, second!, regular!];
  state.flights = [
    { id: "f1", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
    { id: "f2", flightNo: "F2", startTime: "11:00", endTime: "13:00", bookedPassengers: 100, positions: [], remark: "" }
  ];
  const base = state.positionRules[0]!;
  state.positionRules = [
    { ...base, id: "supervisor", flightNo: "F1", name: "督导", category: "常规", qualifiedStaffIds: [first!.id, second!.id] },
    { ...base, id: "supervisor-fill", flightNo: "F1", name: "G16", category: "督导补位", qualifiedStaffIds: [] },
    { ...base, id: "regular", flightNo: "F1", name: "G15", category: "常规", qualifiedStaffIds: [regular!.id] },
    { ...base, id: "other-flight-fill", flightNo: "F2", name: "H06", category: "督导补位", qualifiedStaffIds: [] }
  ];
  const assignment = (
    id: string,
    flightId: string,
    flightNo: string,
    ruleId: string,
    position: string,
    staffId: string | null,
    staffName: string,
    status: Assignment["status"]
  ): Assignment => ({
    id, flightId, flightNo, positionRuleId: ruleId, position, staffId, staffName,
    startTime: flightId === "f1" ? "08:00" : "11:00", endTime: flightId === "f1" ? "10:00" : "13:00",
    workHours: 2, fatiguePoints: 2, remark: "", manualRemark: "", status
  });
  state.assignments = [
    assignment("source", "f1", "F1", "supervisor", "督导", first!.id, first!.name, "assigned"),
    assignment("target", "f1", "F1", "supervisor-fill", "G16", null, "", "manual"),
    assignment("regular-assignment", "f1", "F1", "regular", "G15", regular!.id, regular!.name, "assigned"),
    assignment("other-flight", "f2", "F2", "other-flight-fill", "H06", second!.id, second!.name, "assigned")
  ];
  return state;
}

describe("same-flight supervisor movement", () => {
  it("moves a supervisor into an empty supervisor-fill slot and leaves the source empty", () => {
    const state = supervisorMoveState();
    const person = state.staff[0]!;

    expect(moveSupervisorWithinFlight(state, "source", "target")).toBeNull();

    expect(state.assignments.find((item) => item.id === "target")).toMatchObject({ staffId: person.id, staffName: person.name, status: "assigned", supervisorFillDetached: true });
    expect(state.assignments.find((item) => item.id === "source")).toMatchObject({ staffId: null, staffName: "", status: "unfilled" });
  });

  it("swaps two occupied supervisor slots in the same flight", () => {
    const state = supervisorMoveState();
    const [first, second] = state.staff;
    const target = state.assignments.find((item) => item.id === "target")!;
    target.staffId = second!.id;
    target.staffName = second!.name;
    target.status = "assigned";

    expect(moveSupervisorWithinFlight(state, "source", "target")).toBeNull();

    expect(state.assignments.find((item) => item.id === "source")).toMatchObject({ staffId: second!.id, staffName: second!.name, status: "assigned" });
    expect(state.assignments.find((item) => item.id === "target")).toMatchObject({ staffId: first!.id, staffName: first!.name, status: "assigned", supervisorFillDetached: true });
  });

  it("treats dragging between linked duplicate supervisor slots as a move", () => {
    const state = supervisorMoveState();
    const source = state.assignments.find((item) => item.id === "source")!;
    const target = state.assignments.find((item) => item.id === "target")!;
    target.staffId = source.staffId;
    target.staffName = source.staffName;
    target.status = "assigned";
    target.workHours = 0;
    target.fatiguePoints = 0;
    target.supervisorFillDetached = false;

    expect(moveSupervisorWithinFlight(state, "source", "target")).toBeNull();

    expect(source).toMatchObject({ staffId: null, staffName: "", status: "unfilled" });
    expect(target).toMatchObject({ staffId: state.staff[0]!.id, status: "assigned", supervisorFillDetached: true, workHours: 2 });
  });

  it("syncs untouched fill slots but preserves manually detached slots", () => {
    const state = supervisorMoveState();
    const supervisor = state.assignments.find((item) => item.id === "source")!;
    const fill = state.assignments.find((item) => item.id === "target")!;

    normalizeSupervisorFillAssignments(state);
    expect(fill).toMatchObject({ staffId: supervisor.staffId, staffName: supervisor.staffName, workHours: 0, fatiguePoints: 0, supervisorFillDetached: false });

    fill.staffId = null;
    fill.staffName = "";
    fill.status = "manual";
    fill.supervisorFillDetached = true;
    normalizeSupervisorFillAssignments(state);
    expect(fill).toMatchObject({ staffId: null, staffName: "", status: "manual", supervisorFillDetached: true });
  });

  it("rejects ordinary positions and cross-flight supervisor movement", () => {
    const state = supervisorMoveState();
    const snapshot = structuredClone(state.assignments);

    expect(moveSupervisorWithinFlight(state, "source", "regular-assignment")).toContain("督导岗位");
    expect(moveSupervisorWithinFlight(state, "source", "other-flight")).toContain("同一航班");
    expect(state.assignments).toEqual(snapshot);
  });
});
