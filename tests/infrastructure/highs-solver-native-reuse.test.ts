import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
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
  }> = [];
  const create = vi.fn(async () => {
    const instance = {
      addRows: vi.fn(),
      clearLinearObjectives: vi.fn(),
      free: vi.fn(),
      getSolutionValues: vi.fn(() => Float64Array.from([1, 0, 0])),
      passLinearObjectives: vi.fn(),
      passModel: vi.fn(),
      setParam: vi.fn(),
      setSolutionValues: vi.fn(),
      solve: vi.fn(async () => ({ status: "optimal" as const })),
    };
    instances.push(instance);
    return instance;
  });
  return { create, instances };
});

vi.mock("@autoschedule/highs-ts", () => ({
  HiGHS: { create: native.create },
}));

import { HighsSolver } from "../../src/infrastructure/solver/highs-solver";

describe("HiGHS native lexicographic model reuse", () => {
  beforeEach(() => {
    native.create.mockClear();
    native.instances.length = 0;
  });

  it("reuses one loaded model and the previous batch solution", async () => {
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
});
