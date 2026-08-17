import type { ScheduleGenerationFacts } from "../../src/domain/shared/scheduling-facts";
import {
  generateSchedule as runSchedulingKernel,
  type GenerateScheduleOptions,
} from "../../src/domain/kernel/scheduling-kernel";
import { defaultHighsSolver } from "../../src/infrastructure/solver/highs-solver";

type TestScheduleOptions = Omit<GenerateScheduleOptions, "solver">;

export function generateSchedule(
  state: ScheduleGenerationFacts,
  date: string,
  options: TestScheduleOptions = {}
) {
  return runSchedulingKernel(state, date, {
    ...options,
    solver: defaultHighsSolver,
  });
}
