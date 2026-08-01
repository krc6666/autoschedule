import { describe, expect, it } from "vitest";

import { HighsSolver } from "../../src/infrastructure/solver/highs-solver";

describe("HiGHS solver adapter", () => {
  it("locks each earlier objective before optimizing the next objective", async () => {
    const solver = new HighsSolver();
    const result = await solver.solve({
      variables: [{ id: "a" }, { id: "b" }, { id: "c" }],
      constraints: [
        {
          id: "choose-two",
          terms: ["a", "b", "c"].map((variableId) => ({
            variableId,
            coefficient: 1,
          })),
          lowerBound: 2,
          upperBound: 2,
        },
      ],
      objectives: [
        {
          id: "protect-a",
          direction: "maximize",
          terms: [{ variableId: "a", coefficient: 1 }],
        },
        {
          id: "prefer-c",
          direction: "maximize",
          terms: [{ variableId: "c", coefficient: 1 }],
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect([...result.selectedVariableIds].sort()).toEqual(["a", "c"]);
    expect(Object.fromEntries(result.objectiveValues)).toEqual({
      "protect-a": 1,
      "prefer-c": 1,
    });
  });

  it("returns infeasible without exposing a partial assignment", async () => {
    const solver = new HighsSolver();
    const result = await solver.solve({
      variables: [{ id: "only" }],
      constraints: [
        {
          id: "impossible",
          terms: [{ variableId: "only", coefficient: 1 }],
          lowerBound: 2,
        },
      ],
      objectives: [
        {
          id: "stable",
          direction: "minimize",
          terms: [{ variableId: "only", coefficient: 1 }],
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("infeasible");
    expect(result.selectedVariableIds.size).toBe(0);
  });

  it("preserves decimal objective values when locking the next objective", async () => {
    const solver = new HighsSolver();
    const result = await solver.solve({
      variables: [{ id: "lighter" }, { id: "heavier" }],
      constraints: [
        {
          id: "choose-one",
          terms: ["lighter", "heavier"].map((variableId) => ({
            variableId,
            coefficient: 1,
          })),
          lowerBound: 1,
          upperBound: 1,
        },
      ],
      objectives: [
        {
          id: "fatigue",
          direction: "minimize",
          terms: [
            { variableId: "lighter", coefficient: 2.5 },
            { variableId: "heavier", coefficient: 3.5 },
          ],
        },
        {
          id: "stable-order",
          direction: "minimize",
          terms: [
            { variableId: "lighter", coefficient: 1 },
            { variableId: "heavier", coefficient: 0 },
          ],
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect(result.objectiveValues.get("fatigue")).toBe(2.5);
    expect([...result.selectedVariableIds]).toEqual(["lighter"]);
  });
});
