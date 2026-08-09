import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { AppState, Flight, PositionRule, Staff } from "../../src/model";
import {
  crossWorkdayReservationStatuses,
  crossWorkdayReservationWarning,
} from "../../src/domain/reviews/cross-workday-qualification-reservation";
import { generateSchedule } from "../helpers/generate-schedule";

function reservationState(
  staffCount: number,
  latePositionCount: number
): AppState {
  const state = createDefaultState();
  const baseStaff = state.staff[0]!;
  state.staff = Array.from({ length: staffCount }, (_, index): Staff => ({
    ...baseStaff,
    id: `worker-${index + 1}`,
    name: `人员${index + 1}`,
    staffType: "常规",
    status: "正常",
    nightShift: true,
    dutyQualified: false,
    cxPreflightQualified: false,
  }));
  const lateFlight: Flight = {
    id: "late-flight",
    flightNo: "LATE100",
    startTime: "21:00",
    endTime: "23:30",
    bookedPassengers: 100,
    positions: Array.from(
      { length: latePositionCount },
      (_, index) => `G0${index + 1}`
    ),
    remark: "",
  };
  const nextFlight: Flight = {
    id: "next-flight",
    flightNo: "NEXT200",
    startTime: "08:00",
    endTime: "10:00",
    bookedPassengers: 100,
    positions: ["控制"],
    remark: "",
  };
  const baseRule = state.positionRules[0]!;
  const lateRules = lateFlight.positions.map((name, index): PositionRule => ({
    ...baseRule,
    id: `late-rule-${index + 1}`,
    flightNo: lateFlight.flightNo,
    name,
    category: "常规",
    remark: "",
    qualifiedStaffIds: state.staff.map((person) => person.id),
    manual: false,
    fatiguePoints: 1,
    minPassengers: 0,
    earlyReleaseMinutes: 0,
  }));
  const nextRule: PositionRule = {
    ...lateRules[0]!,
    id: "next-control",
    flightNo: nextFlight.flightNo,
    name: "控制",
    qualifiedStaffIds: [state.staff[0]!.id],
  };
  state.flights = [lateFlight];
  state.templates = [
    {
      id: "next-template",
      flightNo: nextFlight.flightNo,
      startTime: nextFlight.startTime,
      endTime: nextFlight.endTime,
      positions: nextFlight.positions,
      remark: "",
    },
  ];
  state.positionRules = [...lateRules, nextRule];
  state.history = [];
  state.dutyRosterOverrides = [];
  state.settings.positionTransitionPolicies = [];
  state.settings.positionRotationEnabled = false;
  state.settings.workloadBalanceEnabled = false;
  state.settings.crossWorkdayQualificationReservations = [
    {
      id: "reserve-control",
      enabled: true,
      flightNo: nextFlight.flightNo,
      matchField: "position",
      keyword: "控制",
      minimumStaffCount: 1,
    },
  ];
  return state;
}

describe("cross-workday qualification reservation", () => {
  it("keeps the only next-workday qualified worker away from today's late positions", async () => {
    const state = reservationState(3, 2);

    const result = await generateSchedule(state, "2026-08-03");
    const statuses = crossWorkdayReservationStatuses(state, result.assignments);

    expect(
      result.assignments.some(
        (assignment) => assignment.staffId === state.staff[0]!.id
      )
    ).toBe(false);
    expect(statuses[0]).toMatchObject({
      preservedStaffIds: [state.staff[0]!.id],
      shortfall: 0,
    });
  });

  it("keeps today's positions complete and reports a soft reservation shortfall", async () => {
    const state = reservationState(2, 2);

    const result = await generateSchedule(state, "2026-08-03");
    const status = crossWorkdayReservationStatuses(
      state,
      result.assignments
    )[0]!;

    expect(result.unfilledCount).toBe(0);
    expect(status.shortfall).toBe(1);
    expect(result.warnings).toContain(crossWorkdayReservationWarning(status));
  });

  it("uses different people for two overlapping next-workday targets", async () => {
    const state = reservationState(3, 1);
    const nextRule = state.positionRules.find(
      (rule) => rule.id === "next-control"
    )!;
    state.positionRules.push({
      ...nextRule,
      id: "next-number-one",
      name: "一号",
      qualifiedStaffIds: [state.staff[0]!.id, state.staff[1]!.id],
    });
    nextRule.qualifiedStaffIds = [state.staff[0]!.id, state.staff[1]!.id];
    state.settings.crossWorkdayQualificationReservations.push({
      id: "reserve-number-one",
      enabled: true,
      flightNo: "NEXT200",
      matchField: "position",
      keyword: "一号",
      minimumStaffCount: 1,
    });

    const result = await generateSchedule(state, "2026-08-03");
    const statuses = crossWorkdayReservationStatuses(state, result.assignments);

    expect(statuses.map((status) => status.shortfall)).toEqual([0, 0]);
    expect(
      new Set(statuses.flatMap((status) => status.preservedStaffIds)).size
    ).toBe(2);
    expect(result.assignments[0]?.staffId).toBe(state.staff[2]!.id);
  });

  it("does not let a flexible target consume the only person for a later target", () => {
    const state = reservationState(3, 0);
    const nextRule = state.positionRules.find(
      (rule) => rule.id === "next-control"
    )!;
    const flexibleStaffIds = [state.staff[0]!.id, state.staff[1]!.id];
    nextRule.qualifiedStaffIds = flexibleStaffIds;
    state.positionRules.push({
      ...nextRule,
      id: "next-number-one",
      name: "一号",
      qualifiedStaffIds: [state.staff[0]!.id],
    });
    state.settings.crossWorkdayQualificationReservations.push({
      id: "reserve-number-one",
      enabled: true,
      flightNo: "NEXT200",
      matchField: "position",
      keyword: "一号",
      minimumStaffCount: 1,
    });

    const statuses = crossWorkdayReservationStatuses(state, []);

    expect(statuses.map((status) => status.shortfall)).toEqual([0, 0]);
    expect(statuses[0]!.preservedStaffIds).toEqual([state.staff[1]!.id]);
    expect(statuses[1]!.preservedStaffIds).toEqual([state.staff[0]!.id]);
  });
});
