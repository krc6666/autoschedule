import type { Assignment } from "../../src/model";
import {
  assertScheduleAssignmentsSafe,
  createDefaultScheduleGuards,
  type ScheduleGuard,
  type ScheduleGuardContext,
} from "../../src/domain/kernel/schedule-guard";
import type { ScheduleSafetyVerifier } from "../../src/domain/kernel/schedule-ledger";

export function createScheduleSafetyVerifier(
  context: ScheduleGuardContext,
  guards: readonly ScheduleGuard[] = createDefaultScheduleGuards()
): ScheduleSafetyVerifier {
  return {
    assertAssignmentsSafe(assignments: readonly Assignment[]): void {
      assertScheduleAssignmentsSafe({ assignments, context, guards });
    },
  };
}
