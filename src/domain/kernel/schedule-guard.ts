import type { Assignment } from "../../model";
import {
  halfRestMinimumWorkViolation,
  halfRestPeriodViolation,
  type HalfRestFacts,
} from "../rules/half-rest";

/**
 * The phase controls which invariants are meaningful for a partial result.
 * Automatic post-stage proposals may leave vacancies, but they may not
 * introduce a hard-constraint violation. Final results additionally enforce
 * minimum-work invariants owned by the corresponding rule module.
 */
export type ScheduleGuardPhase = "partial" | "final";

export interface ScheduleGuardContext {
  phase: ScheduleGuardPhase;
  /** Facts are supplied by the run boundary; rules remain the fact owners. */
  halfRestFacts?: HalfRestFacts;
}

export interface ScheduleGuardViolation {
  readonly ruleId: string;
  readonly assignmentId?: string;
  readonly message: string;
}

export interface ScheduleGuard {
  readonly id: string;
  validate(
    assignments: readonly Assignment[],
    context: ScheduleGuardContext
  ): readonly ScheduleGuardViolation[];
}

export class ScheduleGuardError extends Error {
  constructor(readonly violations: readonly ScheduleGuardViolation[]) {
    super(
      violations.length
        ? violations.map((violation) => violation.message).join("；")
        : "排班结果未通过统一安全守卫"
    );
    this.name = "ScheduleGuardError";
  }
}

/**
 * Composes independent rule-owned guards behind one proposal boundary.
 * Callers must pass the complete candidate snapshot they intend to commit;
 * this function never mutates that snapshot.
 */
export function assertScheduleAssignmentsSafe(options: {
  assignments: readonly Assignment[];
  context: ScheduleGuardContext;
  guards: readonly ScheduleGuard[];
}): void {
  const violations = options.guards.flatMap((guard) =>
    guard.validate(options.assignments, options.context)
  );
  if (violations.length) throw new ScheduleGuardError(violations);
}

/**
 * Adapter for the half-rest rule. The rule's facts and predicates stay in
 * half-rest.ts; every other pipeline stage only consumes this guard contract.
 */
export function createHalfRestScheduleGuard(): ScheduleGuard {
  return Object.freeze({
    id: "half-rest",
    validate: (
      assignments: readonly Assignment[],
      context: ScheduleGuardContext
    ): readonly ScheduleGuardViolation[] => {
      const facts = context.halfRestFacts;
      if (!facts) return [];

      const violations: ScheduleGuardViolation[] = [];
      for (const assignment of assignments) {
        // Manual adjustments are intentionally outside the first automatic
        // guard boundary. They retain the existing manual-override flow.
        if (assignment.status !== "assigned" || !assignment.staffId) continue;
        const message = halfRestPeriodViolation({
          facts,
          staffId: assignment.staffId,
          startTime: assignment.startTime,
        });
        if (message) {
          violations.push({
            ruleId: "half-rest",
            assignmentId: assignment.id,
            message,
          });
        }
      }

      if (context.phase === "final") {
        violations.push(
          ...halfRestMinimumWorkViolation({ assignments, facts }).map(
            (message) => ({ ruleId: "half-rest", message })
          )
        );
      }
      return violations;
    },
  });
}

export function createDefaultScheduleGuards(): readonly ScheduleGuard[] {
  return Object.freeze([createHalfRestScheduleGuard()]);
}
