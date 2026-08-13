import { describe, expect, it } from "vitest";
import { HiGHS as NativeHiGHS } from "@autoschedule/highs-ts";

import { HighsSolver } from "../../src/infrastructure/solver/highs-solver";

describe("HiGHS solver adapter", () => {
  it("exposes clock reset and the official primal solution status", async () => {
    const highs = await NativeHiGHS.create();
    try {
      highs.passModel({
        numCol: 1,
        numRow: 1,
        sense: "minimize",
        colCost: [1],
        colLower: [0],
        colUpper: [1],
        rowLower: [1],
        rowUpper: [1],
        matrix: {
          format: "row",
          start: [0, 1],
          index: [0],
          value: [1],
        },
        integrality: [1],
      });

      highs.zeroAllClocks();
      const result = await highs.solve();

      expect(result.status).toBe("optimal");
      expect(result.solutionStatus).toBe("feasible");
      expect(result.mipGap).toBe(0);
      expect(result.mipDualBound).toBe(1);
    } finally {
      highs.free();
    }
  });

  it("keeps native objectives in strict priority order", async () => {
    const solver = new HighsSolver();
    const result = await solver.solve({
      strategy: "native-lexicographic",
      variables: [{ id: "a" }, { id: "b" }],
      constraints: [
        {
          id: "choose-one",
          terms: ["a", "b"].map((variableId) => ({
            variableId,
            coefficient: 1,
          })),
          lowerBound: 1,
          upperBound: 1,
        },
      ],
      objectives: [
        {
          id: "prefer-a-first",
          direction: "maximize",
          terms: [{ variableId: "a", coefficient: 1 }],
        },
        {
          id: "prefer-b-second",
          direction: "maximize",
          terms: [{ variableId: "b", coefficient: 1 }],
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect([...result.selectedVariableIds]).toEqual(["a"]);
    expect(result.objectiveValues.get("prefer-a-first")).toBe(1);
    expect(result.objectiveValues.get("prefer-b-second")).toBe(0);
  });

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

  it("supports continuous load variables alongside binary assignments", async () => {
    const solver = new HighsSolver();
    const result = await solver.solve({
      variables: [
        { id: "assignment" },
        { id: "load", type: "continuous", lowerBound: 0 },
      ],
      constraints: [
        {
          id: "assign",
          terms: [{ variableId: "assignment", coefficient: 1 }],
          lowerBound: 1,
          upperBound: 1,
        },
        {
          id: "measure-load",
          terms: [
            { variableId: "load", coefficient: 1 },
            { variableId: "assignment", coefficient: -2.5 },
          ],
          lowerBound: 0,
        },
      ],
      objectives: [
        {
          id: "minimum-load",
          direction: "minimize",
          terms: [{ variableId: "load", coefficient: 1 }],
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect(result.objectiveValues.get("minimum-load")).toBe(2.5);
    expect(result.selectedVariableIds.has("assignment")).toBe(true);
    expect(result.selectedVariableIds.has("load")).toBe(false);
  });

  it("skips a mathematically redundant objective when its prior condition is false", async () => {
    const solver = new HighsSolver();
    const result = await solver.solve({
      variables: [
        { id: "a" },
        { id: "b" },
        {
          id: "excess",
          type: "continuous",
          lowerBound: 1,
          upperBound: 1,
        },
      ],
      constraints: [
        {
          id: "choose-one",
          terms: ["a", "b"].map((variableId) => ({
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
          id: "spread",
          direction: "minimize",
          terms: [{ variableId: "b", coefficient: 1 }],
          solveOnlyWhen: { objectiveId: "excess", equals: 0 },
        },
        {
          id: "stable",
          direction: "minimize",
          terms: [{ variableId: "a", coefficient: 1 }],
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect([...result.selectedVariableIds]).toEqual(["b"]);
    expect(result.objectiveValues.get("spread")).toBe(1);
  });

  it("includes a native conditional objective when its condition is true", async () => {
    const solver = new HighsSolver();
    const result = await solver.solve({
      strategy: "native-lexicographic",
      variables: [
        { id: "a" },
        { id: "b" },
        {
          id: "excess",
          type: "continuous",
          lowerBound: 0,
          upperBound: 0,
        },
      ],
      constraints: [
        {
          id: "choose-one",
          terms: ["a", "b"].map((variableId) => ({
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
          direction: "minimize",
          terms: [{ variableId: "b", coefficient: 1 }],
          solveOnlyWhen: { objectiveId: "excess", equals: 0 },
        },
        {
          id: "stable",
          direction: "minimize",
          terms: [{ variableId: "a", coefficient: 1 }],
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect([...result.selectedVariableIds]).toEqual(["a"]);
    expect(result.objectiveValues.get("conditional")).toBe(0);
  });

  it("skips a native conditional objective when its condition is false", async () => {
    const solver = new HighsSolver();
    const result = await solver.solve({
      strategy: "native-lexicographic",
      variables: [
        { id: "a" },
        { id: "b" },
        {
          id: "excess",
          type: "continuous",
          lowerBound: 1,
          upperBound: 1,
        },
      ],
      constraints: [
        {
          id: "choose-one",
          terms: ["a", "b"].map((variableId) => ({
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
          direction: "minimize",
          terms: [{ variableId: "b", coefficient: 1 }],
          solveOnlyWhen: { objectiveId: "excess", equals: 0 },
        },
        {
          id: "stable",
          direction: "minimize",
          terms: [{ variableId: "a", coefficient: 1 }],
        },
      ],
      timeoutMs: 5_000,
    });

    expect(result.termination).toBe("optimal");
    expect([...result.selectedVariableIds]).toEqual(["b"]);
    expect(result.objectiveValues.get("conditional")).toBe(1);
  });
});
