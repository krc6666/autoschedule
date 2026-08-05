import type { ScheduleSettings } from "../../model";
import {
  SCHEDULING_RULES,
  type SchedulingRuleId,
} from "./schedule-rule-contract";
import { diagnoseAutomaticAssignmentEligibility } from "../candidates/assignment-eligibility";
import type {
  AssignmentEligibilityDiagnostic,
  AutomaticAssignmentEligibilityOptions,
} from "../candidates/assignment-eligibility";
import {
  CANDIDATE_PRIORITY_ORDER,
  compareDutyPosition,
  compareKe166Reservation,
  compareLatePriorityFrequency,
  compareLateShiftCutoff,
  compareLateShiftRecovery,
  compareNumber,
  comparePositionFrequency,
  comparePreferredPositionTransition,
  comparePreviousWorkdayLoadPriority,
  compareScarceQualification,
  compareStrictPositionTransition,
  compareWorkloadBalance,
  type CandidatePriority,
  type CandidatePriorityId,
} from "../candidates/candidate-priority";
import { reviewLateShiftCutoff } from "../reviews/late-shift-cutoff-review";
import { reviewLateShiftRecovery } from "../reviews/late-shift-recovery-review";
import { reviewLatePriorityFrequency } from "../reviews/late-priority-frequency-review";
import { reviewSamePositionFrequency } from "../reviews/position-frequency-review";
import { reviewConsecutivePositionRotation } from "../reviews/position-rotation-review";
import {
  createRuleRegistry,
  type CandidatePriorityExecutor,
  type RulePreference,
  type ScheduleMutationContext,
  type ScheduleMutationExecutor,
  type ScheduleMutationProposal,
  type SchedulingHook,
  type SchedulingHookExecutor,
} from "./rule-registry";
import { compactRegularAssignments } from "../coverage/schedule-coverage";
import {
  scheduleProgressLabel,
  scheduleProgressPercent,
} from "../kernel/schedule-progress";
import { fillVacancyWithTeamLeaderConcurrentSupervision } from "../coverage/team-leader-concurrent-supervision";

export const CONFIGURABLE_RULE_SETTINGS: Partial<
  Record<
    SchedulingRuleId,
    keyof Pick<
      ScheduleSettings,
      | "highLoadProtectionEnabled"
      | "rollingLoadProtectionEnabled"
      | "positionRotationEnabled"
      | "lateShiftRecoveryEnabled"
      | "workloadBalanceEnabled"
    >
  >
> = {
  "late-shift-recovery": "lateShiftRecoveryEnabled",
  "late-shift-cutoff": "lateShiftRecoveryEnabled",
  "priority-position-consecutive": "positionRotationEnabled",
  "high-fatigue-position-consecutive": "positionRotationEnabled",
  "rolling-load": "rollingLoadProtectionEnabled",
  "high-load-recovery": "highLoadProtectionEnabled",
  "position-frequency": "positionRotationEnabled",
  "late-priority-frequency": "positionRotationEnabled",
  "position-frequency-review": "positionRotationEnabled",
  "workload-balance": "workloadBalanceEnabled",
  "position-rotation": "positionRotationEnabled",
};

type CandidateComparator = (
  left: CandidatePriority,
  right: CandidatePriority
) => number;

function candidate(execute: CandidateComparator): CandidatePriorityExecutor {
  return {
    kind: "candidate-priority",
    execute: ({ leftPriority, rightPriority }) =>
      execute(leftPriority, rightPriority),
  };
}

function mutableAssignments(context: ScheduleMutationContext) {
  return context.ledger
    .snapshot()
    .map((assignment) => structuredClone(assignment));
}

function review(
  stage: Parameters<typeof scheduleProgressPercent>[0],
  pass: ScheduleMutationExecutor["pass"],
  execute: (
    context: ScheduleMutationContext
  ) => ScheduleMutationProposal | Promise<ScheduleMutationProposal>
): ScheduleMutationExecutor {
  return {
    kind: "post-schedule",
    id: stage,
    pass,
    progress: {
      stage,
      percent: scheduleProgressPercent(stage),
      label: scheduleProgressLabel(stage),
    },
    execute,
  };
}

const lateShiftRecoveryReview = async (context: ScheduleMutationContext) => {
  const assignments = mutableAssignments(context);
  return {
    assignments,
    warnings: await reviewLateShiftRecovery(
      context.solver,
      context.state,
      assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  };
};

const lateShiftCutoffReview = async (context: ScheduleMutationContext) => {
  const assignments = mutableAssignments(context);
  return {
    assignments,
    warnings: await reviewLateShiftCutoff(
      context.solver,
      context.state,
      assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  };
};

const positionFrequencyReview = async (context: ScheduleMutationContext) => {
  const assignments = mutableAssignments(context);
  return {
    assignments,
    warnings: await reviewSamePositionFrequency(
      context.solver,
      context.state,
      assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  };
};

const latePriorityFrequencyReview = async (
  context: ScheduleMutationContext
) => {
  const assignments = mutableAssignments(context);
  return {
    assignments,
    warnings: await reviewLatePriorityFrequency(
      context.solver,
      context.state,
      assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  };
};

const positionRotationReview = async (context: ScheduleMutationContext) => {
  const assignments = mutableAssignments(context);
  return {
    assignments,
    warnings: await reviewConsecutivePositionRotation(
      context.solver,
      context.state,
      assignments,
      context.date,
      context.lockedAssignmentIds,
      context.runFacts
    ),
  };
};

const RULE_EXECUTION: Readonly<
  Record<
    SchedulingRuleId,
    readonly [SchedulingHookExecutor, ...SchedulingHookExecutor[]]
  >
> = {
  "staff-eligibility": [
    {
      kind: "hard-constraint",
      execute: diagnoseAutomaticAssignmentEligibility,
    },
  ],
  "ke166-supervisor": [
    candidate(compareKe166Reservation),
    {
      kind: "post-schedule",
      id: "ke166-supervisor-finalize",
      pass: "ke166-finalize",
      execute: async (context) => {
        await context.finalizeKe166Supervisor();
        return { warnings: [] };
      },
    },
  ],
  "duty-position": [candidate(compareDutyPosition)],
  "scarce-qualification": [candidate(compareScarceQualification)],
  "position-compaction": [
    {
      kind: "coverage",
      id: "position-compaction",
      pass: "primary",
      execute: (context) => {
        const assignments = mutableAssignments(context);
        compactRegularAssignments(
          context.state,
          assignments,
          context.lockedAssignmentIds,
          context.date,
          context.runFacts.scheduleFrequency
        );
        return { assignments, warnings: [] };
      },
    },
  ],
  "team-leader-concurrent-supervision": [
    {
      kind: "coverage",
      id: "team-leader-concurrent-supervision",
      pass: "primary",
      execute: async (context) => {
        const assignments = mutableAssignments(context);
        return {
          assignments,
          warnings: await fillVacancyWithTeamLeaderConcurrentSupervision(
            context.solver,
            context.state,
            assignments,
            context.date,
            context.lockedAssignmentIds,
            context.runFacts
          ),
        };
      },
    },
  ],
  "position-transition": [candidate(compareStrictPositionTransition)],
  "late-shift-recovery": [
    candidate(compareLateShiftRecovery),
    review("late-shift-recovery", "primary", lateShiftRecoveryReview),
  ],
  "late-shift-cutoff": [
    candidate(compareLateShiftCutoff),
    review("late-shift-cutoff", "primary", lateShiftCutoffReview),
  ],
  "priority-position-consecutive": [
    candidate(
      (left, right) =>
        Number(left.repeatedPriorityPosition) -
        Number(right.repeatedPriorityPosition)
    ),
  ],
  "high-fatigue-position-consecutive": [
    candidate(
      (left, right) =>
        Number(left.repeatedHighFatiguePosition) -
        Number(right.repeatedHighFatiguePosition)
    ),
  ],
  "same-day-late-obligation": [
    candidate(
      (left, right) =>
        Number(left.unavoidableLaterTask) - Number(right.unavoidableLaterTask)
    ),
  ],
  "preferred-position-transition": [
    candidate(comparePreferredPositionTransition),
  ],
  "staff-coverage": [
    candidate(
      (left, right) =>
        Number(left.alreadyAssignedToday) - Number(right.alreadyAssignedToday)
    ),
  ],
  "rolling-load": [
    candidate((left, right) =>
      compareNumber(left.rollingLoadExcess, right.rollingLoadExcess)
    ),
  ],
  "high-load-recovery": [
    candidate(
      (left, right) =>
        Number(left.highLoadRecoveryConflict) -
        Number(right.highLoadRecoveryConflict)
    ),
  ],
  "late-priority-frequency": [
    candidate(compareLatePriorityFrequency),
    review("late-priority-frequency", "primary", latePriorityFrequencyReview),
    review(
      "post-ke166-late-priority-frequency-validation",
      "after-ke166",
      latePriorityFrequencyReview
    ),
  ],
  "cross-workday-load": [candidate(comparePreviousWorkdayLoadPriority)],
  "position-frequency": [candidate(comparePositionFrequency)],
  "position-frequency-review": [
    review("position-frequency", "primary", positionFrequencyReview),
    review(
      "post-ke166-frequency-validation",
      "after-ke166",
      positionFrequencyReview
    ),
  ],
  "workload-balance": [candidate(compareWorkloadBalance)],
  "historical-fatigue": [
    candidate((left, right) =>
      compareNumber(left.historicalFatigue, right.historicalFatigue)
    ),
  ],
  "position-rotation": [
    review("position-rotation", "primary", positionRotationReview),
    review(
      "post-ke166-rotation-validation",
      "after-ke166",
      positionRotationReview
    ),
  ],
};

export const BUILT_IN_SCHEDULING_HOOKS: readonly SchedulingHook[] =
  SCHEDULING_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    stage: rule.stage,
    defaultEnabled: true,
    configurable: CONFIGURABLE_RULE_SETTINGS[rule.id] !== undefined,
    before: rule.id === "ke166-supervisor" ? ["duty-position"] : [],
    after: rule.id === "position-rotation" ? ["position-frequency-review"] : [],
    source: "built-in",
    execute: RULE_EXECUTION[rule.id],
  }));

export const BUILT_IN_RULE_REGISTRY = createRuleRegistry(
  BUILT_IN_SCHEDULING_HOOKS
);

const AUTOMATIC_HARD_CONSTRAINT_EXECUTORS =
  BUILT_IN_RULE_REGISTRY.executionPlan().flatMap((hook) =>
    hook.enabled
      ? hook.execute.filter((executor) => executor.kind === "hard-constraint")
      : []
  );

export function evaluateAutomaticHardConstraints(
  context: AutomaticAssignmentEligibilityOptions
): AssignmentEligibilityDiagnostic {
  const violations = AUTOMATIC_HARD_CONSTRAINT_EXECUTORS.flatMap(
    (executor) => executor.execute(context).violations
  );
  return { eligible: violations.length === 0, violations };
}

export function builtInRulePreferences(
  settings: ScheduleSettings
): RulePreference[] {
  return BUILT_IN_SCHEDULING_HOOKS.map((hook, defaultOrder) => {
    const setting =
      CONFIGURABLE_RULE_SETTINGS[
        hook.id as keyof typeof CONFIGURABLE_RULE_SETTINGS
      ];
    return {
      id: hook.id,
      enabled: setting ? Boolean(settings[setting]) : true,
      order: defaultOrder,
    };
  });
}

export function candidatePriorityOrder(
  settings: ScheduleSettings
): CandidatePriorityId[] {
  const candidateIds = new Set<string>(CANDIDATE_PRIORITY_ORDER);
  return BUILT_IN_RULE_REGISTRY.executionPlan(builtInRulePreferences(settings))
    .filter(
      (hook) =>
        hook.enabled &&
        hook.execute.some(
          (executor) => executor.kind === "candidate-priority"
        ) &&
        candidateIds.has(hook.id)
    )
    .map((hook) => hook.id as CandidatePriorityId);
}
