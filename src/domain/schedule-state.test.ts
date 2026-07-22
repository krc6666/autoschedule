import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { AppState, StaffStatus } from "../model";
import { applyStaffStatusChange } from "./schedule-state";
import { generateSchedule } from "./scheduler";

function scheduledSingleWorkerState(initialStatus: StaffStatus = "正常"): AppState {
  const state = createDefaultState();
  const person = state.staff[0]!;
  person.status = initialStatus;
  person.dutyQualified = false;
  state.staff = [person];
  state.flights = [{ id: "flight", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
  const base = state.positionRules[0]!;
  state.positionRules = [{ ...base, id: "position", flightNo: "F1", name: "G01", category: "常规", qualifiedStaffIds: [person.id] }];
  state.activeScheduleDate = "2026-07-20";
  state.assignments = generateSchedule(state, state.activeScheduleDate).assignments;
  return state;
}

describe("staff status schedule lifecycle", () => {
  it("removes a worker from the active schedule immediately after changing to leave", () => {
    const state = scheduledSingleWorkerState();
    const person = state.staff[0]!;
    expect(state.assignments.some((assignment) => assignment.staffId === person.id)).toBe(true);

    applyStaffStatusChange(state, person.id, "休假");

    expect(person.status).toBe("休假");
    expect(state.assignments.some((assignment) => assignment.staffId === person.id || assignment.staffName === person.name)).toBe(false);
  });

  it("removes a worker from the active schedule immediately after changing to sick leave", () => {
    const state = scheduledSingleWorkerState();
    const person = state.staff[0]!;
    state.history = [{
      id: "old-work", date: "2026-07-18", flightNo: "F1", position: "G01", staffId: person.id, staffName: person.name,
      startTime: "13:00", endTime: "15:00", workHours: 2, fatiguePoints: 1, remark: ""
    }];

    applyStaffStatusChange(state, person.id, "病假");

    expect(person.status).toBe("病假");
    expect(state.assignments.some((assignment) => assignment.staffId === person.id || assignment.staffName === person.name)).toBe(false);
  });

  it("allows a worker to be scheduled again after returning to normal", () => {
    const state = scheduledSingleWorkerState("休假");
    const person = state.staff[0]!;
    expect(state.assignments.some((assignment) => assignment.staffId === person.id)).toBe(false);

    applyStaffStatusChange(state, person.id, "正常");

    expect(person.status).toBe("正常");
    expect(state.assignments.some((assignment) => assignment.staffId === person.id)).toBe(true);
  });
});
