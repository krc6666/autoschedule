import type { AppState } from "../../src/model";
import {
  generateSchedule as runSchedulingKernel,
  type GenerateScheduleOptions,
} from "../../src/domain/kernel/scheduling-kernel";
import { defaultHighsSolver } from "../../src/infrastructure/solver/highs-solver";

type TestScheduleOptions = Omit<GenerateScheduleOptions, "solver">;

export function generateSchedule(
  state: AppState,
  date: string,
  options: TestScheduleOptions = {}
) {
  return runSchedulingKernel(state, date, {
    ...options,
    solver: defaultHighsSolver,
  });
}
