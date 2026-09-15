import { beforeEach, describe, expect, it, vi } from "vitest";

const sequential = vi.hoisted(() => {
  const create = vi.fn(async () => ({
    getSolutionValues: vi.fn(() => Float64Array.from([1])),
    passModel: vi.fn(),
    setParam: vi.fn(),
    solve: vi.fn(async () => ({
      status: "timelimit" as const,
      solution: new Map([["selected", 1]]),
    })),
  }));
  return { create };
});

vi.mock("@bubblyworld/highs-ts", () => ({
  HIGHS_INF: 1e30,
  HiGHS: { create: sequential.create },
}));

import { HighsSolver } from "../../src/infrastructure/solver/highs-solver";

describe("HiGHS sequential time-limited feasible result", () => {
  beforeEach(() => sequential.create.mockClear());

  it("keeps a feasible incumbent instead of returning an empty selection", async () => {
    const result = await new HighsSolver().solve({
      variables: [{ id: "selected" }],
      constraints: [
        {
          id: "required",
          terms: [{ variableId: "selected", coefficient: 1 }],
          lowerBound: 1,
        },
      ],
      objectives: [
        {
          id: "stable",
          direction: "minimize",
          terms: [{ variableId: "selected", coefficient: 1 }],
        },
      ],
      timeoutMs: 100,
    });

    expect(result.termination).toBe("time-limited-feasible");
    expect([...result.selectedVariableIds]).toEqual(["selected"]);
  });
});
