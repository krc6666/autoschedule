import { describe, expect, it, vi } from "vitest";

import { buildDailyScheduleModel } from "../../src/domain/kernel/daily-schedule-model";
import { optimizeDailySchedule } from "../../src/domain/kernel/daily-schedule-optimizer";
import { materializeDailySchedulePlan } from "../../src/domain/kernel/daily-schedule-result";
import { prepareSchedule } from "../../src/domain/kernel/schedule-preparation";
import { evaluateAutomaticHardConstraints } from "../../src/domain/rules/built-in-rule-registry";
import type {
  SolverPort,
  SolverProblem,
} from "../../src/domain/solver/solver-port";
import type { Flight, PositionRule } from "../../src/model";
import type { ScheduleGenerationFacts } from "../../src/domain/shared/scheduling-facts";
import { createSchedulingScenario } from "../helpers/scheduling-scenario";
import { generateSchedule } from "../helpers/generate-schedule";

class ModelCaptured extends Error {}

class CapturingSolver implements SolverPort {
  problem: SolverProblem | undefined;

  async solve(problem: SolverProblem): Promise<never> {
    this.problem = problem;
    throw new ModelCaptured();
  }
}

class TimeLimitedFairnessSolver implements SolverPort {
  async solve(problem: SolverProblem) {
    const stoppedObjective = problem.objectives.find(
      (objective) => objective.optimality === "best-effort"
    )!;
    return {
      termination: "time-limited-feasible" as const,
      selectedVariableIds: new Set(
        problem.variables
          .filter((variable) => variable.id.startsWith("vacancy:"))
          .map((variable) => variable.id)
      ),
      objectiveValues: new Map<string, number>(),
      bestEffort: {
        stoppedAtObjectiveId: stoppedObjective.id,
        completedObjectiveIds: problem.objectives
          .filter((objective) => objective.optimality !== "best-effort")
          .map((objective) => objective.id),
        solutionSource: "current-incumbent" as const,
      },
    };
  }
}

class IncompleteRequiredFairnessSolver implements SolverPort {
  async solve(problem: SolverProblem) {
    return {
      termination: "time-limited-feasible" as const,
      selectedVariableIds: new Set([problem.variables[0]!.id]),
      objectiveValues: new Map<string, number>(),
      bestEffort: {
        stoppedAtObjectiveId: "candidate:workload-balance:target",
        completedObjectiveIds: [],
        solutionSource: "current-incumbent" as const,
      },
    };
  }
}

class DuplicateTaskSelectionSolver implements SolverPort {
  async solve(problem: SolverProblem) {
    return {
      termination: "optimal" as const,
      selectedVariableIds: new Set(
        problem.variables
          .filter((variable) => variable.id.startsWith("staff:"))
          .map((variable) => variable.id)
      ),
      objectiveValues: new Map<string, number>(),
    };
  }
}

function flight(
  id: string,
  flightNo: string,
  startTime: string,
  endTime: string,
  positions: string[]
): Flight {
  return {
    id,
    flightNo,
    startTime,
    endTime,
    bookedPassengers: 200,
    positions,
    remark: "",
  };
}

function modelState(
  flights: readonly Flight[],
  ruleOptions?: (rule: PositionRule) => PositionRule
): ScheduleGenerationFacts {
  const state = createSchedulingScenario();
  const person = {
    ...state.staff[0]!,
    id: "worker",
    name: "测试人员",
    status: "正常" as const,
    staffType: "常规" as const,
    dutyQualified: false,
    nightShift: true,
  };
  const baseRule = state.positionRules[0]!;
  state.staff = [person];
  state.flights = [...flights];
  state.positionRules = flights.flatMap((ownFlight) =>
    ownFlight.positions.map((position, index) => {
      const rule: PositionRule = {
        ...baseRule,
        id: `${ownFlight.id}-rule-${index}`,
        flightNo: ownFlight.flightNo,
        name: position,
        category: "常规",
        remark: "",
        qualifiedStaffIds: [person.id],
        fatiguePoints: 1,
        minPassengers: 0,
        earlyReleaseMinutes: 0,
        manual: false,
      };
      return ruleOptions?.(rule) ?? rule;
    })
  );
  state.history = [];
  state.dutyRosterOverrides = [];
  state.settings.positionTransitionPolicies = [];
  return state;
}

async function captureProblem(
  state: ScheduleGenerationFacts
): Promise<SolverProblem> {
  const date = "2026-08-03";
  const solver = new CapturingSolver();
  const preparation = prepareSchedule(
    state,
    date,
    evaluateAutomaticHardConstraints
  );

  await expect(
    optimizeDailySchedule({ solver, state, date, preparation })
  ).rejects.toBeInstanceOf(ModelCaptured);
  return solver.problem!;
}

describe("daily schedule module interfaces", () => {
  it("uses the confirmed 150-second deadline for the daily solver", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const problem = await captureProblem(
        modelState([flight("only", "AA100", "08:00", "10:00", ["A1"])])
      );

      expect(problem.timeoutMs).toBe(150_000);
    } finally {
      now.mockRestore();
    }
  });

  it("uses the bounded five-minute deadline for the current manual late-priority ledger", async () => {
    const state = modelState([
      flight("late", "LATE100", "21:00", "23:30", ["H04"]),
    ]);
    state.settings.latePriorityFlightNumbers = ["LATE100"];
    state.positionRules[0]!.remark = "申报";
    state.latePriorityFrequencyAdjustments = [
      {
        month: "2026-08",
        staffId: state.staff[0]!.id,
        flightNo: "LATE100",
        kind: "declaration",
        delta: 10,
      },
      {
        month: "2026-07",
        staffId: state.staff[0]!.id,
        flightNo: "LATE100",
        kind: "declaration",
        delta: 10,
      },
    ];
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const problem = await captureProblem(state);
      expect(problem.timeoutMs).toBe(300_000);
      state.latePriorityFrequencyAdjustments =
        state.latePriorityFrequencyAdjustments.filter(
          (adjustment) => adjustment.month === "2026-07"
        );
      const historicalOnlyProblem = await captureProblem(state);
      expect(historicalOnlyProblem.timeoutMs).toBe(150_000);
    } finally {
      now.mockRestore();
    }
  });

  it("turns configured next-workday recovery targets into strict model constraints", () => {
    const date = "2026-08-03";
    const state = modelState(
      [flight("target", "CX937", "06:00", "08:00", ["G18"])],
      (rule) => ({ ...rule, remark: "控制" })
    );
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.nextWorkdayRecoveryMode = "forbid";
    state.settings.nextWorkdayRecoveryTargets = [
      {
        id: "strict-control",
        enabled: true,
        flightNo: "CX937",
        positionKeyword: "控制",
      },
    ];
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "previous-one",
        enabled: true,
        flightNo: "TR121",
        matchField: "remark",
        keyword: "一号",
        nextWorkdayCutoffTime: "",
      },
    ];
    state.history = [
      {
        id: "previous-late",
        date: "2026-08-01",
        flightNo: "TR121",
        position: "H02",
        staffId: "worker",
        staffName: "测试人员",
        startTime: "20:00",
        endTime: "23:55",
        workHours: 3.9,
        fatiguePoints: 8,
        remark: "一号",
      },
    ];
    const preparation = prepareSchedule(
      state,
      date,
      evaluateAutomaticHardConstraints
    );
    const model = buildDailyScheduleModel({
      state,
      date,
      preparation,
      timeoutMs: 30_000,
    })!;

    expect(model.staffChoices).toEqual([]);
    expect(
      model.problem.constraints.find(
        (constraint) => constraint.id === "assignment:0"
      )?.terms
    ).toEqual([]);
  });

  it("does not force a vacancy when protected staff lack the target qualification", () => {
    const date = "2026-08-03";
    const state = modelState(
      [flight("target", "CX937", "06:00", "08:00", ["G18"])],
      (rule) => ({ ...rule, remark: "控制", qualifiedStaffIds: ["other"] })
    );
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.nextWorkdayRecoveryMode = "forbid";
    state.settings.nextWorkdayRecoveryTargets = [
      {
        id: "strict-control",
        enabled: true,
        flightNo: "CX937",
        positionKeyword: "控制",
      },
    ];
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "previous-one",
        enabled: true,
        flightNo: "TR121",
        matchField: "remark",
        keyword: "一号",
        nextWorkdayCutoffTime: "",
      },
    ];
    state.history = [
      {
        id: "previous-late",
        date: "2026-08-01",
        flightNo: "TR121",
        position: "H02",
        staffId: "worker",
        staffName: "测试人员",
        startTime: "20:00",
        endTime: "23:55",
        workHours: 3.9,
        fatiguePoints: 8,
        remark: "一号",
      },
    ];
    state.staff.push({ ...state.staff[0]!, id: "other", name: "合格替代" });
    const preparation = prepareSchedule(
      state,
      date,
      evaluateAutomaticHardConstraints
    );
    const model = buildDailyScheduleModel({
      state,
      date,
      preparation,
      timeoutMs: 30_000,
    })!;
    expect(
      model.staffChoices.some((choice) => choice.person.id === "other")
    ).toBe(true);
    expect(
      model.problem.constraints.find(
        (constraint) => constraint.id === "assignment:0"
      )?.terms
    ).toHaveLength(2);
  });

  it("adds a cross-flight protection objective for an overlapping non-priority task", () => {
    const state = modelState([
      flight("ke", "KE166", "08:00", "10:00", ["H02"]),
      flight("cx", "CX931", "08:00", "10:00", ["G20"]),
    ]);
    state.settings.crossFlightPriorityPolicies = [
      {
        id: "priority-1",
        enabled: true,
        flightNo: "KE166",
        positions: ["H02"],
      },
    ];
    const preparation = prepareSchedule(
      state,
      "2026-08-03",
      evaluateAutomaticHardConstraints
    );
    const model = buildDailyScheduleModel({
      state,
      date: "2026-08-03",
      preparation,
      timeoutMs: 30_000,
    });
    const objective = model?.problem.objectives.find(
      (item) => item.id === "cross-flight-priority:priority-1"
    );
    expect(
      objective?.terms.some(
        (term) =>
          model?.staffChoices.find((choice) => choice.id === term.variableId)
            ?.task.flight.flightNo === "CX931"
      )
    ).toBe(true);
    state.settings.crossFlightPriorityPolicies = [];
    const withoutPolicy = buildDailyScheduleModel({
      state,
      date: "2026-08-03",
      preparation,
      timeoutMs: 30_000,
    });
    expect(
      withoutPolicy?.problem.objectives.some((item) =>
        item.id.startsWith("cross-flight-priority:")
      )
    ).toBe(false);
  });

  it("adds hard same-airline control/number-one separation across all later flights", () => {
    const state = modelState(
      [
        flight("morning", "FD101", "08:00", "10:00", ["P1"]),
        flight("afternoon", "FD202", "15:00", "17:00", ["P1"]),
      ],
      (rule) => ({
        ...rule,
        remark: "控制",
        qualifiedStaffIds: ["worker", "worker-2"],
      })
    );
    state.staff.push({ ...state.staff[0]!, id: "worker-2", name: "替代人员" });

    const preparation = prepareSchedule(
      state,
      "2026-08-03",
      evaluateAutomaticHardConstraints
    );
    const model = buildDailyScheduleModel({
      state,
      date: "2026-08-03",
      preparation,
      timeoutMs: 30_000,
    })!;

    const morningChoice = model.staffChoices.find(
      (choice) =>
        choice.task.flight.flightNo === "FD101" && choice.person.id === "worker"
    )!;
    const afternoonChoice = model.staffChoices.find(
      (choice) =>
        choice.task.flight.flightNo === "FD202" && choice.person.id === "worker"
    )!;
    expect(
      model.problem.constraints.some(
        (constraint) =>
          constraint.id.startsWith("same-airline-priority:") &&
          constraint.terms
            .map((term) => term.variableId)
            .includes(morningChoice.id) &&
          constraint.terms
            .map((term) => term.variableId)
            .includes(afternoonChoice.id) &&
          constraint.upperBound === 1
      )
    ).toBe(true);
  });

  it("records why another overlapping flight yielded to a protected position", () => {
    const state = modelState([
      flight("ke", "KE166", "08:00", "10:00", ["H02"]),
      flight("cx", "CX931", "08:00", "10:00", ["G20"]),
    ]);
    state.staff.push({ ...state.staff[0]!, id: "worker-2", name: "替代人员" });
    state.positionRules.forEach((rule) => {
      rule.qualifiedStaffIds = ["worker", "worker-2"];
    });
    state.settings.crossFlightPriorityPolicies = [
      {
        id: "priority-1",
        enabled: true,
        flightNo: "KE166",
        positions: ["H02"],
      },
    ];
    const date = "2026-08-03";
    const preparation = prepareSchedule(
      state,
      date,
      evaluateAutomaticHardConstraints
    );
    const model = buildDailyScheduleModel({
      state,
      date,
      preparation,
      timeoutMs: 30_000,
    })!;
    const keChoice = model.staffChoices.find(
      (choice) =>
        choice.task.flight.flightNo === "KE166" && choice.person.id === "worker"
    )!;
    const cxChoice = model.staffChoices.find(
      (choice) =>
        choice.task.flight.flightNo === "CX931" &&
        choice.person.id === "worker-2"
    )!;
    const plan = materializeDailySchedulePlan({
      state,
      date,
      preparation,
      model,
      selectedVariableIds: new Set([keChoice.id, cxChoice.id]),
    });
    expect(
      plan.assignments.find((assignment) => assignment.flightNo === "KE166")
        ?.decisionTrace
    ).toContainEqual(
      expect.objectContaining({
        ruleId: "cross-flight-priority",
        outcome: "preserved",
        message: expect.stringContaining(
          "如有同等或更优替代人员，可在完整安全复核后调整"
        ),
      })
    );
  });

  it("materializes the selected model choice through the result module", () => {
    const date = "2026-08-03";
    const state = modelState([
      flight("only", "AA100", "08:00", "10:00", ["A1"]),
    ]);
    const preparation = prepareSchedule(
      state,
      date,
      evaluateAutomaticHardConstraints
    );
    const model = buildDailyScheduleModel({
      state,
      date,
      preparation,
      timeoutMs: 30_000,
    });

    expect(model).not.toBeNull();
    const selectedChoice = model!.staffChoices[0]!;
    const plan = materializeDailySchedulePlan({
      state,
      date,
      preparation,
      model: model!,
      selectedVariableIds: new Set([selectedChoice.id]),
    });

    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]).toMatchObject({
      flightId: selectedChoice.task.flight.id,
      positionRuleId: selectedChoice.task.rule.id,
      staffId: selectedChoice.person.id,
      status: "assigned",
    });
    expect(plan.lockedAssignmentIds).toEqual(new Set());
    expect(plan.warnings).toEqual([]);
  });

  it("accepts a complete time-limited fairness solution as a structured outcome", async () => {
    const date = "2026-08-03";
    const state = modelState([
      flight("first", "AA100", "08:00", "10:00", ["A1"]),
      flight("second", "BB200", "08:00", "10:00", ["B1"]),
      flight("third", "CC300", "08:00", "10:00", ["C1"]),
      flight("fourth", "DD400", "08:00", "10:00", ["D1"]),
    ]);
    const secondWorker = {
      ...state.staff[0]!,
      id: "second-worker",
      name: "第二名测试人员",
    };
    state.staff.push(secondWorker);
    state.positionRules.forEach((rule) =>
      rule.qualifiedStaffIds.push(secondWorker.id)
    );
    const preparation = prepareSchedule(
      state,
      date,
      evaluateAutomaticHardConstraints
    );

    const plan = await optimizeDailySchedule({
      solver: new TimeLimitedFairnessSolver(),
      state,
      date,
      preparation,
    });

    expect(plan.assignments).toHaveLength(4);
    expect(plan.optimizationQuality).toBe("fairness-time-limited");
  });

  it("rejects a time-limited solution when any required objective is not proven complete", async () => {
    const date = "2026-08-03";
    const state = modelState([
      flight("only", "AA100", "08:00", "10:00", ["A1"]),
    ]);
    const preparation = prepareSchedule(
      state,
      date,
      evaluateAutomaticHardConstraints
    );

    await expect(
      optimizeDailySchedule({
        solver: new IncompleteRequiredFairnessSolver(),
        state,
        date,
        preparation,
      })
    ).rejects.toThrow("关键排班规则未全部完成");
  });

  it("rejects a solver selection that materializes more than one result for an automatic task", async () => {
    const date = "2026-08-03";
    const state = modelState([
      flight("only", "AA100", "08:00", "10:00", ["A1"]),
    ]);
    const secondWorker = {
      ...state.staff[0]!,
      id: "second-worker",
      name: "第二名测试人员",
    };
    state.staff.push(secondWorker);
    state.positionRules[0]!.qualifiedStaffIds.push(secondWorker.id);
    const preparation = prepareSchedule(
      state,
      date,
      evaluateAutomaticHardConstraints
    );

    await expect(
      optimizeDailySchedule({
        solver: new DuplicateTaskSelectionSolver(),
        state,
        date,
        preparation,
      })
    ).rejects.toThrow("最终安全复核未通过");
  });
});

describe("daily schedule conflict constraints", () => {
  it("minimizes diversion usage after completing all configured positions", async () => {
    const problem = await captureProblem(
      modelState(
        [
          flight("left", "AA100", "21:05", "23:05", ["P1"]),
          flight("right", "BB200", "22:10", "00:10", ["P2"]),
        ],
        (rule) =>
          rule.name === "P1"
            ? { ...rule, category: "分流", earlyReleaseMinutes: 60 }
            : rule
      )
    );
    const diversionIndex = problem.objectives.findIndex(
      (objective) =>
        objective.id === "minimum-flight-transition:diversion-usage"
    );
    const vacancyIndex = problem.objectives.findIndex(
      (objective) => objective.id === "all-vacancies"
    );

    expect(diversionIndex).toBeGreaterThan(vacancyIndex);
    expect(problem.objectives[diversionIndex]!.direction).toBe("minimize");
    expect(problem.objectives[diversionIndex]!.terms.length).toBeGreaterThan(0);
  });

  it("adds one hard incompatibility for flight groups below the global transition gap", async () => {
    const state = modelState([
      flight("left", "AA100", "08:00", "10:00", ["A1", "A2"]),
      flight("right", "BB200", "11:29", "13:00", ["B1", "B2"]),
    ]);
    state.settings.minimumRegularTransitionMinutes = 90;

    const problem = await captureProblem(state);
    const constraints = problem.constraints.filter((constraint) =>
      constraint.id.startsWith("minimum-transition:")
    );

    expect(constraints).toHaveLength(1);
    expect(constraints[0]).toMatchObject({ upperBound: 1 });
    expect(constraints[0]!.terms).toHaveLength(4);
  });

  it("compresses two fully incompatible flight groups into one clique", async () => {
    const problem = await captureProblem(
      modelState([
        flight("left", "AA100", "08:00", "10:00", ["A1", "A2"]),
        flight("right", "BB200", "09:00", "11:00", ["B1", "B2"]),
      ])
    );
    const overlapConstraints = problem.constraints.filter((constraint) =>
      constraint.id.startsWith("overlap:")
    );

    expect(overlapConstraints).toHaveLength(1);
    expect(overlapConstraints[0]).toMatchObject({ upperBound: 1 });
    expect(overlapConstraints[0]!.terms).toHaveLength(4);
  });

  it("keeps pair constraints when early release makes only some choices compatible", async () => {
    const problem = await captureProblem(
      modelState(
        [
          flight("left", "AA100", "12:00", "14:00", ["分流", "普通"]),
          flight("right", "BB200", "13:50", "15:50", ["B1", "B2"]),
        ],
        (rule) =>
          rule.name === "分流"
            ? { ...rule, category: "分流", earlyReleaseMinutes: 120 }
            : rule
      )
    );
    const overlapConstraints = problem.constraints.filter((constraint) =>
      constraint.id.startsWith("overlap:")
    );

    expect(overlapConstraints).toHaveLength(2);
    expect(
      overlapConstraints.every((constraint) => constraint.terms.length === 2)
    ).toBe(true);
  });
});

describe("daily schedule solver performance model", () => {
  it("marks recovery and later fairness goals as best effort", async () => {
    const state = modelState([
      flight("first", "AA100", "08:00", "10:00", ["A1"]),
      flight("second", "BB200", "08:00", "10:00", ["B1"]),
      flight("third", "CC300", "08:00", "10:00", ["C1"]),
      flight("fourth", "DD400", "08:00", "10:00", ["D1"]),
    ]);
    const secondWorker = {
      ...state.staff[0]!,
      id: "second-worker",
      name: "第二名测试人员",
    };
    state.staff.push(secondWorker);
    state.positionRules.forEach((rule) =>
      rule.qualifiedStaffIds.push(secondWorker.id)
    );
    state.history = [
      {
        id: "historical-fatigue",
        date: "2026-08-01",
        flightNo: "OLD100",
        position: "A1",
        staffId: secondWorker.id,
        staffName: secondWorker.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 8,
        remark: "",
      },
    ];

    const problem = await captureProblem(state);
    const bestEffortIds = problem.objectives
      .filter((objective) => objective.optimality === "best-effort")
      .map((objective) => objective.id);

    expect(bestEffortIds).toEqual([
      "candidate:cross-workday-load",
      "candidate:workload-balance:target",
      "candidate:workload-balance:today-hours-excess",
      "candidate:workload-balance:rolling-hours-excess",
      "candidate:workload-balance:today-fatigue-excess",
      "candidate:workload-balance:today-hours-spread",
      "candidate:workload-balance:rolling-hours-spread",
      "candidate:workload-balance:today-fatigue-spread",
      "candidate:historical-fatigue",
    ]);
    const firstBestEffortIndex = problem.objectives.findIndex(
      (objective) => objective.optimality === "best-effort"
    );
    expect(firstBestEffortIndex).toBeGreaterThanOrEqual(0);
    expect(
      problem.objectives
        .slice(0, firstBestEffortIndex)
        .every((objective) => objective.optimality === "required")
    ).toBe(true);
    expect(
      problem.objectives
        .slice(firstBestEffortIndex)
        .every((objective) => objective.optimality === "best-effort")
    ).toBe(true);
    expect(
      problem.objectives
        .filter((objective) => objective.optimality === "best-effort")
        .every((objective) => objective.acceptedGap?.relative === 0.05)
    ).toBe(true);
  });

  it("does not use team leaders to satisfy the daily staff coverage objective", async () => {
    const state = modelState([
      flight("only", "AA100", "08:00", "10:00", ["A1"]),
    ]);
    const teamLeader = state.staff[0]!;
    teamLeader.teamLeader = true;
    const regularWorker = {
      ...teamLeader,
      id: "regular-worker",
      name: "普通人员",
      teamLeader: false,
    };
    state.staff.push(regularWorker);
    state.positionRules[0]!.qualifiedStaffIds.push(regularWorker.id);

    const problem = await captureProblem(state);
    const coverage = problem.objectives.find(
      (objective) => objective.id === "candidate:staff-coverage"
    );

    expect(coverage?.terms).toEqual([
      { variableId: `worked:${regularWorker.id}`, coefficient: 1 },
    ]);
    expect(problem.variables).not.toContainEqual({
      id: `worked:${teamLeader.id}`,
    });
  });

  it("places same-day late obligation after high-fatigue continuity and before transition and coverage", async () => {
    const state = modelState(
      [
        flight("early", "EARLY100", "06:00", "07:00", ["H03"]),
        flight("morning", "MORNING100", "08:00", "10:00", ["控制"]),
        flight("late", "NIGHT300", "20:00", "22:00", ["N01"]),
      ],
      (rule) => ({
        ...rule,
        fatiguePoints: rule.flightNo === "EARLY100" ? 6 : 1,
      })
    );
    const protectedWorker = state.staff[0]!;
    protectedWorker.teamLeader = false;
    const alternate = {
      ...protectedWorker,
      id: "alternate-worker",
      name: "替代人员",
    };
    state.staff.push(alternate);
    state.positionRules.forEach((rule) => {
      if (rule.flightNo !== "NIGHT300")
        rule.qualifiedStaffIds.push(alternate.id);
    });
    state.settings.minimumRegularTransitionMinutes = 0;
    state.settings.positionTransitionPolicies = [
      {
        id: "early-to-morning",
        name: "早班衔接",
        enabled: true,
        sourceFlightNo: "EARLY100",
        sourcePositions: ["H03"],
        targetFlightNo: "MORNING100",
        targetPosition: "控制",
        minimumGapMinutes: 120,
        mode: "prefer",
      },
    ];
    state.settings.lateShiftRecoveryPositionRules.find(
      (item) => item.matchField === "remark" && item.keyword === "一号"
    )!.nextWorkdayCutoffTime = "12:00";
    state.history = [
      {
        id: "previous-early",
        date: "2026-08-01",
        flightNo: "EARLY100",
        position: "H03",
        staffId: protectedWorker.id,
        staffName: protectedWorker.name,
        startTime: "06:00",
        endTime: "07:00",
        workHours: 1,
        fatiguePoints: 6,
        remark: "",
      },
      {
        id: "previous-late",
        date: "2026-08-01",
        flightNo: "TR121",
        position: "H02",
        staffId: protectedWorker.id,
        staffName: protectedWorker.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 10,
        remark: "一号",
      },
    ];

    const problem = await captureProblem(state);
    const objectiveIds = problem.objectives.map((objective) => objective.id);
    const cutoffIndex = objectiveIds.indexOf("candidate:late-shift-cutoff");
    const highFatigueIndex = objectiveIds.indexOf(
      "candidate:high-fatigue-position-consecutive"
    );
    const sameDayIndex = objectiveIds.indexOf(
      "candidate:same-day-late-obligation"
    );
    const splitCutoffOrderIndex = objectiveIds.indexOf(
      "candidate:same-day-late-obligation:split-cutoff-order"
    );
    const beforeCutoffAccessIndex = objectiveIds.indexOf(
      "candidate:same-day-late-obligation:before-cutoff-access"
    );
    const preferredTransitionIndex = objectiveIds.indexOf(
      "candidate:preferred-position-transition"
    );
    const staffCoverageIndex = objectiveIds.indexOf("candidate:staff-coverage");

    expect(cutoffIndex).toBeGreaterThanOrEqual(0);
    expect(highFatigueIndex).toBeGreaterThan(cutoffIndex);
    expect(sameDayIndex).toBeGreaterThan(highFatigueIndex);
    expect(splitCutoffOrderIndex).toBeGreaterThan(sameDayIndex);
    expect(beforeCutoffAccessIndex).toBeGreaterThan(splitCutoffOrderIndex);
    expect(beforeCutoffAccessIndex).toBeLessThan(preferredTransitionIndex);
    expect(sameDayIndex).toBeLessThan(preferredTransitionIndex);
    expect(sameDayIndex).toBeLessThan(staffCoverageIndex);
  });

  it("splits actual morning and evening CX priority assignments when safe", async () => {
    const state = modelState([
      flight("morning-cx", "CX100", "08:00", "10:00", ["G20"]),
      flight("evening-cx", "CX200", "20:00", "22:00", ["G20"]),
    ]);
    const alternate = {
      ...state.staff[0]!,
      id: "alternate-worker",
      name: "替代人员",
    };
    state.staff.push(alternate);
    state.positionRules[0]!.qualifiedStaffIds.push(alternate.id);
    state.positionRules[1]!.qualifiedStaffIds.push(alternate.id);

    const result = await generateSchedule(state, "2026-08-03");
    const morning = result.assignments.find(
      (assignment) => assignment.flightNo === "CX100"
    );
    const evening = result.assignments.find(
      (assignment) => assignment.flightNo === "CX200"
    );

    expect(result.unfilledCount).toBe(0);
    expect(morning?.staffId).toBeTruthy();
    expect(evening?.staffId).toBeTruthy();
    expect(morning?.staffId).not.toBe(evening?.staffId);
  });

  it("leaves a later same-airline priority position unfilled when no alternate is qualified", async () => {
    const state = modelState([
      flight("morning-cx", "CX100", "08:00", "10:00", ["G20"]),
      flight("evening-cx", "CX200", "20:00", "22:00", ["G20"]),
    ]);
    const alternate = {
      ...state.staff[0]!,
      id: "alternate-worker",
      name: "替代人员",
    };
    state.staff.push(alternate);
    const result = await generateSchedule(state, "2026-08-03");

    expect(result.unfilledCount).toBe(1);
    expect(
      result.assignments.filter((assignment) =>
        ["CX100", "CX200"].includes(assignment.flightNo)
      )
    ).toHaveLength(2);
  });

  it("separates priority work across more than two same-airline flights", async () => {
    const state = modelState(
      [
        flight("fd-1", "FD101", "08:00", "10:00", ["G08"]),
        flight("fd-2", "FD202", "13:00", "15:00", ["G17"]),
        flight("fd-3", "FD303", "18:00", "20:00", ["G20"]),
      ],
      (rule) => ({ ...rule, remark: "控制" })
    );
    state.staff.push(
      { ...state.staff[0]!, id: "worker-2", name: "第二人员" },
      { ...state.staff[0]!, id: "worker-3", name: "第三人员" }
    );
    state.positionRules.forEach((rule) => {
      rule.qualifiedStaffIds = state.staff.map((person) => person.id);
    });

    const result = await generateSchedule(state, "2026-08-03");
    const assignedStaffIds = result.assignments
      .filter((assignment) => assignment.status === "assigned")
      .map((assignment) => assignment.staffId);
    expect(result.unfilledCount).toBe(0);
    expect(new Set(assignedStaffIds).size).toBe(3);
  });

  it("does not separate same-named priority positions across airlines", async () => {
    const state = modelState([
      flight("fd", "FD101", "08:00", "10:00", ["G20"]),
      flight("cx", "CX202", "15:00", "17:00", ["G20"]),
    ]);

    const result = await generateSchedule(state, "2026-08-03");
    expect(result.unfilledCount).toBe(0);
    expect(result.assignments.map((assignment) => assignment.staffId)).toEqual([
      "worker",
      "worker",
    ]);
  });

  it("places cross-workday qualification reservation after vacancies and before late-position fairness", async () => {
    const state = modelState([
      flight("late", "LATE100", "21:00", "23:30", ["A1"]),
    ]);
    const second = {
      ...state.staff[0]!,
      id: "second-worker",
      name: "第二人员",
    };
    state.staff.push(second);
    state.positionRules[0]!.qualifiedStaffIds.push(second.id);
    state.positionRules.push({
      ...state.positionRules[0]!,
      id: "next-control",
      flightNo: "NEXT200",
      name: "控制",
      remark: "",
      qualifiedStaffIds: [state.staff[0]!.id],
    });
    state.settings.crossWorkdayQualificationReservations = [
      {
        id: "reserve-next-control",
        enabled: true,
        flightNo: "NEXT200",
        matchField: "position",
        keyword: "控制",
        minimumStaffCount: 1,
      },
    ];

    const problem = await captureProblem(state);
    const objectiveIds = problem.objectives.map((objective) => objective.id);
    const reservationIndex = objectiveIds.findIndex((id) =>
      id.startsWith("cross-workday-qualification-reservation:")
    );

    expect(reservationIndex).toBeGreaterThan(
      objectiveIds.indexOf("all-vacancies")
    );
    const lateFairnessIndex = objectiveIds.findIndex((id) =>
      id.startsWith("candidate:late-priority-frequency:")
    );
    if (lateFairnessIndex >= 0)
      expect(reservationIndex).toBeLessThan(lateFairnessIndex);
    expect(
      problem.variables.some((variable) =>
        variable.id.startsWith("cross-workday-reserve:")
      )
    ).toBe(true);
  });

  it("uses native lexicographic solving for the whole-day model", async () => {
    const problem = await captureProblem(
      modelState([flight("only", "AA100", "08:00", "10:00", ["A1"])])
    );

    expect(problem.strategy).toBe("native-lexicographic");
  });

  it("does not solve extra objectives for otherwise equivalent staff IDs", async () => {
    const problem = await captureProblem(
      modelState([flight("ke166", "KE166", "08:00", "10:00", ["H01"])])
    );

    expect(
      problem.objectives.filter((objective) =>
        objective.id.startsWith("candidate:staff-id")
      )
    ).toEqual([]);
  });

  it("locks late-position fairness in supervisor, number-one, declaration, delivery order", async () => {
    const state = modelState(
      [
        flight("late", "TR121", "21:55", "23:55", [
          "督导",
          "H02",
          "H04",
          "G14",
        ]),
      ],
      (rule) => ({
        ...rule,
        remark:
          rule.name === "H02"
            ? "一号"
            : rule.name === "H04"
              ? "申报"
              : rule.name === "G14"
                ? "送资料"
                : "",
      })
    );
    const second = {
      ...state.staff[0]!,
      id: "second-worker",
      name: "第二人员",
    };
    state.staff.push(second);
    state.positionRules.forEach((rule) =>
      rule.qualifiedStaffIds.push(second.id)
    );
    state.settings.latePriorityFlightNumbers = ["TR121"];
    state.history = [
      ["supervisor", state.staff[0]!.id, "督导", ""],
      ["number-one", second.id, "H02", "一号"],
      ["declaration", state.staff[0]!.id, "H04", "申报"],
      ["delivery", second.id, "G14", "送资料"],
    ].map(([id, staffId, position, remark]) => ({
      id: id!,
      date: "2026-08-01",
      flightNo: "TR121",
      position: position!,
      staffId: staffId!,
      staffName: "测试人员",
      startTime: "21:55",
      endTime: "23:55",
      workHours: 2,
      fatiguePoints: 5,
      remark: remark!,
    }));
    state.history.push({
      ...state.history[0]!,
      id: "latest-number-one",
      date: "2026-08-02",
      position: "H02",
      remark: "一号",
    });
    const problem = await captureProblem(state);

    const objectiveIds = problem.objectives.map((objective) => objective.id);
    const aggregateObjectives = objectiveIds.filter((id) =>
      id.startsWith("candidate:late-priority-aggregate-rotation:")
    );
    const categoryObjectives = objectiveIds.filter((id) =>
      id.startsWith("candidate:late-priority-frequency:")
    );

    expect(aggregateObjectives).toEqual([
      "candidate:late-priority-aggregate-rotation:category-boundary",
      "candidate:late-priority-aggregate-rotation:previous-workday",
      "candidate:late-priority-aggregate-rotation:current-month",
      "candidate:late-priority-aggregate-rotation:recent-eight-workdays",
    ]);
    expect(categoryObjectives).toEqual([
      "candidate:late-priority-frequency:supervisor",
      "candidate:late-priority-frequency:number-one",
      "candidate:late-priority-frequency:declaration",
      "candidate:late-priority-frequency:delivery",
    ]);
    expect(objectiveIds.indexOf(aggregateObjectives.at(-1)!)).toBeLessThan(
      objectiveIds.indexOf(categoryObjectives[0]!)
    );
  });

  it("omits inactive late-position objectives from a daytime model", async () => {
    const problem = await captureProblem(
      modelState([flight("day", "AA100", "08:00", "10:00", ["G01"])])
    );

    expect(
      problem.objectives.some((objective) =>
        objective.id.startsWith("candidate:late-priority-frequency:")
      )
    ).toBe(false);
  });

  it("linearizes soft combinations by mutually exclusive source flight", async () => {
    const state = modelState([
      flight("source", "SRC100", "06:00", "08:00", ["S1", "S2"]),
      flight("target", "DST200", "09:00", "11:00", ["T1"]),
    ]);
    state.settings.positionTransitionPolicies = [
      {
        id: "source-to-target",
        name: "来源航班到目标岗位",
        enabled: true,
        sourceFlightNo: "SRC100",
        sourcePositions: ["S1", "S2"],
        targetFlightNo: "DST200",
        targetPosition: "T1",
        minimumGapMinutes: 180,
        mode: "prefer",
      },
    ];
    state.settings.minimumRegularTransitionMinutes = 0;

    const problem = await captureProblem(state);
    const combinationVariables = problem.variables.filter((variable) =>
      variable.id.startsWith("combination:")
    );
    const combinationConstraints = problem.constraints.filter((constraint) =>
      constraint.id.startsWith("combination:")
    );

    expect(combinationVariables.length).toBeGreaterThan(0);
    expect(combinationVariables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "continuous",
          lowerBound: 0,
          upperBound: 1,
          lowerEnvelope: true,
        }),
      ])
    );
    expect(
      combinationConstraints.every((constraint) =>
        constraint.id.includes(":source-flight:")
      )
    ).toBe(true);
    expect(combinationConstraints[0]).toMatchObject({ lowerBound: -1 });
    expect(combinationConstraints[0]!.terms).toHaveLength(4);
    const transitionObjective = problem.objectives.find(
      (objective) => objective.id === "candidate:preferred-position-transition"
    );
    expect(transitionObjective?.objectiveValueStep).toBe(1);
  });

  it("adds a safe independent-capacity cut for high-load combinations", async () => {
    const state = modelState(
      [
        flight("first", "AA100", "06:00", "08:00", ["A1"]),
        flight("second", "BB200", "09:00", "11:00", ["B1"]),
        flight("third", "CC300", "12:00", "14:00", ["C1"]),
      ],
      (rule) => ({ ...rule, fatiguePoints: 4 })
    );
    state.settings.minimumRegularTransitionMinutes = 0;
    state.settings.highLoadRecoveryMinutes = 360;

    const problem = await captureProblem(state);
    const capacityCut = problem.constraints.find(
      (constraint) => constraint.id === "high-load-independent-capacity:worker"
    );

    expect(capacityCut).toMatchObject({ lowerBound: -1 });
    expect(
      capacityCut?.terms.filter(
        (term) =>
          term.variableId.startsWith("combination:") && term.coefficient === 1
      )
    ).toHaveLength(3);
    expect(
      capacityCut?.terms.filter(
        (term) =>
          term.variableId.startsWith("staff:") && term.coefficient === -1
      )
    ).toHaveLength(3);
  });

  it("skips the high-load capacity cut beyond the exact small-graph limit", async () => {
    const state = modelState(
      Array.from({ length: 12 }, (_, index) =>
        flight(
          `flight-${index}`,
          `AA${100 + index}`,
          `${String(5 + index).padStart(2, "0")}:00`,
          `${String(6 + index).padStart(2, "0")}:00`,
          [`P${index}`]
        )
      ),
      (rule) => ({ ...rule, fatiguePoints: 4 })
    );
    state.settings.minimumRegularTransitionMinutes = 0;
    state.settings.highLoadRecoveryMinutes = 720;

    const problem = await captureProblem(state);

    expect(
      problem.constraints.some((constraint) =>
        constraint.id.startsWith("high-load-independent-capacity:")
      )
    ).toBe(false);
  });

  it("omits a scarcity objective that duplicates the pre-noon vacancy objective", async () => {
    const problem = await captureProblem(
      modelState([
        flight("morning", "AA100", "08:00", "10:00", ["G01", "G02"]),
        flight("afternoon", "BB200", "13:00", "15:00", ["H01"]),
      ])
    );

    expect(problem.objectives.map((objective) => objective.id)).not.toContain(
      "pre-noon-scarcity"
    );
  });

  it("keeps a morning priority position ahead of an ordinary position when a vacancy is unavoidable", async () => {
    const problem = await captureProblem(
      modelState([
        flight("morning", "AA100", "08:00", "10:00", ["督导", "G01"]),
      ])
    );
    const objective = problem.objectives.find(
      (item) => item.id === "pre-noon-priority-vacancies"
    );

    expect(objective?.terms).toEqual([
      { variableId: "vacancy:0", coefficient: 1 },
    ]);
  });
});
