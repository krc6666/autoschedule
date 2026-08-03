import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { optimizeDailySchedule } from "../../src/domain/kernel/daily-schedule-optimizer";
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

describe("daily schedule conflict constraints", () => {
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
            ? { ...rule, category: "分流", earlyReleaseMinutes: 20 }
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
  it("uses native lexicographic solving for the whole-day model", async () => {
    const problem = await captureProblem(
      modelState([flight("only", "AA100", "08:00", "10:00", ["A1"])])
    );

    expect(problem.strategy).toBe("native-lexicographic");
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
});
