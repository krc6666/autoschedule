import type { Staff } from "../../model";
import type { CandidatePriority } from "../candidates/candidate-priority";
import type { AssignmentTask } from "../flights/schedule-tasks";
import type {
  LexicographicObjective,
  LinearConstraint,
  SolverProblem,
} from "../solver/solver-port";

export const SAME_DAY_LATE_OBLIGATION_OBJECTIVE_ID =
  "candidate:same-day-late-obligation";
export const SAME_DAY_SPLIT_CUTOFF_ORDER_OBJECTIVE_ID =
  "candidate:same-day-late-obligation:split-cutoff-order";
export const SAME_DAY_SPLIT_PREVIOUS_END_ORDER_OBJECTIVE_ID =
  "candidate:same-day-late-obligation:split-previous-end-order";
export const SAME_DAY_BEFORE_CUTOFF_ACCESS_OBJECTIVE_ID =
  "candidate:same-day-late-obligation:before-cutoff-access";
export const SAME_DAY_BEFORE_CUTOFF_ORDER_OBJECTIVE_ID =
  "candidate:same-day-late-obligation:before-cutoff-order";
export const LATE_SHIFT_POSITION_RELIEF_OBJECTIVE_PREFIX =
  "candidate:late-shift-position-relief";

export interface SameDayLateObligationChoice {
  readonly id: string;
  readonly person: Pick<Staff, "id">;
  readonly priority: Pick<CandidatePriority, "lateShiftCutoff">;
  readonly task: Pick<AssignmentTask, "key" | "rule">;
  readonly lateShiftPositionRelief: boolean;
}

export interface SameDayLateObligationModel {
  readonly variables: Array<SolverProblem["variables"][number]>;
  readonly constraints: LinearConstraint[];
  readonly objectives: LexicographicObjective[];
}

function compareBeforeCutoffPriority(
  left: SameDayLateObligationChoice,
  right: SameDayLateObligationChoice
): number {
  const leftCutoff = left.priority.lateShiftCutoff.cutoffMinutes ?? 0;
  const rightCutoff = right.priority.lateShiftCutoff.cutoffMinutes ?? 0;
  const leftPreviousEnd = left.priority.lateShiftCutoff.previousEndMinutes ?? 0;
  const rightPreviousEnd =
    right.priority.lateShiftCutoff.previousEndMinutes ?? 0;
  return leftCutoff - rightCutoff || rightPreviousEnd - leftPreviousEnd;
}

export function buildSameDayLateObligationModel(
  choices: readonly SameDayLateObligationChoice[]
): SameDayLateObligationModel {
  const variables: Array<SolverProblem["variables"][number]> = [];
  const constraints: LinearConstraint[] = [];
  const splitTerms: Array<{ variableId: string; coefficient: number }> = [];
  const splitCutoffOrderTerms: Array<{
    variableId: string;
    coefficient: number;
  }> = [];
  const splitPreviousEndOrderTerms: Array<{
    variableId: string;
    coefficient: number;
  }> = [];
  const beforeCutoffVariableIdByChoiceId = new Map<string, string>();
  const choicesByStaffId = new Map<string, SameDayLateObligationChoice[]>();

  for (const choice of choices) {
    const own = choicesByStaffId.get(choice.person.id) ?? [];
    own.push(choice);
    choicesByStaffId.set(choice.person.id, own);
  }

  for (const [staffId, ownChoices] of choicesByStaffId) {
    const beforeCutoff = ownChoices.filter(
      (choice) =>
        choice.priority.lateShiftCutoff.disposition === "before-cutoff"
    );
    const afterCutoff = ownChoices.filter(
      (choice) => choice.priority.lateShiftCutoff.disposition === "after-cutoff"
    );
    if (!beforeCutoff.length) continue;

    const lateAssignedId = afterCutoff.length
      ? `same-day-late-obligation:late:${staffId}`
      : null;
    if (lateAssignedId) {
      // This indicator is the exact OR of every after-cutoff choice for the person.
      variables.push({ id: lateAssignedId });
      constraints.push(
        ...afterCutoff.map((choice, index) => ({
          id: `${lateAssignedId}:minimum:${index}`,
          terms: [
            { variableId: lateAssignedId, coefficient: 1 },
            { variableId: choice.id, coefficient: -1 },
          ],
          lowerBound: 0,
        })),
        {
          id: `${lateAssignedId}:maximum`,
          terms: [
            { variableId: lateAssignedId, coefficient: 1 },
            ...afterCutoff.map((choice) => ({
              variableId: choice.id,
              coefficient: -1,
            })),
          ],
          upperBound: 0,
        }
      );
    }

    beforeCutoff.forEach((choice, index) => {
      if (!lateAssignedId) {
        beforeCutoffVariableIdByChoiceId.set(choice.id, choice.id);
        return;
      }

      const splitAssignmentId = `same-day-late-obligation:split:${staffId}:${index}`;
      const beforeCutoffAccessId = `same-day-late-obligation:before:${staffId}:${index}`;
      // Keep split avoidance and no-late morning access as separate lexicographic facts.
      variables.push({ id: splitAssignmentId }, { id: beforeCutoffAccessId });
      constraints.push(
        {
          id: `${splitAssignmentId}:before-cutoff`,
          terms: [
            { variableId: splitAssignmentId, coefficient: 1 },
            { variableId: choice.id, coefficient: -1 },
          ],
          upperBound: 0,
        },
        {
          id: `${splitAssignmentId}:after-cutoff`,
          terms: [
            { variableId: splitAssignmentId, coefficient: 1 },
            { variableId: lateAssignedId, coefficient: -1 },
          ],
          upperBound: 0,
        },
        {
          id: `${splitAssignmentId}:conjunction`,
          terms: [
            { variableId: splitAssignmentId, coefficient: 1 },
            { variableId: choice.id, coefficient: -1 },
            { variableId: lateAssignedId, coefficient: -1 },
          ],
          lowerBound: -1,
        },
        {
          id: `${beforeCutoffAccessId}:before-cutoff`,
          terms: [
            { variableId: beforeCutoffAccessId, coefficient: 1 },
            { variableId: choice.id, coefficient: -1 },
          ],
          upperBound: 0,
        },
        {
          id: `${beforeCutoffAccessId}:without-late`,
          terms: [
            { variableId: beforeCutoffAccessId, coefficient: 1 },
            { variableId: lateAssignedId, coefficient: 1 },
          ],
          upperBound: 1,
        },
        {
          id: `${beforeCutoffAccessId}:conjunction`,
          terms: [
            { variableId: beforeCutoffAccessId, coefficient: 1 },
            { variableId: choice.id, coefficient: -1 },
            { variableId: lateAssignedId, coefficient: 1 },
          ],
          lowerBound: 0,
        }
      );
      splitTerms.push({ variableId: splitAssignmentId, coefficient: 1 });
      splitCutoffOrderTerms.push({
        variableId: splitAssignmentId,
        coefficient: choice.priority.lateShiftCutoff.cutoffMinutes ?? 0,
      });
      splitPreviousEndOrderTerms.push({
        variableId: splitAssignmentId,
        coefficient: choice.priority.lateShiftCutoff.previousEndMinutes ?? 0,
      });
      beforeCutoffVariableIdByChoiceId.set(choice.id, beforeCutoffAccessId);
    });
  }

  const beforeCutoffAccessTerms = [
    ...beforeCutoffVariableIdByChoiceId.values(),
  ].map((variableId) => ({ variableId, coefficient: 1 }));
  const beforeCutoffOrderTerms: Array<{
    variableId: string;
    coefficient: number;
  }> = [];
  const beforeCutoffByTaskKey = new Map<
    string,
    SameDayLateObligationChoice[]
  >();
  for (const choice of choices.filter(
    (item) => item.priority.lateShiftCutoff.disposition === "before-cutoff"
  )) {
    const own = beforeCutoffByTaskKey.get(choice.task.key) ?? [];
    own.push(choice);
    beforeCutoffByTaskKey.set(choice.task.key, own);
  }
  for (const taskChoices of beforeCutoffByTaskKey.values()) {
    const ordered = [...taskChoices].sort(compareBeforeCutoffPriority);
    let rank = 0;
    ordered.forEach((choice, index) => {
      if (
        index > 0 &&
        compareBeforeCutoffPriority(ordered[index - 1]!, choice) !== 0
      )
        rank += 1;
      const variableId = beforeCutoffVariableIdByChoiceId.get(choice.id);
      if (variableId && rank)
        beforeCutoffOrderTerms.push({ variableId, coefficient: rank });
    });
  }
  const lateShiftReliefObjectives = [...choicesByStaffId].flatMap(
    ([staffId, ownChoices]) => {
      const terms = ownChoices
        .filter((choice) => choice.lateShiftPositionRelief)
        .map((choice) => ({
          variableId: choice.id,
          coefficient: choice.task.rule.fatiguePoints,
        }));
      return terms.length
        ? [
            {
              id: `${LATE_SHIFT_POSITION_RELIEF_OBJECTIVE_PREFIX}:${staffId}`,
              direction: "minimize" as const,
              terms,
            },
          ]
        : [];
    }
  );

  return {
    variables,
    constraints,
    objectives: [
      ...(splitTerms.length
        ? [
            {
              id: SAME_DAY_LATE_OBLIGATION_OBJECTIVE_ID,
              direction: "minimize" as const,
              terms: splitTerms,
            },
          ]
        : []),
      ...(splitCutoffOrderTerms.length
        ? [
            {
              id: SAME_DAY_SPLIT_CUTOFF_ORDER_OBJECTIVE_ID,
              direction: "maximize" as const,
              terms: splitCutoffOrderTerms,
            },
          ]
        : []),
      ...(splitPreviousEndOrderTerms.length
        ? [
            {
              id: SAME_DAY_SPLIT_PREVIOUS_END_ORDER_OBJECTIVE_ID,
              direction: "minimize" as const,
              terms: splitPreviousEndOrderTerms,
            },
          ]
        : []),
      ...lateShiftReliefObjectives,
      ...(beforeCutoffAccessTerms.length
        ? [
            {
              id: SAME_DAY_BEFORE_CUTOFF_ACCESS_OBJECTIVE_ID,
              direction: "maximize" as const,
              terms: beforeCutoffAccessTerms,
            },
          ]
        : []),
      ...(beforeCutoffOrderTerms.length
        ? [
            {
              id: SAME_DAY_BEFORE_CUTOFF_ORDER_OBJECTIVE_ID,
              direction: "minimize" as const,
              terms: beforeCutoffOrderTerms,
            },
          ]
        : []),
    ],
  };
}
