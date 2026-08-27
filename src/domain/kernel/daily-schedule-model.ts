import type { Staff } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { diagnoseBaseAssignmentEligibility } from "../candidates/assignment-eligibility";
import {
  buildCandidatePriority,
  compareLatePriorityAggregateCurrentMonth,
  compareLatePriorityAggregateRecentWorkdays,
  compareLatePriorityCategoryBoundary,
  compareLatePriorityFrequencyForKind,
  compareLatePriorityPreviousWorkday,
  type CandidatePriority,
} from "../candidates/candidate-priority";
import {
  isPreNoonFlight,
  isKe166MobileSupervisor,
  type AssignmentTask,
} from "../flights/schedule-tasks";
import {
  createCandidateRulePlan,
  type CandidateRulePlanItem,
} from "../rules/candidate-rule-plan";
import {
  candidateRuleAfterCoverage,
  dailyObjectiveIsBestEffort,
  dailyObjectiveRuleId,
  orderDailyObjectiveBuckets,
} from "../rules/scheduling-execution-plan";
import type {
  LexicographicObjective,
  LinearConstraint,
  SolverProblem,
} from "../solver/solver-port";
import { durationHours } from "../shared/time";
import type { SchedulePreparation } from "./schedule-preparation";
import {
  workloadBalanceLoadSnapshots,
  WORKLOAD_BALANCE_MIN_FLIGHTS,
} from "../reviews/workload-balance";
import {
  isDutyReliefPriorityPosition,
  isPriorityRotationPosition,
} from "../reviews/position-rotation-policy";
import { LATE_PRIORITY_FREQUENCY_ORDER } from "../reviews/late-priority-policy";
import {
  isLateEndingWork,
  isStrictNextWorkdayRecoveryTarget,
} from "../reviews/cross-day-recovery";
import { latePriorityFlightInScope } from "../statistics/late-priority-flight-scope";
import { exceedsTr121NumberOneAutomaticLimit } from "../statistics/late-priority-frequency";
import {
  buildDailyCombinationModel,
  withDailyCombinationObjectives,
} from "./daily-combination-model";
import { buildSameDayLateObligationModel } from "./daily-same-day-late-obligation-model";
import {
  crossWorkdayReservationTargets,
  crossWorkdayReservationTargetsOverlap,
  taskConsumesCrossWorkdayReservation,
} from "../reviews/cross-workday-qualification-reservation";
import {
  crossFlightPriorityPolicyMatches,
  enabledCrossFlightPriorityPolicies,
} from "../rules/cross-flight-priority";
import { intervalsOverlap } from "../shared/time";
import {
  buildHalfRestOptimizationModel,
  excludeCandidateForHalfRest,
  halfRestBackfillStaffIds,
  isStrictRecoveryHalfRestBackfill,
} from "../rules/half-rest";

export interface DailyScheduleStaffChoice {
  readonly id: string;
  readonly task: AssignmentTask;
  readonly person: Staff;
  readonly priority: CandidatePriority;
  readonly workHours: number;
  readonly lateShiftPositionRelief: boolean;
  readonly strictRecoveryHalfRestBackfill: boolean;
}

export interface DailyScheduleVacancyChoice {
  readonly id: string;
  readonly task: AssignmentTask;
}

export interface DailyScheduleModel {
  readonly problem: SolverProblem;
  readonly staffChoices: readonly DailyScheduleStaffChoice[];
  readonly vacancyChoices: readonly DailyScheduleVacancyChoice[];
  readonly rulePlan: readonly CandidateRulePlanItem[];
  readonly halfRestAffectedStaffIdsByTask: ReadonlyMap<
    string,
    readonly string[]
  >;
}

interface StaffChoiceBuild {
  choices: DailyScheduleStaffChoice[];
  halfRestAffectedStaffIdsByTask: Map<string, readonly string[]>;
}

interface WorkloadModel {
  variables: SolverProblem["variables"];
  constraints: LinearConstraint[];
  objectives: LexicographicObjective[];
}

interface CrossWorkdayReservationModel {
  variables: Array<SolverProblem["variables"][number]>;
  constraints: LinearConstraint[];
  objectives: LexicographicObjective[];
}

function crossFlightPriorityObjectives(
  state: ScheduleGenerationFacts,
  tasks: readonly AssignmentTask[],
  choices: readonly DailyScheduleStaffChoice[]
): LexicographicObjective[] {
  return enabledCrossFlightPriorityPolicies(state).flatMap((policy) => {
    const protectedTasks = tasks.filter((task) =>
      crossFlightPriorityPolicyMatches(policy, {
        flightNo: task.flight.flightNo,
        position: task.rule.name,
      })
    );
    if (!protectedTasks.length) return [];
    const terms = choices.flatMap((choice) => {
      if (
        crossFlightPriorityPolicyMatches(policy, {
          flightNo: choice.task.flight.flightNo,
          position: choice.task.rule.name,
        })
      )
        return [];
      const canProtectOverlappingTask = choices.some(
        (protectedChoice) =>
          protectedChoice.person.id === choice.person.id &&
          protectedTasks.some(
            (task) =>
              task.key === protectedChoice.task.key &&
              intervalsOverlap(
                choice.task.flight.startTime,
                choice.task.flight.endTime,
                task.flight.startTime,
                task.flight.endTime
              )
          )
      );
      return canProtectOverlappingTask
        ? [{ variableId: choice.id, coefficient: 1 }]
        : [];
    });
    return terms.length
      ? [
          {
            id: `cross-flight-priority:${policy.id}`,
            direction: "minimize" as const,
            terms,
          },
        ]
      : [];
  });
}

export interface BuildDailyScheduleModelOptions {
  state: ScheduleGenerationFacts;
  date: string;
  preparation: SchedulePreparation;
  timeoutMs: number;
}

function minimumChoiceHours(task: AssignmentTask): number {
  const hours = durationHours(task.flight.startTime, task.flight.endTime);
  if (
    task.rule.category !== "分流" ||
    task.rule.earlyReleaseMinutes <= 0 ||
    isPreNoonFlight(task.flight)
  )
    return hours;
  return Math.max(0, hours - task.rule.earlyReleaseMinutes / 60);
}

function staffChoicesForTasks(
  state: ScheduleGenerationFacts,
  date: string,
  preparation: SchedulePreparation,
  scheduledTasks: readonly AssignmentTask[]
): StaffChoiceBuild {
  const processedTasks = new Set<string>();
  const dutyTargetTaskKeys = new Set([
    ...(preparation.preferredDutyMorningTaskKey
      ? [preparation.preferredDutyMorningTaskKey]
      : []),
    ...preparation.preferredDutyLateTaskCandidates.map((task) => task.key),
  ]);
  const choices: DailyScheduleStaffChoice[] = [];
  const halfRestAffectedStaffIdsByTask = new Map<string, readonly string[]>();
  for (const task of scheduledTasks) {
    const candidates = state.staff.filter(
      (person) =>
        diagnoseBaseAssignmentEligibility(state, task.flight, task.rule, person)
          .eligible &&
        (dutyTargetTaskKeys.has(task.key) &&
        person.id === preparation.dutyStaffId
          ? true
          : !exceedsTr121NumberOneAutomaticLimit(
              state,
              person.id,
              task.flight.flightNo,
              task.rule,
              date,
              preparation.runFacts.scheduleFrequency
            ))
    );
    const priorities = new Map(
      candidates.map((person) => [
        person.id,
        buildCandidatePriority(
          {
            state,
            assignments: [],
            tasks: preparation.tasks,
            processedTasks,
            eligibleStaffIds: preparation.eligibleStaffIds,
            eligibleCounts: preparation.eligibleCounts,
            runFacts: preparation.runFacts,
            date,
            dutyStaffId: preparation.dutyStaffId,
            task,
            hours: durationHours(task.flight.startTime, task.flight.endTime),
            isDutyTarget: dutyTargetTaskKeys.has(task.key),
            reserveDutyForPendingTarget: false,
            currentDutyTargetTaskKeys: dutyTargetTaskKeys,
          },
          person
        ),
      ])
    );
    const affectedHalfRestStaffIds = halfRestBackfillStaffIds({
      state,
      facts: preparation.runFacts.halfRest,
      flight: task.flight,
      rule: task.rule,
    });
    const preNoon = isPreNoonFlight(task.flight);
    const taskAffectedByHalfRest =
      !preNoon && affectedHalfRestStaffIds.length > 0;
    if (taskAffectedByHalfRest) {
      halfRestAffectedStaffIdsByTask.set(task.key, affectedHalfRestStaffIds);
    }
    for (const person of candidates) {
      const strictRecoveryHalfRestBackfill = isStrictRecoveryHalfRestBackfill({
        state,
        facts: preparation.runFacts.halfRest,
        protectedStaffIds:
          preparation.runFacts.crossDayRecovery.previousWorkday
            .protectedStaffIds,
        staffId: person.id,
        flight: task.flight,
        rule: task.rule,
      });
      if (
        isStrictNextWorkdayRecoveryTarget(state, {
          flightNo: task.flight.flightNo,
          position: task.rule.name,
          remark: task.rule.remark,
        }) &&
        preparation.runFacts.crossDayRecovery.previousWorkday.protectedStaffIds.has(
          person.id
        ) &&
        !strictRecoveryHalfRestBackfill
      ) {
        continue;
      }
      const priority = priorities.get(person.id)!;
      if (
        excludeCandidateForHalfRest({
          facts: preparation.runFacts.halfRest,
          staffId: person.id,
          preNoon,
          priority,
        })
      ) {
        continue;
      }
      choices.push({
        id: `staff:${choices.length}`,
        task,
        person,
        priority,
        workHours: minimumChoiceHours(task),
        strictRecoveryHalfRestBackfill,
        lateShiftPositionRelief:
          state.settings.lateShiftRecoveryEnabled &&
          preparation.runFacts.crossDayRecovery.previousWorkday.scopedProtectedStaffIds.has(
            person.id
          ) &&
          latePriorityFlightInScope(
            state.settings.latePriorityFlightNumbers,
            task.flight.flightNo
          ) &&
          isLateEndingWork(task.flight, state),
      });
    }
  }
  return {
    choices,
    halfRestAffectedStaffIdsByTask,
  };
}

function dutyModel(
  preparation: SchedulePreparation,
  staffChoices: readonly DailyScheduleStaffChoice[]
): {
  constraints: LinearConstraint[];
  objectives: LexicographicObjective[];
  reliefObjectives: LexicographicObjective[];
} {
  const dutyStaffId = preparation.dutyStaffId;
  if (!dutyStaffId)
    return { constraints: [], objectives: [], reliefObjectives: [] };
  const dutyTargetTaskKeys = new Set([
    ...(preparation.preferredDutyMorningTaskKey
      ? [preparation.preferredDutyMorningTaskKey]
      : []),
    ...preparation.preferredDutyLateTaskCandidates.map((task) => task.key),
  ]);
  const choiceForTask = (
    taskKey: string
  ): DailyScheduleStaffChoice | undefined =>
    staffChoices.find(
      (choice) =>
        choice.task.key === taskKey && choice.person.id === dutyStaffId
    );
  const constraints: LinearConstraint[] = [];
  const morningChoices = staffChoices.filter(
    (choice) =>
      choice.person.id === dutyStaffId && isPreNoonFlight(choice.task.flight)
  );
  if (morningChoices.length) {
    constraints.push({
      id: "duty:morning",
      terms: morningChoices.map((choice) => ({
        variableId: choice.id,
        coefficient: 1,
      })),
      lowerBound: 1,
    });
  }
  const preferredMorningChoice = preparation.preferredDutyMorningTaskKey
    ? choiceForTask(preparation.preferredDutyMorningTaskKey)
    : undefined;
  const lateChoices = preparation.preferredDutyLateTaskCandidates.flatMap(
    (task) => {
      const choice = choiceForTask(task.key);
      return choice ? [choice] : [];
    }
  );
  if (lateChoices.length) {
    constraints.push({
      id: "duty:one-late-target",
      terms: lateChoices.map((choice) => ({
        variableId: choice.id,
        coefficient: 1,
      })),
      upperBound: 1,
    });
  }
  const extraDutyChoices = staffChoices.filter(
    (choice) =>
      choice.person.id === dutyStaffId &&
      !dutyTargetTaskKeys.has(choice.task.key)
  );
  return {
    constraints,
    objectives: [
      ...(lateChoices.length
        ? [
            {
              id: "duty:late-target",
              direction: "maximize" as const,
              terms: lateChoices.map((choice, index) => ({
                variableId: choice.id,
                coefficient: lateChoices.length - index,
              })),
            },
          ]
        : []),
      ...(preferredMorningChoice
        ? [
            {
              id: "duty:preferred-morning",
              direction: "maximize" as const,
              terms: [
                { variableId: preferredMorningChoice.id, coefficient: 1 },
              ],
            },
          ]
        : []),
    ],
    reliefObjectives: [
      {
        id: "duty:between-target-rest",
        direction: "minimize",
        terms: extraDutyChoices.map((choice) => ({
          variableId: choice.id,
          coefficient: 1,
        })),
      },
      {
        id: "duty:avoid-additional-priority",
        direction: "minimize",
        terms: extraDutyChoices.flatMap((choice) =>
          isDutyReliefPriorityPosition(
            choice.task.flight.flightNo,
            choice.task.rule
          )
            ? [{ variableId: choice.id, coefficient: 1 }]
            : []
        ),
      },
      {
        id: "duty:between-target-fatigue",
        direction: "minimize",
        terms: extraDutyChoices.map((choice) => ({
          variableId: choice.id,
          coefficient: Math.max(0, choice.task.rule.fatiguePoints),
        })),
      },
    ],
  };
}

function assignmentConstraints(
  tasks: readonly AssignmentTask[],
  staffChoices: readonly DailyScheduleStaffChoice[],
  vacancyChoices: readonly DailyScheduleVacancyChoice[],
  strictRecoveryTargetTaskKeys: ReadonlySet<string>
): LinearConstraint[] {
  return tasks.map((task, index) => ({
    id: `assignment:${index}`,
    terms: [
      ...staffChoices
        .filter((choice) => choice.task.key === task.key)
        .map((choice) => ({ variableId: choice.id, coefficient: 1 })),
      {
        variableId: vacancyChoices.find(
          (choice) => choice.task.key === task.key
        )!.id,
        coefficient: 1,
      },
    ].filter((term) =>
      term.variableId.startsWith("vacancy:")
        ? !strictRecoveryTargetTaskKeys.has(task.key)
        : true
    ),
    lowerBound: 1,
    upperBound: 1,
  }));
}

function crossWorkdayReservationModel(
  state: ScheduleGenerationFacts,
  staffChoices: readonly DailyScheduleStaffChoice[]
): CrossWorkdayReservationModel {
  const targets = crossWorkdayReservationTargets(state);
  const variables: Array<SolverProblem["variables"][number]> = [];
  const constraints: LinearConstraint[] = [];
  const objectives: LexicographicObjective[] = [];
  const variableIdByTargetAndStaff = new Map<string, string>();

  targets.forEach((target, targetIndex) => {
    const targetVariableIds: string[] = [];
    [...target.qualifiedStaffIds].forEach((staffId, staffIndex) => {
      const variableId = `cross-workday-reserve:${targetIndex}:${staffIndex}`;
      variables.push({ id: variableId });
      targetVariableIds.push(variableId);
      variableIdByTargetAndStaff.set(
        `${targetIndex}\u0000${staffId}`,
        variableId
      );
      const consumingByFlightId = new Map<string, DailyScheduleStaffChoice[]>();
      for (const choice of staffChoices) {
        if (
          choice.person.id !== staffId ||
          !taskConsumesCrossWorkdayReservation(
            state,
            choice.task.flight,
            choice.task.rule
          )
        ) {
          continue;
        }
        const own = consumingByFlightId.get(choice.task.flight.id) ?? [];
        own.push(choice);
        consumingByFlightId.set(choice.task.flight.id, own);
      }
      for (const [flightId, choices] of consumingByFlightId) {
        constraints.push({
          id: `cross-workday-reserve:${targetIndex}:${staffIndex}:${flightId}`,
          terms: [
            { variableId, coefficient: 1 },
            ...choices.map((choice) => ({
              variableId: choice.id,
              coefficient: 1,
            })),
          ],
          upperBound: 1,
        });
      }
    });
    if (targetVariableIds.length) {
      constraints.push({
        id: `cross-workday-reserve-cap:${targetIndex}`,
        terms: targetVariableIds.map((variableId) => ({
          variableId,
          coefficient: 1,
        })),
        upperBound: target.reservation.minimumStaffCount,
      });
      objectives.push({
        id: `cross-workday-qualification-reservation:${target.reservation.id}`,
        direction: "maximize",
        terms: targetVariableIds.map((variableId) => ({
          variableId,
          coefficient: 1,
        })),
      });
    }
  });

  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < targets.length;
      rightIndex += 1
    ) {
      if (
        !crossWorkdayReservationTargetsOverlap(
          targets[leftIndex]!,
          targets[rightIndex]!
        )
      ) {
        continue;
      }
      for (const staffId of targets[leftIndex]!.qualifiedStaffIds) {
        const leftVariableId = variableIdByTargetAndStaff.get(
          `${leftIndex}\u0000${staffId}`
        );
        const rightVariableId = variableIdByTargetAndStaff.get(
          `${rightIndex}\u0000${staffId}`
        );
        if (!leftVariableId || !rightVariableId) continue;
        constraints.push({
          id: `cross-workday-reserve-overlap:${constraints.length}`,
          terms: [leftVariableId, rightVariableId].map((variableId) => ({
            variableId,
            coefficient: 1,
          })),
          upperBound: 1,
        });
      }
    }
  }
  return { variables, constraints, objectives };
}

function capacityConstraints(
  state: ScheduleGenerationFacts,
  staffChoices: readonly DailyScheduleStaffChoice[]
): LinearConstraint[] {
  return state.staff.map((person, index) => ({
    id: `hours:${index}`,
    terms: staffChoices
      .filter((choice) => choice.person.id === person.id)
      .map((choice) => ({
        variableId: choice.id,
        coefficient: choice.workHours,
      })),
    upperBound: state.settings.maxDailyHours,
  }));
}

function staffCoverageModel(
  state: ScheduleGenerationFacts,
  staffChoices: readonly DailyScheduleStaffChoice[]
): {
  variables: { id: string }[];
  constraints: LinearConstraint[];
  workedVariableIds: Map<string, string>;
} {
  const workedVariableIds = new Map<string, string>();
  const variables: { id: string }[] = [];
  const constraints: LinearConstraint[] = [];
  for (const person of state.staff.filter(
    (item) =>
      item.status === "正常" && item.staffType === "常规" && !item.teamLeader
  )) {
    const ownChoices = staffChoices.filter(
      (choice) => choice.person.id === person.id && choice.workHours > 0
    );
    if (!ownChoices.length) continue;
    const variableId = `worked:${person.id}`;
    workedVariableIds.set(person.id, variableId);
    variables.push({ id: variableId });
    constraints.push(
      {
        id: `worked:minimum:${person.id}`,
        terms: [
          ...ownChoices.map((choice) => ({
            variableId: choice.id,
            coefficient: 1,
          })),
          { variableId, coefficient: -1 },
        ],
        lowerBound: 0,
      },
      {
        id: `worked:maximum:${person.id}`,
        terms: [
          ...ownChoices.map((choice) => ({
            variableId: choice.id,
            coefficient: 1,
          })),
          { variableId, coefficient: -ownChoices.length },
        ],
        upperBound: 0,
      }
    );
  }
  return { variables, constraints, workedVariableIds };
}

function workloadModel(
  state: ScheduleGenerationFacts,
  date: string,
  preparation: SchedulePreparation,
  staffChoices: readonly DailyScheduleStaffChoice[]
): WorkloadModel {
  if (!state.settings.workloadBalanceEnabled)
    return { variables: [], constraints: [], objectives: [] };
  if (
    state.flights.length < WORKLOAD_BALANCE_MIN_FLIGHTS ||
    preparation.runFacts.workloadPressure.pressure === "宽松"
  )
    return { variables: [], constraints: [], objectives: [] };
  const staff = state.staff.filter(
    (person) => person.status === "正常" && person.staffType === "常规"
  );
  if (staff.length < 2)
    return { variables: [], constraints: [], objectives: [] };
  const baseline = new Map(
    workloadBalanceLoadSnapshots(state, [], date, preparation.dutyStaffId).map(
      (load) => [load.id, load]
    )
  );
  const variables: Array<SolverProblem["variables"][number]> = [];
  const constraints: LinearConstraint[] = [];
  const objectives: LexicographicObjective[] = [];
  const metric = (
    id: string,
    coefficient: (choice: DailyScheduleStaffChoice) => number,
    constant: (staffId: string) => number,
    target: number
  ): { excessId: string; spreadId: string; maximumExcess: number } => {
    const maximumId = `workload:${id}:maximum`;
    const minimumId = `workload:${id}:minimum`;
    const spreadId = `workload:${id}:spread`;
    const excessId = `workload:${id}:excess`;
    const baseLoads = staff.map((person) => constant(person.id));
    const maximumLoad = Math.max(
      0,
      ...staff.map(
        (person) =>
          constant(person.id) +
          staffChoices
            .filter((choice) => choice.person.id === person.id)
            .reduce((sum, choice) => sum + coefficient(choice), 0)
      )
    );
    const minimumLoad = Math.min(...baseLoads);
    const maximumDifference = Math.max(0, maximumLoad - minimumLoad);
    const maximumExcess = Math.max(0, maximumDifference - target);
    variables.push(
      {
        id: maximumId,
        type: "continuous",
        lowerBound: 0,
        upperBound: maximumLoad,
      },
      {
        id: minimumId,
        type: "continuous",
        lowerBound: 0,
        upperBound: maximumLoad,
      },
      {
        id: spreadId,
        type: "continuous",
        lowerBound: 0,
        upperBound: maximumDifference,
      },
      {
        id: excessId,
        type: "continuous",
        lowerBound: 0,
        upperBound: maximumExcess,
      }
    );
    for (const person of staff) {
      const terms = staffChoices
        .filter((choice) => choice.person.id === person.id)
        .flatMap((choice) => {
          const value = coefficient(choice);
          return value ? [{ variableId: choice.id, coefficient: -value }] : [];
        });
      const base = constant(person.id);
      constraints.push(
        {
          id: `workload:${id}:maximum:${person.id}`,
          terms: [{ variableId: maximumId, coefficient: 1 }, ...terms],
          lowerBound: base,
        },
        {
          id: `workload:${id}:minimum:${person.id}`,
          terms: [{ variableId: minimumId, coefficient: 1 }, ...terms],
          upperBound: base,
        }
      );
    }
    constraints.push(
      {
        id: `workload:${id}:spread`,
        terms: [
          { variableId: spreadId, coefficient: 1 },
          { variableId: maximumId, coefficient: -1 },
          { variableId: minimumId, coefficient: 1 },
        ],
        lowerBound: 0,
      },
      {
        id: `workload:${id}:excess`,
        terms: [
          { variableId: excessId, coefficient: 1 },
          { variableId: spreadId, coefficient: -1 },
        ],
        lowerBound: -target,
      }
    );
    return { excessId, spreadId, maximumExcess };
  };
  const hoursTarget = Math.max(0.5, state.settings.maxWorkHoursDifference);
  const today = metric(
    "today-hours",
    (choice) => choice.workHours,
    () => 0,
    hoursTarget
  );
  const rolling = metric(
    "rolling-hours",
    (choice) => choice.workHours,
    (staffId) => baseline.get(staffId)?.rollingHours ?? 0,
    hoursTarget + Math.max(0, state.settings.historyWindowDays / 2)
  );
  const fatigue = metric(
    "today-fatigue",
    (choice) => choice.task.rule.fatiguePoints,
    (staffId) => baseline.get(staffId)?.todayFatigue ?? 0,
    Math.max(0.5, state.settings.maxTodayFatigueDifference)
  );
  const violationId = "workload:configured-target-violation";
  variables.push({ id: violationId });
  const excesses = [today, rolling, fatigue];
  constraints.push(
    ...excesses.map(({ excessId, maximumExcess }) => ({
      id: `workload:violation:${excessId}`,
      terms: [
        { variableId: excessId, coefficient: 1 },
        { variableId: violationId, coefficient: -maximumExcess },
      ],
      upperBound: 0,
    }))
  );
  objectives.push(
    {
      id: "candidate:workload-balance:target",
      direction: "minimize",
      terms: [{ variableId: violationId, coefficient: 1 }],
      optimality: "best-effort",
    },
    {
      id: "candidate:workload-balance:today-hours-excess",
      direction: "minimize",
      terms: [{ variableId: today.excessId, coefficient: 1 }],
      optimality: "best-effort",
    },
    {
      id: "candidate:workload-balance:rolling-hours-excess",
      direction: "minimize",
      terms: [{ variableId: rolling.excessId, coefficient: 1 }],
      optimality: "best-effort",
    },
    ...[
      {
        id: "candidate:workload-balance:today-fatigue-excess",
        direction: "minimize" as const,
        terms: [{ variableId: fatigue.excessId, coefficient: 1 }],
        optimality: "best-effort" as const,
      },
      {
        id: "candidate:workload-balance:today-hours-spread",
        direction: "minimize" as const,
        terms: [{ variableId: today.spreadId, coefficient: 1 }],
        optimality: "best-effort" as const,
        solveOnlyWhen: {
          objectiveId: "candidate:workload-balance:today-hours-excess",
          equals: 0,
        },
      },
      {
        id: "candidate:workload-balance:rolling-hours-spread",
        direction: "minimize" as const,
        terms: [{ variableId: rolling.spreadId, coefficient: 1 }],
        optimality: "best-effort" as const,
        solveOnlyWhen: {
          objectiveId: "candidate:workload-balance:rolling-hours-excess",
          equals: 0,
        },
      },
      {
        id: "candidate:workload-balance:today-fatigue-spread",
        direction: "minimize" as const,
        terms: [{ variableId: fatigue.spreadId, coefficient: 1 }],
        optimality: "best-effort" as const,
        solveOnlyWhen: {
          objectiveId: "candidate:workload-balance:today-fatigue-excess",
          equals: 0,
        },
      },
    ]
  );
  return { variables, constraints, objectives };
}

function replaceWorkloadObjective(
  objectives: readonly LexicographicObjective[],
  workloadObjectives: readonly LexicographicObjective[]
): LexicographicObjective[] {
  if (!workloadObjectives.length) return [...objectives];
  const withoutStatic = objectives.filter(
    (objective) => objective.id !== "candidate:workload-balance"
  );
  const insertionIndex = withoutStatic.findIndex(
    (objective) => dailyObjectiveRuleId(objective.id) === "historical-fatigue"
  );
  const index = insertionIndex < 0 ? withoutStatic.length : insertionIndex;
  return [
    ...withoutStatic.slice(0, index),
    ...workloadObjectives,
    ...withoutStatic.slice(index),
  ];
}

function candidateRuleObjectives(
  state: ScheduleGenerationFacts,
  tasks: readonly AssignmentTask[],
  choices: readonly DailyScheduleStaffChoice[],
  rulePlan: readonly CandidateRulePlanItem[],
  workedVariableIds: ReadonlyMap<string, string>
): LexicographicObjective[] {
  const objectives = rulePlan.flatMap<LexicographicObjective>((rule) => {
    if (rule.id === "late-shift-cutoff") {
      return [
        {
          id: `candidate:${rule.id}`,
          direction: "minimize",
          terms: choices.flatMap((choice) =>
            choice.priority.lateShiftCutoff.disposition === "after-cutoff"
              ? [{ variableId: choice.id, coefficient: 1 }]
              : []
          ),
        },
      ];
    }
    if (rule.id === "staff-coverage") {
      return [
        {
          id: `candidate:${rule.id}`,
          direction: "maximize" as const,
          terms: [...workedVariableIds.values()].map((variableId) => ({
            variableId,
            coefficient: 1,
          })),
        },
      ];
    }
    const variants =
      rule.id === "late-priority-aggregate-rotation"
        ? [
            {
              id: `candidate:${rule.id}:category-boundary`,
              execute: (
                left: DailyScheduleStaffChoice,
                right: DailyScheduleStaffChoice
              ) =>
                compareLatePriorityCategoryBoundary(
                  left.priority,
                  right.priority
                ),
            },
            {
              id: `candidate:${rule.id}:previous-workday`,
              execute: (
                left: DailyScheduleStaffChoice,
                right: DailyScheduleStaffChoice
              ) =>
                compareLatePriorityPreviousWorkday(
                  left.priority,
                  right.priority
                ),
            },
            {
              id: `candidate:${rule.id}:current-month`,
              execute: (
                left: DailyScheduleStaffChoice,
                right: DailyScheduleStaffChoice
              ) =>
                compareLatePriorityAggregateCurrentMonth(
                  left.priority,
                  right.priority
                ),
            },
            {
              id: `candidate:${rule.id}:recent-eight-workdays`,
              execute: (
                left: DailyScheduleStaffChoice,
                right: DailyScheduleStaffChoice
              ) =>
                compareLatePriorityAggregateRecentWorkdays(
                  left.priority,
                  right.priority
                ),
            },
          ]
        : rule.id === "late-priority-frequency"
          ? LATE_PRIORITY_FREQUENCY_ORDER.map((kind) => ({
              id: `candidate:${rule.id}:${kind}`,
              execute: (
                left: DailyScheduleStaffChoice,
                right: DailyScheduleStaffChoice
              ) =>
                compareLatePriorityFrequencyForKind(
                  left.priority,
                  right.priority,
                  kind
                ),
            }))
          : [
              {
                id: `candidate:${rule.id}`,
                execute: (
                  left: DailyScheduleStaffChoice,
                  right: DailyScheduleStaffChoice
                ) =>
                  rule.execute({
                    task: left.task,
                    left: left.person,
                    leftPriority: left.priority,
                    right: right.person,
                    rightPriority: right.priority,
                  }),
              },
            ];
    return variants.map<LexicographicObjective>((variant) => {
      const rankByChoiceId = new Map<string, number>();
      for (const task of tasks) {
        const taskChoices = choices
          .filter((choice) => choice.task.key === task.key)
          .sort(
            (left, right) =>
              variant.execute(left, right) ||
              state.staff.indexOf(left.person) -
                state.staff.indexOf(right.person)
          );
        let rank = 0;
        taskChoices.forEach((choice, index) => {
          if (index > 0) {
            const previous = taskChoices[index - 1]!;
            if (variant.execute(previous, choice) !== 0) rank += 1;
          }
          rankByChoiceId.set(choice.id, rank);
        });
      }
      return {
        id: variant.id,
        direction: "minimize" as const,
        optimality:
          rule.id === "historical-fatigue"
            ? ("best-effort" as const)
            : ("required" as const),
        terms: choices.flatMap((choice) => {
          const coefficient = rankByChoiceId.get(choice.id) ?? 0;
          return coefficient ? [{ variableId: choice.id, coefficient }] : [];
        }),
      };
    });
  });
  const deferredRuleIds = new Set(
    rulePlan.filter(candidateRuleAfterCoverage).map((rule) => rule.id)
  );
  const deferred = objectives.filter((objective) =>
    deferredRuleIds.has(dailyObjectiveRuleId(objective.id)!)
  );
  const ordered = objectives.filter(
    (objective) => !deferredRuleIds.has(dailyObjectiveRuleId(objective.id)!)
  );
  const coverageIndex = ordered.findIndex(
    (objective) => objective.id === "candidate:staff-coverage"
  );
  if (coverageIndex < 0 || !deferred.length) return ordered;
  return [
    ...ordered.slice(0, coverageIndex + 1),
    ...deferred,
    ...ordered.slice(coverageIndex + 1),
  ];
}

function insertSameDayLateObligationObjectives(
  objectives: readonly LexicographicObjective[],
  insertedObjectives: readonly LexicographicObjective[]
): LexicographicObjective[] {
  if (!insertedObjectives.length) return [...objectives];
  const insertionIndex = objectives.findIndex(
    (item) => dailyObjectiveRuleId(item.id) === "preferred-position-transition"
  );
  const index = insertionIndex < 0 ? objectives.length : insertionIndex;
  return [
    ...objectives.slice(0, index),
    ...insertedObjectives,
    ...objectives.slice(index),
  ];
}

function simplifyLexicographicObjectives(
  objectives: readonly LexicographicObjective[]
): [LexicographicObjective, ...LexicographicObjective[]] {
  const simplified = objectives.flatMap((objective) => {
    const coefficients = new Map<string, number>();
    for (const term of objective.terms) {
      coefficients.set(
        term.variableId,
        (coefficients.get(term.variableId) ?? 0) + term.coefficient
      );
    }
    const terms = [...coefficients]
      .filter(([, coefficient]) => coefficient !== 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([variableId, coefficient]) => ({ variableId, coefficient }));
    if (!terms.length) return [];
    return [
      {
        ...objective,
        terms,
        optimality: objective.optimality ?? "required",
      },
    ];
  });
  const first = simplified[0];
  if (!first) throw new Error("当天整体排班没有可执行的求解目标");
  return [first, ...simplified.slice(1)];
}

const BEST_EFFORT_RELATIVE_GAP = 0.05;
function applyDailyObjectiveOptimality(
  objectives: readonly LexicographicObjective[]
): [LexicographicObjective, ...LexicographicObjective[]] {
  const projected = objectives.map((objective) => {
    const bestEffort = dailyObjectiveIsBestEffort(objective.id);
    if (!bestEffort)
      return {
        ...objective,
        optimality: "required" as const,
        acceptedGap: undefined,
      };
    return {
      ...objective,
      optimality: "best-effort" as const,
      acceptedGap: {
        relative: BEST_EFFORT_RELATIVE_GAP,
        ...(objective.objectiveValueStep !== undefined
          ? { absolute: objective.objectiveValueStep }
          : {}),
      },
    };
  });
  const required = projected.filter(
    (objective) => objective.optimality === "required"
  );
  const bestEffort = projected.filter(
    (objective) => objective.optimality === "best-effort"
  );
  const ordered = [...required, ...bestEffort];
  const first = ordered[0];
  if (!first) throw new Error("当天整体排班没有可执行的求解目标");
  return [first, ...ordered.slice(1)];
}

export function buildDailyScheduleModel({
  state,
  date,
  preparation,
  timeoutMs,
}: BuildDailyScheduleModelOptions): DailyScheduleModel | null {
  const scheduledTasks = preparation.tasks.filter(
    (task) => !isKe166MobileSupervisor(task.flight, task.rule)
  );
  if (!scheduledTasks.length) return null;
  const rulePlan = createCandidateRulePlan(state.settings);
  const staffChoiceBuild = staffChoicesForTasks(
    state,
    date,
    preparation,
    scheduledTasks
  );
  const staffChoices = staffChoiceBuild.choices;
  const vacancyChoices = scheduledTasks.map((task, index) => ({
    id: `vacancy:${index}`,
    task,
  }));
  const strictRecoveryTargetTaskKeys = new Set(
    scheduledTasks
      .filter(
        (task) =>
          isStrictNextWorkdayRecoveryTarget(state, {
            flightNo: task.flight.flightNo,
            position: task.rule.name,
            remark: task.rule.remark,
          }) &&
          task.rule.qualifiedStaffIds.some((staffId) =>
            preparation.runFacts.crossDayRecovery.previousWorkday.protectedStaffIds.has(
              staffId
            )
          ) &&
          !staffChoiceBuild.halfRestAffectedStaffIdsByTask.has(task.key)
      )
      .map((task) => task.key)
  );
  const staffCoverage = staffCoverageModel(state, staffChoices);
  const workload = workloadModel(state, date, preparation, staffChoices);
  const crossWorkdayReservation = crossWorkdayReservationModel(
    state,
    staffChoices
  );
  const staticCandidateObjectives = candidateRuleObjectives(
    state,
    scheduledTasks,
    staffChoices,
    rulePlan,
    staffCoverage.workedVariableIds
  );
  const sameDayLateObligation = buildSameDayLateObligationModel(staffChoices);
  const dailyModelCandidateObjectives = insertSameDayLateObligationObjectives(
    staticCandidateObjectives,
    sameDayLateObligation.objectives
  );
  const combinations = buildDailyCombinationModel(
    state,
    staffChoices,
    new Set(dailyModelCandidateObjectives.map((objective) => objective.id))
  );
  const duty = dutyModel(preparation, staffChoices);
  const halfRest = buildHalfRestOptimizationModel(
    preparation.runFacts.halfRest,
    staffChoices.map((choice) => ({
      variableId: choice.id,
      staffId: choice.person.id,
      startTime: choice.task.flight.startTime,
      endTime: choice.task.flight.endTime,
    }))
  );
  const maximumEligibleCount = Math.max(
    1,
    ...scheduledTasks.map((task) =>
      task.rule.category === "行政支援"
        ? 0
        : (preparation.eligibleCounts.get(task.key) ?? 0)
    )
  );
  const preNoonScarcityTerms = vacancyChoices.map((choice) => ({
    variableId: choice.id,
    coefficient:
      choice.task.rule.category !== "行政支援" &&
      isPreNoonFlight(choice.task.flight)
        ? maximumEligibleCount -
          (preparation.eligibleCounts.get(choice.task.key) ?? 0) +
          1
        : 0,
  }));
  const distinctPreNoonScarcityCoefficients = new Set(
    preNoonScarcityTerms
      .map((term) => term.coefficient)
      .filter((coefficient) => coefficient !== 0)
  );
  const coverageObjectives: LexicographicObjective[] = [
    {
      id: "pre-noon-vacancies",
      direction: "minimize",
      terms: vacancyChoices.map((choice) => ({
        variableId: choice.id,
        coefficient:
          choice.task.rule.category !== "行政支援" &&
          isPreNoonFlight(choice.task.flight)
            ? 1
            : 0,
      })),
    },
    {
      id: "regular-system-vacancies",
      direction: "minimize",
      terms: vacancyChoices.map((choice) => ({
        variableId: choice.id,
        coefficient: choice.task.rule.category === "行政支援" ? 0 : 1,
      })),
    },
    {
      id: "all-vacancies",
      direction: "minimize",
      terms: vacancyChoices.map((choice) => ({
        variableId: choice.id,
        coefficient: 1,
      })),
    },
    {
      id: "strict-next-workday-recovery:half-rest-backfill",
      direction: "minimize",
      terms: staffChoices
        .filter((choice) => choice.strictRecoveryHalfRestBackfill)
        .map((choice) => ({ variableId: choice.id, coefficient: 1 })),
    },
    {
      id: "minimum-flight-transition:diversion-usage",
      direction: "minimize",
      terms:
        combinations.objectiveTerms.get(
          "minimum-flight-transition:diversion-usage"
        ) ?? [],
    },
    ...enabledCrossFlightPriorityPolicies(state).map((policy) => ({
      id: `cross-flight-priority-vacancies:${policy.id}`,
      direction: "minimize" as const,
      terms: vacancyChoices.map((choice) => ({
        variableId: choice.id,
        coefficient: crossFlightPriorityPolicyMatches(policy, {
          flightNo: choice.task.flight.flightNo,
          position: choice.task.rule.name,
        })
          ? 1
          : 0,
      })),
    })),
    ...(distinctPreNoonScarcityCoefficients.size > 1
      ? [
          {
            id: "pre-noon-scarcity",
            direction: "minimize" as const,
            terms: preNoonScarcityTerms,
          },
        ]
      : []),
    {
      id: "pre-noon-priority-vacancies",
      direction: "minimize",
      terms: vacancyChoices.map((choice) => ({
        variableId: choice.id,
        coefficient:
          isPreNoonFlight(choice.task.flight) &&
          isPriorityRotationPosition(choice.task.rule)
            ? 1
            : 0,
      })),
    },
    {
      id: "vacancy-order",
      direction: "minimize",
      terms: vacancyChoices.map((choice, index) => ({
        variableId: choice.id,
        coefficient: isPreNoonFlight(choice.task.flight)
          ? index + 1
          : vacancyChoices.length - index,
      })),
    },
  ];
  const candidateObjectives = replaceWorkloadObjective(
    withDailyCombinationObjectives(dailyModelCandidateObjectives, combinations),
    workload.objectives
  );
  const crossFlightPriority = crossFlightPriorityObjectives(
    state,
    scheduledTasks,
    staffChoices
  );
  const ke166ReservationObjectives = candidateObjectives.filter(
    (objective) => objective.id === "candidate:ke166-supervisor"
  );
  const strictTransitionObjectives = candidateObjectives.filter(
    (objective) => objective.id === "candidate:position-transition"
  );
  const remainingCandidateObjectives = candidateObjectives.filter(
    (objective) =>
      objective.id !== "candidate:ke166-supervisor" &&
      objective.id !== "candidate:position-transition" &&
      !["candidate:late-shift-recovery", "candidate:late-shift-cutoff"].some(
        (recoveryId) =>
          objective.id === recoveryId ||
          objective.id.startsWith(`${recoveryId}:`)
      ) &&
      ![
        "candidate:late-priority-aggregate-rotation",
        "candidate:late-priority-frequency",
      ].some(
        (protectedId) =>
          objective.id === protectedId ||
          objective.id.startsWith(`${protectedId}:`)
      )
  );
  const protectedFairnessObjectives = candidateObjectives.filter((objective) =>
    [
      "candidate:late-priority-aggregate-rotation",
      "candidate:late-priority-frequency",
    ].some(
      (protectedId) =>
        objective.id === protectedId ||
        objective.id.startsWith(`${protectedId}:`)
    )
  );
  const recoveryObjectives = candidateObjectives.filter((objective) =>
    ["candidate:late-shift-recovery", "candidate:late-shift-cutoff"].some(
      (recoveryId) =>
        objective.id === recoveryId || objective.id.startsWith(`${recoveryId}:`)
    )
  );
  const objectives = applyDailyObjectiveOptimality(
    simplifyLexicographicObjectives(
      orderDailyObjectiveBuckets({
        ke166Reservation: ke166ReservationObjectives,
        duty: duty.objectives,
        coverage: coverageObjectives,
        crossWorkdayReservation: crossWorkdayReservation.objectives,
        strictTransition: strictTransitionObjectives,
        crossFlightPriority,
        protectedFairness: protectedFairnessObjectives,
        dutyRelief: duty.reliefObjectives,
        recovery: recoveryObjectives,
        halfRest: halfRest.objectives,
        remainingCandidate: remainingCandidateObjectives,
      })
    )
  );
  return {
    staffChoices,
    vacancyChoices,
    rulePlan,
    halfRestAffectedStaffIdsByTask:
      staffChoiceBuild.halfRestAffectedStaffIdsByTask,
    problem: {
      variables: [
        ...staffChoices.map(({ id }) => ({ id })),
        ...vacancyChoices.map(({ id }) => ({ id })),
        ...staffCoverage.variables,
        ...sameDayLateObligation.variables,
        ...combinations.variables,
        ...workload.variables,
        ...crossWorkdayReservation.variables,
        ...halfRest.variables,
      ],
      constraints: [
        ...assignmentConstraints(
          scheduledTasks,
          staffChoices,
          vacancyChoices,
          strictRecoveryTargetTaskKeys
        ),
        ...combinations.incompatibilityConstraints,
        ...capacityConstraints(state, staffChoices),
        ...staffCoverage.constraints,
        ...sameDayLateObligation.constraints,
        ...combinations.constraints,
        ...workload.constraints,
        ...crossWorkdayReservation.constraints,
        ...duty.constraints,
        ...halfRest.constraints,
      ],
      objectives,
      timeoutMs,
      strategy: "native-lexicographic",
    },
  };
}
