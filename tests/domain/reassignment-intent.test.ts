import { describe, expect, it } from "vitest";

import {
  reassignmentIntentPolicy,
  type ReassignmentIntent,
  type ReassignmentIntentPolicy,
} from "../../src/domain/solver/reassignment-intent";

const STRICT_POLICY: ReassignmentIntentPolicy = {
  allowWorkloadBalanceRegression: false,
  allowCutoffProtectionRegression: false,
  allowCrossWorkdayRecoveryRegression: false,
  allowCrossWorkdayReservationRegression: false,
  allowLoadProtectionRegression: false,
  allowDirectGuideReassignment: false,
};

const STRICT_INTENTS: readonly ReassignmentIntent[] = [
  { kind: "mobile-supervisor-counter-coverage" },
  { kind: "team-leader-concurrent-gap-fill" },
  { kind: "late-priority-frequency-review" },
  { kind: "ke166-rotation-review" },
  { kind: "consecutive-rotation-review" },
  { kind: "late-shift-recovery-review" },
  { kind: "position-frequency-review" },
  { kind: "manual-swap-analysis" },
];

describe("reassignment intent policy", () => {
  it.each(STRICT_INTENTS)("keeps %j strict", (intent) => {
    expect(reassignmentIntentPolicy(intent)).toEqual(STRICT_POLICY);
  });

  it("only yields workload balance and cutoff protection for next-workday cutoff recovery", () => {
    expect(
      reassignmentIntentPolicy({ kind: "next-workday-cutoff-recovery" })
    ).toEqual({
      ...STRICT_POLICY,
      allowWorkloadBalanceRegression: true,
      allowCutoffProtectionRegression: true,
    });
  });

  it.each([
    ["preserve", false],
    ["yield-to-selected-vacancy", true],
  ] as const)(
    "compiles team-leader gap fill reservation disposition %s",
    (crossWorkdayReservation, allowCrossWorkdayReservationRegression) => {
      expect(
        reassignmentIntentPolicy({
          kind: "team-leader-gap-fill",
          crossWorkdayReservation,
        })
      ).toEqual({
        ...STRICT_POLICY,
        allowCrossWorkdayRecoveryRegression: true,
        allowCrossWorkdayReservationRegression,
        allowLoadProtectionRegression: true,
        allowDirectGuideReassignment: true,
      });
    }
  );
});
