import type { AppState, Assignment, Staff } from "../../model";
import { buildAssignmentDecisionTrace } from "../assignments/assignment-decision-trace";
import { createAssignedPosition } from "../assignments/assignment-factory";
import {
  applyConfiguredEarlyReleases,
  canReleaseForFlight,
} from "../assignments/assignment-timing";
import { diagnoseBaseAssignmentEligibility } from "../candidates/assignment-eligibility";
import {
  buildCandidatePriority,
  compareLatePriorityFrequencyForKind,
  type CandidatePriority,
} from "../candidates/candidate-priority";
import { preNoonShortageNote } from "../coverage/schedule-coverage";
import { isConcurrentSupervisor } from "../coverage/team-leader-concurrent-plan";
import { makeUnfilled } from "../flights/schedule-position-rules";
import {
  isPreNoonFlight,
  isKe166MobileSupervisor,
  type AssignmentTask,
} from "../flights/schedule-tasks";
import {
  compareCandidateRulePlan,
  createCandidateRulePlan,
  firstDifferentCandidateRulePlan,
  type CandidateRulePlanItem,
} from "../rules/candidate-rule-plan";
import {
  hasHighLoadTransition,
  rollingLoadCost,
  violatedPositionTransitionPolicies,
  violatedPositionTransitionPoliciesForInsertion,
} from "../reviews/schedule-protection";
import type {
  LexicographicObjective,
  LinearConstraint,
  SolverPort,
  SolverProblem,
} from "../solver/solver-port";
import { dailyScheduleFailureMessage } from "../solver/solver-user-message";
import { durationHours, intervalsOverlap } from "../shared/time";
import type { SchedulePreparation } from "./schedule-preparation";
import {
  workloadBalanceLoadSnapshots,
  WORKLOAD_BALANCE_MIN_FLIGHTS,
} from "../reviews/workload-balance";
import { isPriorityRotationPosition } from "../reviews/position-rotation-policy";
import { LATE_PRIORITY_FREQUENCY_ORDER } from "../reviews/late-priority-policy";
import { exceedsTr121NumberOneAutomaticLimit } from "../statistics/late-priority-frequency";

const DAILY_SCHEDULE_TIMEOUT_MS = 30_000;

interface StaffChoice {
  id: string;
  task: AssignmentTask;
  person: Staff;
  priority: CandidatePriority;
  workHours: number;
}

interface VacancyChoice {
  id: string;
  task: AssignmentTask;
}

interface DailyScheduleProblem {
  problem: SolverProblem;
  staffChoices: StaffChoice[];
  vacancyChoices: VacancyChoice[];
  workedVariableIds: Map<string, string>;
  rulePlan: CandidateRulePlanItem[];
}

interface SoftCombinationGroup {
  objectiveId: string;
  targets: Map<string, StaffChoice>;
  sources: Map<string, StaffChoice>;
  coefficient: number;
}

interface CombinationModel {
  variables: { id: string }[];
  constraints: LinearConstraint[];
  objectiveTerms: ReadonlyMap<
    string,
    { variableId: string; coefficient: number }[]
  >;
}

interface WorkloadModel {
  variables: SolverProblem["variables"];
  constraints: LinearConstraint[];
  objectives: LexicographicObjective[];
}

export interface DailySchedulePlan {
  assignments: Assignment[];
  lockedAssignmentIds: Set<string>;
  warnings: string[];
}

export interface OptimizeDailyScheduleOptions {
  solver: SolverPort;
  state: AppState;
  date: string;
  preparation: SchedulePreparation;
}

function choiceAssignment(choice: StaffChoice): Assignment {
  return createAssignedPosition(
    choice.task,
    choice.person,
    choice.workHours,
    [],
    []
  );
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
  state: AppState,
  date: string,
  preparation: SchedulePreparation,
  scheduledTasks: readonly AssignmentTask[]
): StaffChoice[] {
  const processedTasks = new Set<string>();
  const dutyTargetTaskKeys = new Set([
    ...(preparation.preferredDutyMorningTaskKey
      ? [preparation.preferredDutyMorningTaskKey]
      : []),
    ...preparation.preferredDutyLateTaskCandidates.map((task) => task.key),
  ]);
  const choices: StaffChoice[] = [];
  for (const task of scheduledTasks) {
    const candidates = state.staff.filter(
      (person) =>
        diagnoseBaseAssignmentEligibility(state, task.flight, task.rule, person)
          .eligible &&
        !exceedsTr121NumberOneAutomaticLimit(
          state,
          person.id,
          task.flight.flightNo,
          task.rule,
          date,
          preparation.runFacts.scheduleFrequency
        )
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
    for (const person of candidates) {
      choices.push({
        id: `staff:${choices.length}`,
        task,
        person,
        priority: priorities.get(person.id)!,
        workHours: minimumChoiceHours(task),
      });
    }
  }
  return choices;
}

function dutyModel(
  preparation: SchedulePreparation,
  staffChoices: readonly StaffChoice[]
): {
  constraints: LinearConstraint[];
  objectives: LexicographicObjective[];
  additionalPriorityObjective?: LexicographicObjective;
} {
  const dutyStaffId = preparation.dutyStaffId;
  if (!dutyStaffId) return { constraints: [], objectives: [] };
  const dutyTargetTaskKeys = new Set([
    ...(preparation.preferredDutyMorningTaskKey
      ? [preparation.preferredDutyMorningTaskKey]
      : []),
    ...preparation.preferredDutyLateTaskCandidates.map((task) => task.key),
  ]);
  const choiceForTask = (taskKey: string): StaffChoice | undefined =>
    staffChoices.find(
      (choice) =>
        choice.task.key === taskKey && choice.person.id === dutyStaffId
    );
  const constraints: LinearConstraint[] = [];
  const morningChoice = preparation.preferredDutyMorningTaskKey
    ? choiceForTask(preparation.preferredDutyMorningTaskKey)
    : undefined;
  if (morningChoice) {
    constraints.push({
      id: "duty:morning",
      terms: [{ variableId: morningChoice.id, coefficient: 1 }],
      lowerBound: 1,
      upperBound: 1,
    });
  }
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
  return {
    constraints,
    objectives: lateChoices.length
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
      : [],
    additionalPriorityObjective: {
      id: "duty:avoid-additional-priority",
      direction: "minimize",
      terms: staffChoices.flatMap((choice) =>
        choice.person.id === dutyStaffId &&
        !dutyTargetTaskKeys.has(choice.task.key) &&
        isPriorityRotationPosition(choice.task.rule)
          ? [{ variableId: choice.id, coefficient: 1 }]
          : []
      ),
    },
  };
}

function assignmentConstraints(
  tasks: readonly AssignmentTask[],
  staffChoices: readonly StaffChoice[],
  vacancyChoices: readonly VacancyChoice[]
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
    ],
    lowerBound: 1,
    upperBound: 1,
  }));
}

function choicesCanShareStaff(
  state: AppState,
  left: StaffChoice,
  right: StaffChoice
): boolean {
  if (
    !intervalsOverlap(
      left.task.flight.startTime,
      left.task.flight.endTime,
      right.task.flight.startTime,
      right.task.flight.endTime
    )
  )
    return true;
  if (
    isConcurrentSupervisor(left.task.rule, left.task.flight) &&
    isConcurrentSupervisor(right.task.rule, right.task.flight)
  )
    return false;
  const leftAssignment = choiceAssignment(left);
  const rightAssignment = choiceAssignment(right);
  return (
    canReleaseForFlight(leftAssignment, right.task.flight, state) ||
    canReleaseForFlight(rightAssignment, left.task.flight, state)
  );
}

function incompatibilityConstraints(
  state: AppState,
  staffChoices: readonly StaffChoice[]
): LinearConstraint[] {
  const constraints: LinearConstraint[] = [];
  const choicesByStaffId = new Map<string, StaffChoice[]>();
  for (const choice of staffChoices) {
    const own = choicesByStaffId.get(choice.person.id) ?? [];
    own.push(choice);
    choicesByStaffId.set(choice.person.id, own);
  }
  for (const ownChoices of choicesByStaffId.values()) {
    const choicesByFlightId = new Map<string, StaffChoice[]>();
    for (const choice of ownChoices) {
      const flightChoices = choicesByFlightId.get(choice.task.flight.id) ?? [];
      flightChoices.push(choice);
      choicesByFlightId.set(choice.task.flight.id, flightChoices);
    }
    const flightChoiceGroups = [...choicesByFlightId.values()];
    for (const flightChoices of flightChoiceGroups) {
      if (flightChoices.length < 2) continue;
      constraints.push({
        id: `same-flight:${constraints.length}`,
        terms: flightChoices.map((choice) => ({
          variableId: choice.id,
          coefficient: 1,
        })),
        upperBound: 1,
      });
    }
    for (
      let leftGroupIndex = 0;
      leftGroupIndex < flightChoiceGroups.length;
      leftGroupIndex += 1
    ) {
      for (
        let rightGroupIndex = leftGroupIndex + 1;
        rightGroupIndex < flightChoiceGroups.length;
        rightGroupIndex += 1
      ) {
        const leftChoices = flightChoiceGroups[leftGroupIndex]!;
        const rightChoices = flightChoiceGroups[rightGroupIndex]!;
        const incompatiblePairs: Array<readonly [StaffChoice, StaffChoice]> =
          [];
        for (const left of leftChoices) {
          for (const right of rightChoices) {
            if (!choicesCanShareStaff(state, left, right))
              incompatiblePairs.push([left, right]);
          }
        }
        if (!incompatiblePairs.length) continue;
        if (
          incompatiblePairs.length ===
          leftChoices.length * rightChoices.length
        ) {
          constraints.push({
            id: `overlap:${constraints.length}`,
            terms: [...leftChoices, ...rightChoices].map((choice) => ({
              variableId: choice.id,
              coefficient: 1,
            })),
            upperBound: 1,
          });
          continue;
        }
        for (const [left, right] of incompatiblePairs) {
          constraints.push({
            id: `overlap:${constraints.length}`,
            terms: [left.id, right.id].map((variableId) => ({
              variableId,
              coefficient: 1,
            })),
            upperBound: 1,
          });
        }
      }
    }
  }
  return constraints;
}

function capacityConstraints(
  state: AppState,
  staffChoices: readonly StaffChoice[]
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

function combinationModel(
  state: AppState,
  staffChoices: readonly StaffChoice[],
  enabledObjectiveIds: ReadonlySet<string>
): CombinationModel {
  const variables: Array<SolverProblem["variables"][number]> = [];
  const constraints: LinearConstraint[] = [];
  const objectiveTerms = new Map<
    string,
    { variableId: string; coefficient: number }[]
  >();
  const addObjectiveTerm = (
    objectiveId: string,
    variableId: string,
    coefficient: number
  ): void => {
    if (!coefficient) return;
    const terms = objectiveTerms.get(objectiveId) ?? [];
    terms.push({ variableId, coefficient });
    objectiveTerms.set(objectiveId, terms);
  };
  const choicesByStaffId = new Map<string, StaffChoice[]>();
  for (const choice of staffChoices) {
    const own = choicesByStaffId.get(choice.person.id) ?? [];
    own.push(choice);
    choicesByStaffId.set(choice.person.id, own);
  }
  const groups = new Map<string, SoftCombinationGroup>();
  const addGroupSource = (
    key: string,
    objectiveId: string,
    target: StaffChoice,
    source: StaffChoice,
    coefficient: number
  ): void => {
    const group = groups.get(key) ?? {
      objectiveId,
      targets: new Map<string, StaffChoice>(),
      sources: new Map<string, StaffChoice>(),
      coefficient,
    };
    group.targets.set(target.id, target);
    group.sources.set(source.id, source);
    groups.set(key, group);
  };
  for (const ownChoices of choicesByStaffId.values()) {
    for (const target of ownChoices) {
      for (const source of ownChoices) {
        if (
          source.id === target.id ||
          !choicesCanShareStaff(state, source, target)
        )
          continue;
        const sourceAssignment = choiceAssignment(source);
        for (const policy of violatedPositionTransitionPolicies(
          [sourceAssignment],
          target.person.id,
          target.task.flight.flightNo,
          target.task.rule.name,
          target.task.flight.startTime,
          state,
          "forbid"
        )) {
          if (
            !isPreNoonFlight(target.task.flight) &&
            target.priority.dutyPosition !== "reserved-target"
          ) {
            constraints.push({
              id: `strict-transition:${constraints.length}`,
              terms: [target.id, source.id].map((variableId) => ({
                variableId,
                coefficient: 1,
              })),
              upperBound: 1,
            });
          } else {
            addGroupSource(
              `forbid:${target.id}:${policy.id}`,
              "candidate:position-transition",
              target,
              source,
              1
            );
          }
        }
        for (const policy of violatedPositionTransitionPolicies(
          [sourceAssignment],
          target.person.id,
          target.task.flight.flightNo,
          target.task.rule.name,
          target.task.flight.startTime,
          state,
          "prefer"
        )) {
          addGroupSource(
            `prefer:${target.id}:${policy.id}`,
            "candidate:preferred-position-transition",
            target,
            source,
            1
          );
        }
        if (
          hasHighLoadTransition(
            [sourceAssignment],
            target.person.id,
            target.task.flight.startTime,
            target.task.flight.endTime,
            target.task.rule.fatiguePoints,
            target.task.rule.remark,
            state
          )
        ) {
          addGroupSource(
            `high-load:${target.person.id}:${target.task.flight.startTime}:${target.task.flight.endTime}`,
            "candidate:high-load-recovery",
            target,
            source,
            1
          );
        }
        const rollingExcess = rollingLoadCost(
          [sourceAssignment],
          target.person.id,
          target.task.flight.startTime,
          target.task.rule.fatiguePoints,
          target.task.rule.remark,
          state
        );
        if (rollingExcess) {
          addGroupSource(
            `rolling:${target.person.id}:${target.task.flight.startTime}:${target.task.rule.fatiguePoints}:${rollingExcess}`,
            "candidate:rolling-load",
            target,
            source,
            rollingExcess
          );
        }
      }
    }
  }
  const signatureForGroup = (group: SoftCombinationGroup): string =>
    `${[...group.targets.keys()].sort().join(",")}|${[...group.sources.keys()]
      .sort()
      .join(",")}`;
  const variableIdBySignature = new Map<string, string>();
  for (const group of groups.values()) {
    const signature = signatureForGroup(group);
    if (!variableIdBySignature.has(signature))
      variableIdBySignature.set(
        signature,
        `combination:${variableIdBySignature.size}`
      );
  }
  const enabledVariableIds = new Set<string>();
  for (const group of groups.values()) {
    if (!enabledObjectiveIds.has(group.objectiveId)) continue;
    const targetIds = [...group.targets.keys()];
    const variableId = variableIdBySignature.get(signatureForGroup(group))!;
    if (enabledVariableIds.has(variableId)) {
      addObjectiveTerm(group.objectiveId, variableId, group.coefficient);
      continue;
    }
    enabledVariableIds.add(variableId);
    const sourcesByFlightId = new Map<string, StaffChoice[]>();
    for (const source of group.sources.values()) {
      const ownSources = sourcesByFlightId.get(source.task.flight.id) ?? [];
      ownSources.push(source);
      sourcesByFlightId.set(source.task.flight.id, ownSources);
    }
    variables.push({
      id: variableId,
      type: "continuous",
      lowerBound: 0,
      upperBound: 1,
    });
    constraints.push(
      ...[...sourcesByFlightId.values()].map((sourceChoices, index) => ({
        id: `${variableId}:source-flight:${index}`,
        terms: [
          { variableId, coefficient: 1 },
          ...targetIds.map((targetId) => ({
            variableId: targetId,
            coefficient: -1,
          })),
          ...sourceChoices.map((source) => ({
            variableId: source.id,
            coefficient: -1,
          })),
        ],
        lowerBound: -1,
      }))
    );
    addObjectiveTerm(group.objectiveId, variableId, group.coefficient);
  }
  return { variables, constraints, objectiveTerms };
}

function withCombinationObjectives(
  objectives: readonly LexicographicObjective[],
  combination: CombinationModel
): LexicographicObjective[] {
  return objectives.map((objective) => ({
    ...objective,
    terms: [
      ...objective.terms,
      ...(combination.objectiveTerms.get(objective.id) ?? []),
    ],
  }));
}

function staffCoverageModel(
  state: AppState,
  staffChoices: readonly StaffChoice[]
): {
  variables: { id: string }[];
  constraints: LinearConstraint[];
  workedVariableIds: Map<string, string>;
} {
  const workedVariableIds = new Map<string, string>();
  const variables: { id: string }[] = [];
  const constraints: LinearConstraint[] = [];
  for (const person of state.staff.filter(
    (item) => item.status === "正常" && item.staffType === "常规"
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
  state: AppState,
  date: string,
  preparation: SchedulePreparation,
  staffChoices: readonly StaffChoice[]
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
    coefficient: (choice: StaffChoice) => number,
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
    },
    {
      id: "candidate:workload-balance:today-hours-excess",
      direction: "minimize",
      terms: [{ variableId: today.excessId, coefficient: 1 }],
    },
    {
      id: "candidate:workload-balance:rolling-hours-excess",
      direction: "minimize",
      terms: [{ variableId: rolling.excessId, coefficient: 1 }],
    },
    ...[
      {
        id: "candidate:workload-balance:today-fatigue-excess",
        direction: "minimize" as const,
        terms: [{ variableId: fatigue.excessId, coefficient: 1 }],
      },
      {
        id: "candidate:workload-balance:today-hours-spread",
        direction: "minimize" as const,
        terms: [{ variableId: today.spreadId, coefficient: 1 }],
        solveOnlyWhen: {
          objectiveId: "candidate:workload-balance:today-hours-excess",
          equals: 0,
        },
      },
      {
        id: "candidate:workload-balance:rolling-hours-spread",
        direction: "minimize" as const,
        terms: [{ variableId: rolling.spreadId, coefficient: 1 }],
        solveOnlyWhen: {
          objectiveId: "candidate:workload-balance:rolling-hours-excess",
          equals: 0,
        },
      },
      {
        id: "candidate:workload-balance:today-fatigue-spread",
        direction: "minimize" as const,
        terms: [{ variableId: fatigue.spreadId, coefficient: 1 }],
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
    (objective) => objective.id === "candidate:historical-fatigue"
  );
  const index = insertionIndex < 0 ? withoutStatic.length : insertionIndex;
  return [
    ...withoutStatic.slice(0, index),
    ...workloadObjectives,
    ...withoutStatic.slice(index),
  ];
}

function candidateRuleObjectives(
  state: AppState,
  tasks: readonly AssignmentTask[],
  choices: readonly StaffChoice[],
  rulePlan: readonly CandidateRulePlanItem[],
  workedVariableIds: ReadonlyMap<string, string>
): LexicographicObjective[] {
  const objectives = rulePlan.flatMap<LexicographicObjective>((rule) => {
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
      rule.id === "late-priority-frequency"
        ? LATE_PRIORITY_FREQUENCY_ORDER.map((kind) => ({
            id: `candidate:${rule.id}:${kind}`,
            execute: (left: StaffChoice, right: StaffChoice) =>
              compareLatePriorityFrequencyForKind(
                left.priority,
                right.priority,
                kind
              ),
          }))
        : [
            {
              id: `candidate:${rule.id}`,
              execute: (left: StaffChoice, right: StaffChoice) =>
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
        terms: choices.flatMap((choice) => {
          const coefficient = rankByChoiceId.get(choice.id) ?? 0;
          return coefficient ? [{ variableId: choice.id, coefficient }] : [];
        }),
      };
    });
  });
  const deferredIds = new Set([
    "candidate:scarce-qualification",
    "candidate:same-day-late-obligation",
  ]);
  const deferred = objectives.filter((objective) =>
    deferredIds.has(objective.id)
  );
  const ordered = objectives.filter(
    (objective) => !deferredIds.has(objective.id)
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
    return [{ ...objective, terms }];
  });
  const first = simplified[0];
  if (!first) throw new Error("当天整体排班没有可执行的求解目标");
  return [first, ...simplified.slice(1)];
}

function buildDailyScheduleProblem(
  state: AppState,
  date: string,
  preparation: SchedulePreparation,
  scheduledTasks: readonly AssignmentTask[],
  timeoutMs: number
): DailyScheduleProblem {
  const rulePlan = createCandidateRulePlan(state.settings);
  const staffChoices = staffChoicesForTasks(
    state,
    date,
    preparation,
    scheduledTasks
  );
  const vacancyChoices = scheduledTasks.map((task, index) => ({
    id: `vacancy:${index}`,
    task,
  }));
  const staffCoverage = staffCoverageModel(state, staffChoices);
  const workload = workloadModel(state, date, preparation, staffChoices);
  const combinations = combinationModel(
    state,
    staffChoices,
    new Set(rulePlan.map((rule) => `candidate:${rule.id}`))
  );
  const duty = dutyModel(preparation, staffChoices);
  const maximumEligibleCount = Math.max(
    1,
    ...scheduledTasks.map(
      (task) => preparation.eligibleCounts.get(task.key) ?? 0
    )
  );
  const preNoonScarcityTerms = vacancyChoices.map((choice) => ({
    variableId: choice.id,
    coefficient: isPreNoonFlight(choice.task.flight)
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
        coefficient: isPreNoonFlight(choice.task.flight) ? 1 : 0,
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
    withCombinationObjectives(
      candidateRuleObjectives(
        state,
        scheduledTasks,
        staffChoices,
        rulePlan,
        staffCoverage.workedVariableIds
      ),
      combinations
    ),
    workload.objectives
  );
  const ke166ReservationObjectives = candidateObjectives.filter(
    (objective) => objective.id === "candidate:ke166-supervisor"
  );
  const remainingCandidateObjectives = candidateObjectives.filter(
    (objective) => objective.id !== "candidate:ke166-supervisor"
  );
  const objectives = simplifyLexicographicObjectives([
    ...ke166ReservationObjectives,
    ...duty.objectives,
    ...coverageObjectives,
    ...(duty.additionalPriorityObjective?.terms.length
      ? [duty.additionalPriorityObjective]
      : []),
    ...remainingCandidateObjectives,
  ]);
  return {
    staffChoices,
    vacancyChoices,
    workedVariableIds: staffCoverage.workedVariableIds,
    rulePlan,
    problem: {
      variables: [
        ...staffChoices.map(({ id }) => ({ id })),
        ...vacancyChoices.map(({ id }) => ({ id })),
        ...staffCoverage.variables,
        ...combinations.variables,
        ...workload.variables,
      ],
      constraints: [
        ...assignmentConstraints(scheduledTasks, staffChoices, vacancyChoices),
        ...incompatibilityConstraints(state, staffChoices),
        ...capacityConstraints(state, staffChoices),
        ...staffCoverage.constraints,
        ...combinations.constraints,
        ...workload.constraints,
        ...duty.constraints,
      ],
      objectives,
      timeoutMs,
      strategy: "native-lexicographic",
    },
  };
}

function attachDecisionTraces(
  state: AppState,
  date: string,
  preparation: SchedulePreparation,
  problem: DailyScheduleProblem,
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
    const taskChoices = problem.staffChoices.filter(
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
          problem.rulePlan,
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
        problem.rulePlan,
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
      candidateRulePlan: problem.rulePlan,
      decisiveCandidateRule:
        selectedBeatsRunnerUp && runnerUp
          ? firstDifferentCandidateRulePlan(
              problem.rulePlan,
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
  problem: DailyScheduleProblem,
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
        problem.staffChoices.some(
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
        problem.staffChoices
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
  problem: DailyScheduleProblem
): Assignment[] {
  const assignments = problem.staffChoices.flatMap((choice) =>
    selectedVariableIds.has(choice.id) ? [choiceAssignment(choice)] : []
  );
  assignments.push(
    ...problem.vacancyChoices.flatMap((choice) =>
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

export async function optimizeDailySchedule({
  solver,
  state,
  date,
  preparation,
}: OptimizeDailyScheduleOptions): Promise<DailySchedulePlan> {
  const scheduledTasks = preparation.tasks.filter(
    (task) => !isKe166MobileSupervisor(task.flight, task.rule)
  );
  if (!scheduledTasks.length)
    return { assignments: [], lockedAssignmentIds: new Set(), warnings: [] };
  const deadline = Date.now() + DAILY_SCHEDULE_TIMEOUT_MS;
  const dailyProblem = buildDailyScheduleProblem(
    state,
    date,
    preparation,
    scheduledTasks,
    DAILY_SCHEDULE_TIMEOUT_MS
  );
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("当天整体排班计算超过30秒，请重试");
  const result = await solver.solve({
    ...dailyProblem.problem,
    timeoutMs: remainingMs,
  });
  if (result.termination !== "optimal")
    throw new Error(dailyScheduleFailureMessage(result.termination));
  const assignments = decodeAssignments(
    result.selectedVariableIds,
    dailyProblem
  );
  applyConfiguredEarlyReleases(assignments, state);
  attachDecisionTraces(state, date, preparation, dailyProblem, assignments);
  attachVacancyEvidence(state, preparation, dailyProblem, assignments);
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
  const warnings = assignments.flatMap((assignment) =>
    assignment.status === "unfilled"
      ? [`${assignment.flightNo} / ${assignment.position} 无可用人员`]
      : []
  );
  return {
    assignments,
    lockedAssignmentIds,
    warnings,
  };
}
