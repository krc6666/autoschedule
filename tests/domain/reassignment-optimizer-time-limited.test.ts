import { describe, expect, it } from "vitest";

import { optimizeReassignment } from "../../src/domain/solver/reassignment-optimizer";
import type { ReassignmentIntent } from "../../src/domain/solver/reassignment-intent";
import type { SolverPort } from "../../src/domain/solver/solver-port";
import { createReassignmentScenario } from "../helpers/scheduling-scenario";

const REASSIGNMENT_INTENTS: readonly ReassignmentIntent[] = [
  { kind: "mobile-supervisor-counter-coverage" },
  { kind: "team-leader-concurrent-gap-fill" },
  { kind: "late-priority-frequency-review" },
  { kind: "ke166-rotation-review" },
  { kind: "consecutive-rotation-review" },
  { kind: "late-shift-recovery-review" },
  { kind: "position-frequency-review" },
  { kind: "manual-swap-analysis" },
  { kind: "next-workday-cutoff-recovery" },
  {
    kind: "team-leader-gap-fill",
    crossWorkdayReservation: "preserve",
  },
  {
    kind: "team-leader-gap-fill",
    crossWorkdayReservation: "yield-to-selected-vacancy",
  },
];

const timeLimitedFeasibleSolver: SolverPort = {
  async solve() {
    return {
      termination: "time-limited-feasible" as const,
      selectedVariableIds: new Set(["0"]),
      objectiveValues: new Map(),
    };
  },
};

describe("reassignment optimizer time-limited feasible opt-in", () => {
  it("does not adopt a time-limited feasible result by default", async () => {
    const { state, primary, replacementWorker } = createReassignmentScenario();
    const result = await optimizeReassignment({
      solver: timeLimitedFeasibleSolver,
      state,
      assignments: [primary],
      primary,
      movableAssignments: [],
      date: "2026-09-18",
      review: "mobile-supervisor",
      intent: { kind: "mobile-supervisor-counter-coverage" },
      primaryCandidateAllowed: (person) => person.id === replacementWorker.id,
    });

    expect(result.changes).toBeNull();
  });

  it("adopts a time-limited feasible result only when explicitly enabled", async () => {
    const { state, primary, replacementWorker } = createReassignmentScenario();
    const result = await optimizeReassignment({
      solver: timeLimitedFeasibleSolver,
      state,
      assignments: [primary],
      primary,
      movableAssignments: [],
      date: "2026-09-18",
      review: "mobile-supervisor",
      intent: { kind: "mobile-supervisor-counter-coverage" },
      primaryCandidateAllowed: (person) => person.id === replacementWorker.id,
      acceptTimeLimitedFeasible: true,
    });

    expect(result.termination).toBe("time-limited-feasible");
    expect(result.changes).toEqual([
      expect.objectContaining({
        assignmentId: primary.id,
        staffId: replacementWorker.id,
      }),
    ]);
  });

  it("still rejects a time-limited feasible result that fails safety review", async () => {
    const { state, primary, replacementWorker } = createReassignmentScenario();
    const result = await optimizeReassignment({
      solver: timeLimitedFeasibleSolver,
      state,
      assignments: [primary],
      primary,
      movableAssignments: [],
      date: "2026-09-18",
      review: "mobile-supervisor",
      intent: { kind: "mobile-supervisor-counter-coverage" },
      primaryCandidateAllowed: (person) => person.id === replacementWorker.id,
      acceptTimeLimitedFeasible: true,
      validateChanges: () => ["安全复核拒绝"],
      timeoutMs: 1,
    });

    expect(result.changes).toBeNull();
  });

  it.each(REASSIGNMENT_INTENTS)(
    "does not let intent %j bypass position qualification",
    async (intent) => {
      const { state, primary, assignedWorker, replacementWorker, rule } =
        createReassignmentScenario();
      rule.qualifiedStaffIds = [assignedWorker.id];

      const result = await optimizeReassignment({
        solver: timeLimitedFeasibleSolver,
        state,
        assignments: [primary],
        primary,
        movableAssignments: [],
        date: "2026-09-18",
        review: "coverage",
        intent,
        primaryCandidateAllowed: (person) => person.id === replacementWorker.id,
        acceptTimeLimitedFeasible: true,
      });

      expect(result.changes).toBeNull();
    }
  );
});
