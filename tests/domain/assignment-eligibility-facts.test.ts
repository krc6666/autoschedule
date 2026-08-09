import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { Assignment } from "../../src/model";
import {
  assignmentLoadFacts,
  staffAssignmentFacts,
} from "../../src/domain/candidates/assignment-eligibility-facts";

describe("assignment eligibility facts", () => {
  it("reports staff facts without deciding an automatic or manual workflow", () => {
    const state = createDefaultState();
    const flight = {
      ...state.flights[0]!,
      startTime: "22:00",
      endTime: "23:00",
    };
    const person = {
      ...state.staff[0]!,
      id: "administrative-sick",
      staffType: "行政支援" as const,
      status: "病假" as const,
      nightShift: false,
    };
    const rule = {
      ...state.positionRules[0]!,
      qualifiedStaffIds: [],
    };

    expect(staffAssignmentFacts(state, flight, rule, person)).toEqual({
      available: false,
      regularStaff: false,
      positionQualified: false,
      nightAssignment: true,
      nightCapable: false,
    });
  });

  it("reports blocking conflicts and projected hours from the same workload facts", () => {
    const state = createDefaultState();
    const person = { ...state.staff[0]!, id: "worker" };
    const flight = {
      ...state.flights[0]!,
      id: "target-flight",
      flightNo: "TARGET",
      startTime: "10:00",
      endTime: "12:00",
    };
    const rule = {
      ...state.positionRules[0]!,
      id: "target-rule",
      flightNo: flight.flightNo,
      qualifiedStaffIds: [person.id],
    };
    const guideRule = {
      ...rule,
      id: "guide-rule",
      name: "引导",
      category: "引导" as const,
    };
    const reusable: Assignment = {
      id: "same-flight-guide",
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: guideRule.id,
      position: guideRule.name,
      staffId: person.id,
      staffName: person.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      workHours: 0,
      fatiguePoints: 0,
      remark: "",
      manualRemark: "",
      status: "assigned",
    };
    const blocking: Assignment = {
      ...reusable,
      id: "other-flight",
      flightId: "other-flight",
      flightNo: "OTHER",
      positionRuleId: null,
      position: "G01",
      startTime: "11:00",
      endTime: "18:00",
      workHours: 7,
    };
    state.staff = [person];
    state.flights = [flight];
    state.positionRules = [rule, guideRule];
    state.settings.maxDailyHours = 8;

    const facts = assignmentLoadFacts({
      state,
      assignments: [reusable, blocking],
      flight,
      person,
      workHours: 2,
      sameFlightConflict: "allow-reusable",
    });

    expect(facts.blockingConflicts.map((item) => item.id)).toEqual([
      blocking.id,
    ]);
    expect(facts.projectedHours).toBe(9);
    expect(facts.withinDailyHours).toBe(false);
  });
});
