import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { diagnoseBaseAssignmentEligibility } from "../../src/domain/candidates/assignment-eligibility";
import {
  createScheduleGenerationFacts,
  createSchedulingFacts,
  type AssignmentEligibilityFacts,
} from "../../src/domain/shared/scheduling-facts";
import { createSchedulingScenario } from "../helpers/scheduling-scenario";

describe("scheduling facts projection", () => {
  it("accepts only the facts needed by base eligibility", () => {
    const state: AssignmentEligibilityFacts = createSchedulingScenario({
      assignments: [],
    });
    const person = state.staff[0]!;
    const flight = state.flights[0]!;
    const rule = state.positionRules.find(
      (item) => item.flightNo === flight.flightNo
    )!;

    expect(
      diagnoseBaseAssignmentEligibility(state, flight, rule, person).eligible
    ).toBe(true);
  });

  it("projects application state without lifecycle and weekly-plan fields", () => {
    const appState = createDefaultState();
    const generationFacts = createScheduleGenerationFacts(appState);
    const facts = createSchedulingFacts(appState);

    expect(generationFacts).toMatchObject({
      staff: appState.staff,
      flights: appState.flights,
      positionRules: appState.positionRules,
      settings: appState.settings,
    });
    expect(generationFacts).not.toHaveProperty("version");
    expect(generationFacts).not.toHaveProperty("weeklyFlightPlans");
    expect(generationFacts).not.toHaveProperty("activeScheduleDate");
    expect(generationFacts).not.toHaveProperty("schedulePolicyStale");
    expect(facts.activeScheduleDate).toBe(appState.activeScheduleDate);
  });
});
