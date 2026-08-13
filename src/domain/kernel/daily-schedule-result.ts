import type { AppState, Assignment } from "../../model";
import { buildAssignmentDecisionTrace } from "../assignments/assignment-decision-trace";
import { createAssignedPosition } from "../assignments/assignment-factory";
import { applyConfiguredEarlyReleases } from "../assignments/assignment-timing";
import { preNoonShortageNote } from "../coverage/schedule-coverage";
import { makeUnfilled } from "../flights/schedule-position-rules";
import {
  isKe166MobileSupervisor,
  isPreNoonFlight,
} from "../flights/schedule-tasks";
import { evaluateAutomaticHardConstraints } from "../rules/built-in-rule-registry";
import {
  compareCandidateRulePlan,
  firstDifferentCandidateRulePlan,
} from "../rules/candidate-rule-plan";
import {
  crossWorkdayReservationStatuses,
  crossWorkdayReservationWarning,
} from "../reviews/cross-workday-qualification-reservation";
import { violatedPositionTransitionPoliciesForInsertion } from "../reviews/schedule-protection";
import { intervalsOverlap } from "../shared/time";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import { isCrossFlightPriorityAssignment } from "../rules/cross-flight-priority";
import type {
  DailyScheduleModel,
  DailyScheduleStaffChoice,
} from "./daily-schedule-model";
import type { SolverResult } from "../solver/solver-port";
import type { SchedulePreparation } from "./schedule-preparation";
import { assertDailyScheduleSafety } from "./daily-schedule-safety";

export interface DailySchedulePlan {
  assignments: Assignment[];
  lockedAssignmentIds: Set<string>;
  warnings: string[];
  optimizationQuality:
    | "all-objectives-optimal"
    | "fairness-gap-limited"
    | "fairness-time-limited"
    | "fairness-user-stopped";
}

function choiceAssignment(choice: DailyScheduleStaffChoice): Assignment {
  return createAssignedPosition(
    choice.task,
    choice.person,
    choice.workHours,
    [],
    []
  );
}

function attachDecisionTraces(
  state: AppState,
  date: string,
  preparation: SchedulePreparation,
  model: DailyScheduleModel,
  assignments: Assignment[]
): void {
  const dutyTargetTaskKeys = new Set([
    ...(preparation.preferredDutyMorningTaskKey
      ? [preparation.preferredDutyMorningTaskKey]
      : []),
    ...preparation.preferredDutyLateTaskCandidates.map((task) => task.key),
  ]);
  const assignedDutyLateTask = preparation.preferredDutyLateTaskCandidates.find(
    (task) =>
      assignments.some(
        (assignment) =>
          assignment.positionRuleId === task.rule.id &&
          assignment.flightId === task.flight.id &&
          assignment.staffId === preparation.dutyStaffId
      )
  );
  for (const assignment of assignments) {
    if (assignment.status !== "assigned" || !assignment.staffId) continue;
    const task = preparation.tasks.find(
      (item) =>
        item.flight.id === assignment.flightId &&
        item.rule.id === assignment.positionRuleId
    );
    if (!task) continue;
    const taskChoices = model.staffChoices.filter(
      (choice) => choice.task.key === task.key
    );
    const selectedChoice = taskChoices.find(
      (choice) => choice.person.id === assignment.staffId
    );
    if (!selectedChoice) continue;
    const sortedAlternatives = taskChoices
      .filter((choice) => choice.person.id !== assignment.staffId)
      .sort((left, right) =>
        compareCandidateRulePlan(
          model.rulePlan,
          task,
          left.person,
          left.priority,
          right.person,
          right.priority
        )
      );
    const runnerUp = sortedAlternatives[0];
    const selectedBeatsRunnerUp = Boolean(
      runnerUp &&
      compareCandidateRulePlan(
        model.rulePlan,
        task,
        selectedChoice.person,
        selectedChoice.priority,
        runnerUp.person,
        runnerUp.priority
      ) < 0
    );
    assignment.decisionTrace = buildAssignmentDecisionTrace({
      state,
      date,
      assignments: assignments.filter((item) => item.id !== assignment.id),
      task,
      selected: selectedChoice.person,
      runnerUp: runnerUp?.person,
      candidates: taskChoices.map((choice) => choice.person),
      candidatePriorities: new Map(
        taskChoices.map((choice) => [choice.person.id, choice.priority])
      ),
      candidateRulePlan: model.rulePlan,
      decisiveCandidateRule:
        selectedBeatsRunnerUp && runnerUp
          ? firstDifferentCandidateRulePlan(
              model.rulePlan,
              task,
              selectedChoice.person,
              selectedChoice.priority,
              runnerUp.person,
              runnerUp.priority
            )
          : null,
      runFacts: preparation.runFacts,
      dutyStaffId: preparation.dutyStaffId,
      isDutyTarget: dutyTargetTaskKeys.has(task.key),
      hasAssignedDutyLateTask: Boolean(assignedDutyLateTask),
      finalizingKe166Supervisor: false,
    });
    if (!assignment.decisionTrace.length) delete assignment.decisionTrace;
  }
}

function attachVacancyEvidence(
  state: AppState,
  preparation: SchedulePreparation,
  model: DailyScheduleModel,
  assignments: Assignment[]
): void {
  for (const assignment of assignments) {
    if (assignment.status !== "unfilled") continue;
    const task = preparation.tasks.find(
      (item) =>
        item.flight.id === assignment.flightId &&
        item.rule.id === assignment.positionRuleId
    );
    if (!task) continue;
    const reallocatedTo = assignments.find(
      (candidate) =>
        candidate.status === "assigned" &&
        candidate.staffId &&
        candidate.flightId !== assignment.flightId &&
        isPreNoonFlight(candidate) &&
        intervalsOverlap(
          assignment.startTime,
          assignment.endTime,
          candidate.startTime,
          candidate.endTime
        ) &&
        model.staffChoices.some(
          (choice) =>
            choice.task.key === task.key &&
            choice.person.id === candidate.staffId
        )
    );
    if (reallocatedTo) {
      assignment.systemNotes = [
        `因抽调至 ${reallocatedTo.flightNo}/${reallocatedTo.position} 而空缺`,
      ];
      continue;
    }
    const strictTransitionNames = [
      ...new Set(
        model.staffChoices
          .filter((choice) => choice.task.key === task.key)
          .flatMap((choice) =>
            violatedPositionTransitionPoliciesForInsertion(
              assignments,
              choice.person.id,
              task.flight.flightNo,
              task.rule.name,
              task.flight.startTime,
              task.flight.endTime,
              state,
              "forbid"
            ).map((policy) => policy.name)
          )
      ),
    ];
    if (!isPreNoonFlight(assignment) && strictTransitionNames.length) {
      assignment.systemNotes = [
        `严格岗位衔接限制未满足：${strictTransitionNames.join("、")}`,
      ];
      continue;
    }
    if (!isPreNoonFlight(assignment)) continue;
    assignment.systemNotes = [
      preNoonShortageNote(state, assignments, task.flight, task.rule),
    ];
  }
}

function attachCrossFlightPriorityEvidence(
  state: AppState,
  model: DailyScheduleModel,
  assignments: Assignment[]
): void {
  for (const assignment of assignments) {
    if (
      assignment.status !== "assigned" ||
      !assignment.staffId ||
      !isCrossFlightPriorityAssignment(state, assignment)
    )
      continue;
    const competing = assignments.find(
      (other) =>
        other.status === "assigned" &&
        other.staffId &&
        other.flightId !== assignment.flightId &&
        intervalsOverlap(
          assignment.startTime,
          assignment.endTime,
          other.startTime,
          other.endTime
        ) &&
        model.staffChoices.some(
          (choice) =>
            choice.task.flight.id === other.flightId &&
            choice.task.rule.name === other.position &&
            choice.person.id === assignment.staffId
        )
    );
    if (!competing) continue;
    const message = `${assignment.staffName}安排在${assignment.flightNo}/${assignment.position}。该岗位与${competing.flightNo}同时争用具备资质人员，因此本次先保障${assignment.flightNo}重点岗位；如有同等或更优替代人员，可在完整安全复核后调整。`;
    assignment.decisionTrace = [
      ...(assignment.decisionTrace ?? []),
      schedulingDecision("cross-flight-priority", "preserved", message),
    ];
  }
}

function decodeAssignments(
  selectedVariableIds: ReadonlySet<string>,
  model: DailyScheduleModel
): Assignment[] {
  const assignments = model.staffChoices.flatMap((choice) =>
    selectedVariableIds.has(choice.id) ? [choiceAssignment(choice)] : []
  );
  assignments.push(
    ...model.vacancyChoices.flatMap((choice) =>
      selectedVariableIds.has(choice.id)
        ? [
            makeUnfilled(
              choice.task.flight,
              choice.task.rule.name,
              choice.task.rule
            ),
          ]
        : []
    )
  );
  return assignments;
}

export function materializeDailySchedulePlan({
  state,
  date,
  preparation,
  model,
  selectedVariableIds,
}: {
  state: AppState;
  date: string;
  preparation: SchedulePreparation;
  model: DailyScheduleModel;
  selectedVariableIds: ReadonlySet<string>;
}): DailySchedulePlan {
  const assignments = decodeAssignments(selectedVariableIds, model);
  applyConfiguredEarlyReleases(assignments, state);
  attachDecisionTraces(state, date, preparation, model, assignments);
  attachCrossFlightPriorityEvidence(state, model, assignments);
  attachVacancyEvidence(state, preparation, model, assignments);
  const lockedAssignmentIds = new Set(
    assignments.flatMap((assignment) =>
      assignment.staffId === preparation.dutyStaffId &&
      preparation.preferredDutyLateTaskCandidates.some(
        (task) =>
          task.flight.id === assignment.flightId &&
          task.rule.id === assignment.positionRuleId
      )
        ? [assignment.id]
        : []
    )
  );
  const warnings = [
    ...assignments.flatMap((assignment) =>
      assignment.status === "unfilled"
        ? [`${assignment.flightNo} / ${assignment.position} 无可用人员`]
        : []
    ),
    ...crossWorkdayReservationStatuses(state, assignments)
      .filter((status) => status.shortfall > 0)
      .map(crossWorkdayReservationWarning),
  ];
  return {
    assignments,
    lockedAssignmentIds,
    warnings,
    optimizationQuality: "all-objectives-optimal",
  };
}

export function materializeValidatedDailySchedulePlan(options: {
  state: AppState;
  date: string;
  preparation: SchedulePreparation;
  model: DailyScheduleModel;
  selectedVariableIds: ReadonlySet<string>;
  optimizationQuality: DailySchedulePlan["optimizationQuality"];
}): DailySchedulePlan {
  const plan = materializeDailySchedulePlan(options);
  assertDailyScheduleSafety({
    state: options.state,
    date: options.date,
    assignments: plan.assignments,
    tasks: options.preparation.tasks.filter(
      (task) => !isKe166MobileSupervisor(task.flight, task.rule)
    ),
    evaluateEligibility: evaluateAutomaticHardConstraints,
  });
  return { ...plan, optimizationQuality: options.optimizationQuality };
}

export function validatedPlanCallback(
  base: Omit<
    Parameters<typeof materializeValidatedDailySchedulePlan>[0],
    "selectedVariableIds" | "optimizationQuality"
  >,
  receive: ((plan: DailySchedulePlan) => void) | undefined,
  quality: (result: SolverResult) => DailySchedulePlan["optimizationQuality"]
): ((result: SolverResult) => void) | undefined {
  return receive
    ? (result) =>
        receive(
          materializeValidatedDailySchedulePlan({
            ...base,
            selectedVariableIds: result.selectedVariableIds,
            optimizationQuality: quality(result),
          })
        )
    : undefined;
}
