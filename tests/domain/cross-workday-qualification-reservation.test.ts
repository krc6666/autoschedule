import { describe, expect, it } from "vitest";

import { createCrossWorkdayReservationScenario } from "../helpers/scheduling-scenario";
import {
  crossWorkdayReservationStatuses,
  crossWorkdayReservationWarning,
} from "../../src/domain/reviews/cross-workday-qualification-reservation";
import { generateSchedule } from "../helpers/generate-schedule";

describe("cross-workday qualification reservation", () => {
  it("keeps the only next-workday qualified worker away from today's late positions", async () => {
    const state = createCrossWorkdayReservationScenario({
      staffCount: 3,
      latePositionCount: 2,
    });

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
    const state = createCrossWorkdayReservationScenario({
      staffCount: 2,
      latePositionCount: 2,
    });

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
    const state = createCrossWorkdayReservationScenario({
      staffCount: 3,
      latePositionCount: 1,
    });
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
    const state = createCrossWorkdayReservationScenario({
      staffCount: 3,
      latePositionCount: 0,
    });
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
