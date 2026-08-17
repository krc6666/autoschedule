import { createDefaultState } from "../../src/defaults";
import {
  createScheduleGenerationFacts,
  type ScheduleGenerationFacts,
} from "../../src/domain/shared/scheduling-facts";

export function createSchedulingScenario(
  overrides: Partial<ScheduleGenerationFacts> = {}
): ScheduleGenerationFacts {
  return {
    ...createScheduleGenerationFacts(createDefaultState()),
    ...overrides,
  };
}
