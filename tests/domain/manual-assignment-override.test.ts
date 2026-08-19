import { describe, expect, it } from "vitest";

import type {
  AppState,
  Assignment,
  PositionRule,
  Staff,
} from "../../src/model";
import { createDefaultState } from "../../src/defaults";
import { diagnoseAutomaticAssignmentEligibility } from "../../src/domain/candidates/assignment-eligibility";
import { evaluateManualAssignment } from "../../src/domain/candidates/manual-assignment-override";

function fixture(): {
  state: AppState;
  person: Staff;
  target: Assignment;
  targetRule: PositionRule;
} {
  const state = createDefaultState();
  const person: Staff = {
    ...state.staff[0]!,
    id: "worker-a",
    name: "人员A",
    status: "正常",
    staffType: "常规",
    nightShift: true,
  };
  const sourceFlight = {
    ...state.flights[0]!,
    id: "source-flight",
    flightNo: "SOURCE",
    startTime: "08:00",
    endTime: "10:00",
  };
  const targetFlight = {
    ...state.flights[0]!,
    id: "target-flight",
    flightNo: "TARGET",
    startTime: "09:30",
    endTime: "11:30",
  };
  const sourceRule: PositionRule = {
    ...state.positionRules[0]!,
    id: "source-rule",
    flightNo: sourceFlight.flightNo,
    name: "G01",
    category: "常规",
    qualifiedStaffIds: [person.id],
    earlyReleaseMinutes: 0,
  };
  const targetRule: PositionRule = {
    ...sourceRule,
    id: "target-rule",
    flightNo: targetFlight.flightNo,
    name: "H01",
    qualifiedStaffIds: [],
  };
  const source: Assignment = {
    id: "source-assignment",
    flightId: sourceFlight.id,
    flightNo: sourceFlight.flightNo,
    positionRuleId: sourceRule.id,
    position: sourceRule.name,
    staffId: person.id,
    staffName: person.name,
    startTime: sourceFlight.startTime,
    endTime: sourceFlight.endTime,
    workHours: 7,
    fatiguePoints: 1,
    remark: "",
    manualRemark: "",
    status: "assigned",
  };
  const target: Assignment = {
    ...source,
    id: "target-assignment",
    flightId: targetFlight.id,
    flightNo: targetFlight.flightNo,
    positionRuleId: targetRule.id,
    position: targetRule.name,
    staffId: null,
    staffName: "",
    startTime: targetFlight.startTime,
    endTime: targetFlight.endTime,
    workHours: 2,
    status: "unfilled",
  };
  state.staff = [person];
  state.flights = [sourceFlight, targetFlight];
  state.positionRules = [sourceRule, targetRule];
  state.assignments = [source, target];
  state.settings.maxDailyHours = 8;
  state.settings.minimumRegularTransitionMinutes = 90;
  state.settings.positionTransitionPolicies = [
    {
      id: "strict-transition",
      name: "严格衔接",
      enabled: true,
      mode: "forbid",
      sourceFlightNo: sourceFlight.flightNo,
      sourcePositions: [sourceRule.name],
      targetFlightNo: targetFlight.flightNo,
      targetPosition: targetRule.name,
      minimumGapMinutes: 180,
    },
  ];
  return { state, person, target, targetRule };
}

describe("manual assignment override policy", () => {
  it("turns qualification, overlap, work-hour and both transition violations into warnings", () => {
    const { state, person, target } = fixture();

    const result = evaluateManualAssignment(state, target.id, person.id);

    expect(result.blockers).toEqual([]);
    expect(result.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "position-qualification",
        "time-conflict",
        "daily-hours",
      ])
    );
    expect(result.allowed).toBe(true);
  });

  it("turns a configured strict position transition into a warning", () => {
    const { state, person, target, targetRule } = fixture();
    targetRule.qualifiedStaffIds = [person.id];
    state.assignments[0]!.workHours = 2;
    state.settings.maxDailyHours = 12;
    state.settings.minimumRegularTransitionMinutes = 0;
    state.flights[1]!.startTime = target.startTime = "10:30";
    state.flights[1]!.endTime = target.endTime = "12:30";

    const result = evaluateManualAssignment(state, target.id, person.id);

    expect(result.blockers).toEqual([]);
    expect(result.warnings.map((item) => item.code)).toEqual([
      "position-transition",
    ]);
  });

  it("keeps unavailable status and missing night capability as blockers", () => {
    const { state, person, target } = fixture();
    person.status = "休假";
    expect(
      evaluateManualAssignment(state, target.id, person.id).blockers.map(
        (item) => item.code
      )
    ).toContain("staff-unavailable");

    person.status = "正常";
    person.nightShift = false;
    state.flights[1]!.startTime = target.startTime = "22:00";
    state.flights[1]!.endTime = target.endTime = "23:30";
    expect(
      evaluateManualAssignment(state, target.id, person.id).blockers.map(
        (item) => item.code
      )
    ).toContain("night-shift");
  });

  it("does not relax the automatic assignment eligibility contract", () => {
    const { state, person, target, targetRule } = fixture();
    const flight = state.flights.find((item) => item.id === target.flightId)!;

    expect(
      diagnoseAutomaticAssignmentEligibility({
        state,
        assignments: state.assignments.filter((item) => item.id !== target.id),
        flight,
        rule: targetRule,
        person,
        workHours: target.workHours,
        transitionMode: "forbid",
      }).eligible
    ).toBe(false);
  });

  it("warns instead of blocking when only the global flight gap is insufficient", () => {
    const { state, person, target, targetRule } = fixture();
    targetRule.qualifiedStaffIds = [person.id];
    state.assignments[0]!.workHours = 2;
    state.settings.maxDailyHours = 12;
    state.settings.positionTransitionPolicies = [];
    state.flights[1]!.startTime = target.startTime = "11:29";
    state.flights[1]!.endTime = target.endTime = "12:29";

    const result = evaluateManualAssignment(state, target.id, person.id);

    expect(result.blockers).toEqual([]);
    expect(result.warnings.map((item) => item.code)).toEqual([
      "minimum-flight-transition",
    ]);
  });
});
