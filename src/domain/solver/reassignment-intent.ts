import type { RotationReview } from "../reviews/reassignment-safety-policy";

export type CrossWorkdayReservationDisposition =
  "preserve" | "yield-to-selected-vacancy";

export type ReassignmentIntent =
  | { kind: "mobile-supervisor-counter-coverage" }
  | { kind: "team-leader-concurrent-gap-fill" }
  | { kind: "late-priority-frequency-review" }
  | { kind: "ke166-rotation-review" }
  | { kind: "consecutive-rotation-review" }
  | { kind: "late-shift-recovery-review" }
  | { kind: "position-frequency-review" }
  | { kind: "manual-swap-analysis" }
  | { kind: "next-workday-cutoff-recovery" }
  | {
      kind: "team-leader-gap-fill";
      crossWorkdayReservation: CrossWorkdayReservationDisposition;
    };

export interface ReassignmentIntentPolicy {
  allowWorkloadBalanceRegression: boolean;
  allowCutoffProtectionRegression: boolean;
  allowCrossWorkdayRecoveryRegression: boolean;
  allowCrossWorkdayReservationRegression: boolean;
  allowLoadProtectionRegression: boolean;
  allowDirectGuideReassignment: boolean;
}

export function reassignmentIntentReview(
  intent: ReassignmentIntent
): RotationReview {
  switch (intent.kind) {
    case "mobile-supervisor-counter-coverage":
      return "mobile-supervisor";
    case "team-leader-concurrent-gap-fill":
    case "team-leader-gap-fill":
      return "coverage";
    case "late-priority-frequency-review":
      return "late-frequency";
    case "ke166-rotation-review":
    case "consecutive-rotation-review":
      return "consecutive";
    case "position-frequency-review":
      return "frequency";
    case "late-shift-recovery-review":
    case "manual-swap-analysis":
    case "next-workday-cutoff-recovery":
      return "recovery";
  }
}

const STRICT_REASSIGNMENT_POLICY: ReassignmentIntentPolicy = {
  allowWorkloadBalanceRegression: false,
  allowCutoffProtectionRegression: false,
  allowCrossWorkdayRecoveryRegression: false,
  allowCrossWorkdayReservationRegression: false,
  allowLoadProtectionRegression: false,
  allowDirectGuideReassignment: false,
};

export function reassignmentIntentPolicy(
  intent: ReassignmentIntent
): ReassignmentIntentPolicy {
  switch (intent.kind) {
    case "next-workday-cutoff-recovery":
      return {
        ...STRICT_REASSIGNMENT_POLICY,
        allowWorkloadBalanceRegression: true,
        allowCutoffProtectionRegression: true,
      };
    case "team-leader-gap-fill":
      return {
        ...STRICT_REASSIGNMENT_POLICY,
        allowCrossWorkdayRecoveryRegression: true,
        allowCrossWorkdayReservationRegression:
          intent.crossWorkdayReservation === "yield-to-selected-vacancy",
        allowLoadProtectionRegression: true,
        allowDirectGuideReassignment: true,
      };
    case "mobile-supervisor-counter-coverage":
    case "team-leader-concurrent-gap-fill":
    case "late-priority-frequency-review":
    case "ke166-rotation-review":
    case "consecutive-rotation-review":
    case "late-shift-recovery-review":
    case "position-frequency-review":
    case "manual-swap-analysis":
      return STRICT_REASSIGNMENT_POLICY;
  }
}
