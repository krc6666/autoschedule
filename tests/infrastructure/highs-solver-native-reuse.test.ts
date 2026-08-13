import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  const results: Array<{
    status: "optimal" | "timelimit";
    solutionStatus: "feasible" | "none";
    mipGap?: number;
    mipDualBound?: number;
    objective?: number;
  }> = [];
  const solutions: number[][] = [];
  const instances: Array<{
    addRows: ReturnType<typeof vi.fn>;
    clearLinearObjectives: ReturnType<typeof vi.fn>;
    free: ReturnType<typeof vi.fn>;
    getSolutionValues: ReturnType<typeof vi.fn>;
    passLinearObjectives: ReturnType<typeof vi.fn>;
    passModel: ReturnType<typeof vi.fn>;
    setParam: ReturnType<typeof vi.fn>;
    setSolutionValues: ReturnType<typeof vi.fn>;
    solve: ReturnType<typeof vi.fn>;
    zeroAllClocks: ReturnType<typeof vi.fn>;
  }> = [];
  const create = vi.fn(async () => {
    const instance = {
      addRows: vi.fn(),
      clearLinearObjectives: vi.fn(),
      free: vi.fn(),
      getSolutionValues: vi.fn(() =>
        Float64Array.from(solutions.shift() ?? [1, 0, 0])
      ),
      passLinearObjectives: vi.fn(),
      passModel: vi.fn(),
      setParam: vi.fn(),
      setSolutionValues: vi.fn(),
      solve: vi.fn(
        async () =>
          results.shift() ?? {
            status: "optimal" as const,
            solutionStatus: "feasible" as const,
          }
      ),
      zeroAllClocks: vi.fn(),
    };
    instances.push(instance);
    return instance;
  });
  return { create, instances, results, solutions };
});

vi.mock("@autoschedule/highs-ts", () => ({
  HiGHS: { create: native.create },
}));

import { HighsSolver } from "../../src/infrastructure/solver/highs-solver";

describe("HiGHS native lexicographic model reuse", () => {
  beforeEach(() => {
    native.create.mockClear();
    native.instances.length = 0;
    native.results.length = 0;
    native.solutions.length = 0;
  });

  it("reuses one loaded model and the previous batch solution", async () => {
    native.solutions.push([0, 1, 0], [1, 0, 0]);

    const result = await new HighsSolver().solve({
      strategy: "native-lexicographic",
      variables: [
        { id: "selected" },
        { id: "alternative" },
        { id: "excess", type: "continuous", lowerBound: 0, upperBound: 0 },
      ],
      constraints: [
        {
          id: "choose-one",
          terms: ["selected", "alternative"].map((variableId) => ({
            variableId,
            coefficient: 1,
          })),
          lowerBound: 1,
          upperBound: 1,
        },
      ],
      objectives: [
        {
          id: "excess",
          direction: "minimize",
          terms: [{ variableId: "excess", coefficient: 1 }],
        },
        {
          id: "conditional",
          direction: "maximize",
          terms: [{ variableId: "selected", coefficient: 1 }],
          solveOnlyWhen: { objectiveId: "excess", equals: 0 },
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect(native.create).toHaveBeenCalledTimes(1);
    expect(native.instances).toHaveLength(1);
    const [instance] = native.instances;
    expect(instance!.passModel).toHaveBeenCalledTimes(1);
    expect(instance!.solve).toHaveBeenCalledTimes(2);
    expect(instance!.clearLinearObjectives).toHaveBeenCalledTimes(2);
    expect(instance!.addRows).toHaveBeenCalledTimes(1);
    expect(instance!.setSolutionValues).toHaveBeenCalledTimes(1);
    expect(instance!.free).toHaveBeenCalledTimes(1);
  });

  it("skips a lexicographic solve when the current solution already reaches the variable-bound optimum", async () => {
    native.solutions.push([1, 0, 0], [1, 0, 1]);

    const result = await new HighsSolver().solve({
      strategy: "native-lexicographic",
      variables: [
        { id: "protected" },
        { id: "already-minimal" },
        { id: "improved" },
      ],
      constraints: [],
      objectives: [
        {
          id: "protect",
          direction: "maximize",
          terms: [{ variableId: "protected", coefficient: 1 }],
          optimality: "required",
        },
        {
          id: "already-minimal",
          direction: "minimize",
          terms: [{ variableId: "already-minimal", coefficient: 1 }],
          optimality: "required",
        },
        {
          id: "improve",
          direction: "maximize",
          terms: [{ variableId: "improved", coefficient: 1 }],
          optimality: "best-effort",
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect(Object.fromEntries(result.objectiveValues)).toEqual({
      protect: 1,
      "already-minimal": 0,
      improve: 1,
    });
    const [instance] = native.instances;
    expect(instance!.solve).toHaveBeenCalledTimes(2);
    expect(instance!.zeroAllClocks).toHaveBeenCalledTimes(2);
    expect(instance!.addRows).toHaveBeenCalledTimes(1);
    expect(instance!.addRows.mock.calls[0]![0].start).toHaveLength(2);
  });

  it("keeps required objectives at zero gap even with a proven step", async () => {
    native.solutions.push([1, 0], [1, 1]);

    const result = await new HighsSolver().solve({
      strategy: "native-lexicographic",
      variables: [{ id: "protected" }, { id: "improved" }],
      constraints: [],
      objectives: [
        {
          id: "protect",
          direction: "maximize",
          terms: [{ variableId: "protected", coefficient: 1 }],
          optimality: "required",
          objectiveValueStep: 1,
        },
        {
          id: "improve",
          direction: "maximize",
          terms: [{ variableId: "improved", coefficient: 1 }],
          optimality: "best-effort",
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    const [instance] = native.instances;
    expect(instance!.setParam.mock.calls).toContainEqual(["mip_abs_gap", 0]);
    expect(instance!.addRows).toHaveBeenCalledTimes(1);
    expect(instance!.addRows.mock.calls[0]![0].start).toHaveLength(1);
  });

  it("uses the declared relative gap for best-effort objectives and reports gap completion", async () => {
    native.results.push(
      { status: "optimal", solutionStatus: "feasible", mipGap: 0 },
      { status: "optimal", solutionStatus: "feasible", mipGap: 0.04 }
    );
    native.solutions.push([1, 0], [1, 1]);

    const result = await new HighsSolver().solve({
      strategy: "native-lexicographic",
      variables: [{ id: "protected" }, { id: "improved" }],
      constraints: [],
      objectives: [
        {
          id: "protect",
          direction: "maximize",
          terms: [{ variableId: "protected", coefficient: 1 }],
          optimality: "required",
        },
        {
          id: "improve",
          direction: "maximize",
          terms: [{ variableId: "improved", coefficient: 1 }],
          optimality: "best-effort",
          acceptedGap: { relative: 0.05 },
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("gap-limited-feasible");
    expect(result.bestEffort?.solutionSource).toBe("current-incumbent");
    const [instance] = native.instances;
    expect(instance!.setParam.mock.calls).toContainEqual(["mip_rel_gap", 0.05]);
    expect(instance!.setParam.mock.calls).toContainEqual(["mip_abs_gap", 0]);
  });

  it("uses an explicit absolute accepted gap for discrete best-effort objectives", async () => {
    native.results.push(
      { status: "optimal", solutionStatus: "feasible", mipGap: 0 },
      {
        status: "optimal",
        solutionStatus: "feasible",
        mipGap: 0.0625,
        objective: 16,
        mipDualBound: 15,
      }
    );
    native.solutions.push([1, 0], [1, 1]);

    const result = await new HighsSolver().solve({
      strategy: "native-lexicographic",
      variables: [{ id: "protected" }, { id: "improved" }],
      constraints: [],
      objectives: [
        {
          id: "protect",
          direction: "maximize",
          terms: [{ variableId: "protected", coefficient: 1 }],
          optimality: "required",
        },
        {
          id: "improve",
          direction: "minimize",
          terms: [{ variableId: "improved", coefficient: 1 }],
          optimality: "best-effort",
          objectiveValueStep: 1,
          acceptedGap: { relative: 0.05, absolute: 1 },
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("gap-limited-feasible");
    const [instance] = native.instances;
    expect(instance!.setParam.mock.calls).toContainEqual(["mip_rel_gap", 0.05]);
    expect(instance!.setParam.mock.calls).toContainEqual(["mip_abs_gap", 1]);
  });

  it("locks a gap-completed objective at its actual value before continuing", async () => {
    native.results.push(
      { status: "optimal", solutionStatus: "feasible", mipGap: 0 },
      { status: "optimal", solutionStatus: "feasible", mipGap: 0.04 },
      { status: "optimal", solutionStatus: "feasible", mipGap: 0 }
    );
    native.solutions.push([1, 0, 0], [1, 1, 0], [1, 1, 1]);

    const result = await new HighsSolver().solve({
      strategy: "native-lexicographic",
      variables: [{ id: "required" }, { id: "soft" }, { id: "later" }],
      constraints: [],
      objectives: [
        {
          id: "required",
          direction: "maximize",
          terms: [{ variableId: "required", coefficient: 1 }],
          optimality: "required",
        },
        {
          id: "soft",
          direction: "maximize",
          terms: [{ variableId: "soft", coefficient: 1 }],
          optimality: "best-effort",
          acceptedGap: { relative: 0.05 },
        },
        {
          id: "later",
          direction: "maximize",
          terms: [{ variableId: "later", coefficient: 1 }],
          optimality: "best-effort",
          acceptedGap: { relative: 0.05 },
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("gap-limited-feasible");
    expect(result.approximatedObjectiveIds).toEqual(["soft"]);
    expect(native.instances[0]!.solve).toHaveBeenCalledTimes(3);
    expect(native.instances[0]!.addRows).toHaveBeenCalledTimes(2);
    expect(native.instances[0]!.addRows.mock.calls[1]![0].lower).toEqual(
      Float64Array.from([0.9999999])
    );
  });

  it("normalizes an unlocked lower-envelope variable before evaluating the next objective", async () => {
    native.solutions.push([0, 1, 1]);

    const result = await new HighsSolver().solve({
      strategy: "native-lexicographic",
      variables: [
        { id: "target" },
        { id: "source" },
        {
          id: "combination",
          type: "continuous",
          lowerBound: 0,
          upperBound: 1,
          lowerEnvelope: true,
        },
      ],
      constraints: [
        {
          id: "combination:lower",
          terms: [
            { variableId: "combination", coefficient: 1 },
            { variableId: "target", coefficient: -1 },
            { variableId: "source", coefficient: -1 },
          ],
          lowerBound: -1,
        },
      ],
      objectives: [
        {
          id: "protect-source",
          direction: "maximize",
          terms: [{ variableId: "source", coefficient: 1 }],
          optimality: "required",
        },
        {
          id: "combination-cost",
          direction: "minimize",
          terms: [{ variableId: "combination", coefficient: 1 }],
          optimality: "required",
          objectiveValueStep: 1,
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect(Object.fromEntries(result.objectiveValues)).toEqual({
      "protect-source": 1,
      "combination-cost": 0,
    });
    const [instance] = native.instances;
    expect(instance!.solve).toHaveBeenCalledTimes(1);
  });

  it("uses one shared deadline and stops after a best-effort timeout with an incumbent", async () => {
    native.results.push(
      { status: "optimal", solutionStatus: "feasible" },
      { status: "timelimit", solutionStatus: "feasible" }
    );
    native.solutions.push([1, 0, 0], [1, 1, 0]);

    const result = await new HighsSolver().solve({
      strategy: "native-lexicographic",
      variables: [{ id: "protected" }, { id: "improved" }, { id: "lower" }],
      constraints: [],
      objectives: [
        {
          id: "protect",
          direction: "maximize",
          terms: [{ variableId: "protected", coefficient: 1 }],
          optimality: "required",
        },
        {
          id: "improve",
          direction: "maximize",
          terms: [{ variableId: "improved", coefficient: 1 }],
          optimality: "best-effort",
        },
        {
          id: "lower-priority",
          direction: "maximize",
          terms: [{ variableId: "lower", coefficient: 1 }],
          optimality: "best-effort",
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("time-limited-feasible");
    expect([...result.selectedVariableIds].sort()).toEqual([
      "improved",
      "protected",
    ]);
    expect(result.bestEffort).toEqual({
      stoppedAtObjectiveId: "improve",
      completedObjectiveIds: ["protect"],
      solutionSource: "current-incumbent",
    });
    const [instance] = native.instances;
    expect(instance!.solve).toHaveBeenCalledTimes(2);
    expect(instance!.zeroAllClocks).toHaveBeenCalledTimes(2);
    expect(instance!.passLinearObjectives.mock.calls).toHaveLength(2);
    expect(
      instance!.passLinearObjectives.mock.calls.every(
        ([objectives]) => objectives.length === 1
      )
    ).toBe(true);
  });

  it("publishes the completed required solution before starting best-effort work", async () => {
    native.results.push(
      { status: "optimal", solutionStatus: "feasible" },
      { status: "optimal", solutionStatus: "feasible" }
    );
    native.solutions.push([1, 0], [1, 1]);
    const requiredCheckpoints: string[][] = [];
    const improvedCheckpoints: string[][] = [];

    const result = await new HighsSolver().solve(
      {
        strategy: "native-lexicographic",
        variables: [{ id: "required-choice" }, { id: "soft-choice" }],
        constraints: [],
        objectives: [
          {
            id: "required",
            direction: "maximize",
            terms: [{ variableId: "required-choice", coefficient: 1 }],
            optimality: "required",
          },
          {
            id: "soft",
            direction: "maximize",
            terms: [{ variableId: "soft-choice", coefficient: 1 }],
            optimality: "best-effort",
          },
        ],
        timeoutMs: 5_000,
      },
      {
        onRequiredSolution: (checkpoint) => {
          requiredCheckpoints.push([...checkpoint.selectedVariableIds].sort());
          expect([...checkpoint.objectiveValues.keys()]).toEqual(["required"]);
          expect(native.instances[0]!.solve).toHaveBeenCalledTimes(1);
        },
        onBestEffortSolution: (checkpoint) => {
          improvedCheckpoints.push([...checkpoint.selectedVariableIds].sort());
          expect([...checkpoint.objectiveValues.keys()]).toEqual([
            "required",
            "soft",
          ]);
          expect(native.instances[0]!.solve).toHaveBeenCalledTimes(2);
        },
      }
    );

    expect(requiredCheckpoints).toEqual([["required-choice"]]);
    expect(improvedCheckpoints).toEqual([["required-choice", "soft-choice"]]);
    expect([...result.selectedVariableIds].sort()).toEqual([
      "required-choice",
      "soft-choice",
    ]);
  });

  it("falls back to the previous complete solution when a best-effort timeout has no incumbent", async () => {
    native.results.push(
      { status: "optimal", solutionStatus: "feasible" },
      { status: "timelimit", solutionStatus: "none" }
    );
    native.solutions.push([1, 0, 0]);

    const result = await new HighsSolver().solve({
      strategy: "native-lexicographic",
      variables: [{ id: "protected" }, { id: "improved" }, { id: "lower" }],
      constraints: [],
      objectives: [
        {
          id: "protect",
          direction: "maximize",
          terms: [{ variableId: "protected", coefficient: 1 }],
          optimality: "required",
        },
        {
          id: "improve",
          direction: "maximize",
          terms: [{ variableId: "improved", coefficient: 1 }],
          optimality: "best-effort",
        },
        {
          id: "lower-priority",
          direction: "maximize",
          terms: [{ variableId: "lower", coefficient: 1 }],
          optimality: "best-effort",
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("time-limited-feasible");
    expect([...result.selectedVariableIds]).toEqual(["protected"]);
    expect(result.bestEffort?.solutionSource).toBe("previous-optimal");
    expect(native.instances[0]!.solve).toHaveBeenCalledTimes(2);
  });

  it("rejects a required timeout even when HiGHS has an incumbent", async () => {
    native.results.push({
      status: "timelimit",
      solutionStatus: "feasible",
    });

    const result = await new HighsSolver().solve({
      strategy: "native-lexicographic",
      variables: [{ id: "protected" }, { id: "improved" }],
      constraints: [],
      objectives: [
        {
          id: "protect",
          direction: "maximize",
          terms: [{ variableId: "protected", coefficient: 1 }],
          optimality: "required",
        },
        {
          id: "improve",
          direction: "maximize",
          terms: [{ variableId: "improved", coefficient: 1 }],
          optimality: "best-effort",
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("timed-out");
    expect(result.selectedVariableIds.size).toBe(0);
    expect(result.bestEffort).toBeUndefined();
  });
});
