import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  model: undefined as { rowUpper: Float64Array } | undefined,
  solveCount: 0,
}));

vi.mock("@bubblyworld/highs-ts", () => ({
  HIGHS_INF: Number.MAX_VALUE,
  HiGHS: {
    create: vi.fn(async () => ({
      setParam: vi.fn(),
      passModel: vi.fn((model: { rowUpper: Float64Array }) => {
        fake.model = model;
      }),
      solve: vi.fn(async () => {
        fake.solveCount += 1;
        const latestUpperBound = fake.model?.rowUpper.at(-1);
        return {
          status:
            fake.solveCount > 1 &&
            latestUpperBound !== undefined &&
            latestUpperBound < 2
              ? "infeasible"
              : "optimal",
        };
      }),
      getSolutionValues: vi.fn(() =>
        Float64Array.from([fake.solveCount === 1 ? 0.9999998322033854 : 1])
      ),
    })),
  },
}));

import { HighsSolver } from "../../src/infrastructure/solver/highs-solver";

describe("HiGHS integer objective locks", () => {
  beforeEach(() => {
    fake.model = undefined;
    fake.solveCount = 0;
  });

  it("locks a mathematically integral objective at its exact integer value", async () => {
    const result = await new HighsSolver().solve({
      variables: [{ id: "choice" }],
      constraints: [
        {
          id: "choose",
          terms: [{ variableId: "choice", coefficient: 1 }],
          lowerBound: 1,
          upperBound: 1,
        },
      ],
      objectives: [
        {
          id: "integer-rank",
          direction: "minimize",
          terms: [{ variableId: "choice", coefficient: 2 }],
        },
        {
          id: "next-rank",
          direction: "minimize",
          terms: [{ variableId: "choice", coefficient: 1 }],
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect(result.objectiveValues.get("integer-rank")).toBe(2);
  });
});
