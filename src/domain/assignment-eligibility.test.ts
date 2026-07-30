import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { Assignment, Staff } from "../model";
import {
  analyzeAutomaticEligibilityPool,
  diagnoseAutomaticAssignmentEligibility,
  diagnoseManualAssignmentEligibility,
  eligibleStaffForRule,
} from "./assignment-eligibility";

describe("assignment eligibility diagnostics", () => {
  it("uses one staged diagnosis for filtering and shortage evidence", () => {
    const state = createDefaultState();
    const flight = state.flights.find((item) => item.flightNo === "TR121")!;
    const rule = state.positionRules.find(
      (item) => item.flightNo === "TR121" && item.name === "H02"
    )!;
    const base = state.staff[0]!;
    const staff = (id: string, overrides: Partial<Staff> = {}): Staff => ({
      ...base,
      id,
      name: id,
      status: "正常",
      staffType: "常规",
      nightShift: true,
      ...overrides,
    });
    const absent = staff("absent", { status: "休假" });
    const noNight = staff("no-night", { nightShift: false });
    const conflicted = staff("conflicted");
    const overHours = staff("over-hours");
    const available = staff("available");
    state.staff = [absent, noNight, conflicted, overHours, available];
    rule.qualifiedStaffIds = state.staff.map((person) => person.id);
    state.settings.maxDailyHours = 8;
    const assignments: Assignment[] = [
      {
        id: "conflict",
        flightId: "other-night",
        flightNo: "F200",
        positionRuleId: null,
        position: "G01",
        staffId: conflicted.id,
        staffName: conflicted.name,
        startTime: "22:30",
        endTime: "23:30",
        workHours: 1,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
      {
        id: "hours",
        flightId: "other-day",
        flightNo: "F300",
        positionRuleId: null,
        position: "G02",
        staffId: overHours.id,
        staffName: overHours.name,
        startTime: "08:00",
        endTime: "16:00",
        workHours: 8,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
    ];

    const pool = analyzeAutomaticEligibilityPool({
      state,
      assignments,
      flight,
      rule,
    });

    expect(pool.configured).toHaveLength(5);
    expect(pool.available).toHaveLength(4);
    expect(pool.nightCapable).toHaveLength(3);
    expect(pool.conflictFree).toHaveLength(2);
    expect(pool.withinHours.map((person) => person.id)).toEqual([available.id]);
    expect(
      diagnoseAutomaticAssignmentEligibility({
        state,
        assignments,
        flight,
        rule,
        person: conflicted,
      }).violations.map((violation) => violation.code)
    ).toContain("time-conflict");
  });

  it("keeps the base qualification pool independent from current assignments and work-hour capacity", () => {
    const state = createDefaultState();
    const person = state.staff.find(
      (item) => item.status === "正常" && item.nightShift
    )!;
    const flight = {
      ...state.flights[0]!,
      startTime: "08:00",
      endTime: "21:00",
    };
    const rule = {
      ...state.positionRules[0]!,
      flightNo: flight.flightNo,
      qualifiedStaffIds: [person.id],
    };
    state.staff = [person];
    state.settings.maxDailyHours = 8;

    expect(eligibleStaffForRule(state, flight, rule)).toEqual([person]);
    expect(
      analyzeAutomaticEligibilityPool({ state, assignments: [], flight, rule })
        .withinHours
    ).toEqual([]);
  });

  it("keeps manual administrative fallback based on the target's preceding transition only", () => {
    const state = createDefaultState();
    const regular = {
      ...state.staff[0]!,
      id: "regular",
      name: "常规人员",
      staffType: "常规" as const,
    };
    const administrative = {
      ...state.staff[1]!,
      id: "administrative",
      name: "行政人员",
      staffType: "行政支援" as const,
    };
    const targetFlight = {
      ...state.flights[0]!,
      id: "target-flight",
      flightNo: "TARGET",
      startTime: "10:00",
      endTime: "11:00",
    };
    const futureFlight = {
      ...state.flights[0]!,
      id: "future-flight",
      flightNo: "FUTURE",
      startTime: "11:30",
      endTime: "12:30",
    };
    const targetRule = {
      ...state.positionRules[0]!,
      id: "target-rule",
      flightNo: targetFlight.flightNo,
      name: "MID",
      qualifiedStaffIds: [regular.id, administrative.id],
    };
    const futureRule = {
      ...state.positionRules[0]!,
      id: "future-rule",
      flightNo: futureFlight.flightNo,
      name: "LATE",
      qualifiedStaffIds: [regular.id],
    };
    const targetAssignment: Assignment = {
      id: "target-assignment",
      flightId: targetFlight.id,
      flightNo: targetFlight.flightNo,
      positionRuleId: targetRule.id,
      position: targetRule.name,
      staffId: null,
      staffName: "",
      startTime: targetFlight.startTime,
      endTime: targetFlight.endTime,
      workHours: 1,
      fatiguePoints: 1,
      remark: "",
      manualRemark: "",
      status: "unfilled",
    };
    const futureAssignment: Assignment = {
      ...targetAssignment,
      id: "future-assignment",
      flightId: futureFlight.id,
      flightNo: futureFlight.flightNo,
      positionRuleId: futureRule.id,
      position: futureRule.name,
      staffId: regular.id,
      staffName: regular.name,
      startTime: futureFlight.startTime,
      endTime: futureFlight.endTime,
      status: "assigned",
    };
    state.settings.adminSupportEnabled = true;
    state.settings.positionTransitionPolicies = [
      {
        id: "target-before-future",
        name: "目标岗位到未来岗位的衔接",
        enabled: true,
        sourceFlightNo: targetFlight.flightNo,
        sourcePositions: [targetRule.name],
        targetFlightNo: futureFlight.flightNo,
        targetPosition: futureRule.name,
        minimumGapMinutes: 60,
        mode: "forbid",
      },
    ];
    state.staff = [regular, administrative];
    state.flights = [targetFlight, futureFlight];
    state.positionRules = [targetRule, futureRule];
    state.assignments = [targetAssignment, futureAssignment];

    expect(
      diagnoseAutomaticAssignmentEligibility({
        state,
        assignments: [futureAssignment],
        flight: targetFlight,
        rule: targetRule,
        person: regular,
        workHours: targetAssignment.workHours,
        transitionMode: "forbid",
      }).violations[0]?.code
    ).toBe("position-transition");
    expect(
      diagnoseManualAssignmentEligibility(
        state,
        targetAssignment.id,
        administrative.id
      ).violations[0]?.code
    ).toBe("regular-staff-priority");
  });
});
