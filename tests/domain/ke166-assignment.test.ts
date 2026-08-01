import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { assignKe166SupervisorByCounterCoverage } from "../../src/domain/assignments/ke166-assignment";
import { defaultHighsSolver } from "../../src/infrastructure/solver/highs-solver";
import type { Assignment, Flight, PositionRule } from "../../src/model";

describe("KE166 mobile-supervisor counter coverage", () => {
  it("uses the complete qualified open chain instead of imposing a participant limit", async () => {
    const state = createDefaultState();
    const staff = state.staff.slice(0, 7).map((person, index) => ({
      ...person,
      id: `staff-${index}`,
      name: `人员${index + 1}`,
      staffType: "常规" as const,
      status: "正常" as const,
      dutyQualified: false,
    }));
    state.staff = staff;
    state.history = [];
    state.assignments = [];

    const flights: Flight[] = Array.from({ length: 6 }, (_, index) => ({
      id: index === 0 ? "ke166" : `flight-${index}`,
      flightNo: index === 0 ? "KE166" : `F${index}`,
      startTime: "08:00",
      endTime: "10:00",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    }));
    state.flights = flights;

    const baseRule = state.positionRules[0]!;
    const supervisorRule: PositionRule = {
      ...baseRule,
      id: "ke166-supervisor",
      flightNo: "KE166",
      name: "督导",
      category: "机动督导",
      remark: "",
      qualifiedStaffIds: [staff[1]!.id],
    };
    const counterRules: PositionRule[] = flights.map((flight, index) => ({
      ...baseRule,
      id: `counter-${index}`,
      flightNo: flight.flightNo,
      name: index === 0 ? "H03" : `G${index}`,
      category: "常规",
      remark: "",
      qualifiedStaffIds: [staff[index]!.id, staff[index + 1]!.id],
    }));
    state.positionRules = [supervisorRule, ...counterRules];

    const assignments: Assignment[] = counterRules.map((rule, index) => ({
      id: `assignment-${index}`,
      flightId: flights[index]!.id,
      flightNo: flights[index]!.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: staff[index]!.id,
      staffName: staff[index]!.name,
      startTime: "08:00",
      endTime: "10:00",
      workHours: 2,
      fatiguePoints: 1,
      remark: "",
      manualRemark: "",
      status: "assigned",
    }));

    const supervisor = await assignKe166SupervisorByCounterCoverage(
      defaultHighsSolver,
      state,
      assignments,
      flights[0]!,
      supervisorRule,
      "2026-08-01"
    );

    expect(supervisor?.staffId).toBe(staff[1]!.id);
    expect(assignments.map((assignment) => assignment.staffId)).toEqual(
      staff.slice(1).map((person) => person.id)
    );
    expect(
      new Set(assignments.map((assignment) => assignment.staffId)).size
    ).toBe(assignments.length);
  });
});
