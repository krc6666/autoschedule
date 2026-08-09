import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { buildDailyScheduleModel } from "../../src/domain/kernel/daily-schedule-model";
import { optimizeDailySchedule } from "../../src/domain/kernel/daily-schedule-optimizer";
import { materializeDailySchedulePlan } from "../../src/domain/kernel/daily-schedule-result";
import { prepareSchedule } from "../../src/domain/kernel/schedule-preparation";
import { evaluateAutomaticHardConstraints } from "../../src/domain/rules/built-in-rule-registry";
import type {
  SolverPort,
  SolverProblem,
} from "../../src/domain/solver/solver-port";
import type { AppState, Flight, PositionRule } from "../../src/model";

class ModelCaptured extends Error {}

class CapturingSolver implements SolverPort {
  problem: SolverProblem | undefined;

  async solve(problem: SolverProblem): Promise<never> {
    this.problem = problem;
    throw new ModelCaptured();
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
): AppState {
  const state = createDefaultState();
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

async function captureProblem(state: AppState): Promise<SolverProblem> {
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
});

describe("daily schedule conflict constraints", () => {
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
