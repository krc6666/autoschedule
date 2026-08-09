import type { AppState, Assignment } from "../../model";
import { buildAssignmentDecisionTrace } from "../assignments/assignment-decision-trace";
import { createAssignedPosition } from "../assignments/assignment-factory";
import { applyConfiguredEarlyReleases } from "../assignments/assignment-timing";
import { preNoonShortageNote } from "../coverage/schedule-coverage";
import { makeUnfilled } from "../flights/schedule-position-rules";
import { isPreNoonFlight } from "../flights/schedule-tasks";
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
import type {
  DailyScheduleModel,
  DailyScheduleStaffChoice,
} from "./daily-schedule-model";
import type { SchedulePreparation } from "./schedule-preparation";

export interface DailySchedulePlan {
  assignments: Assignment[];
  lockedAssignmentIds: Set<string>;
  warnings: string[];
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
  };
}
