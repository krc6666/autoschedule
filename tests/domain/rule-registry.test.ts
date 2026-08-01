import { describe, expect, it } from "vitest";

import {
  RuleRegistryError,
  createRuleRegistry,
  type SchedulingHook,
} from "../../src/domain/rules/rule-registry";

function hook(
  id: string,
  overrides: Partial<SchedulingHook> = {}
): SchedulingHook {
  return {
    id,
    label: id,
    stage: "protection",
    defaultEnabled: true,
    configurable: true,
    before: [],
    after: [],
    source: "built-in",
    execute: [
      {
        kind: "candidate-priority",
        execute: () => 0,
      },
    ],
    ...overrides,
  };
}

describe("rule registry", () => {
  it("uses stable dependency ordering inside the declared stage order", () => {
    const registry = createRuleRegistry([
      hook("late", { after: ["middle"] }),
      hook("stable", { stage: "stable-order" }),
      hook("middle", { after: ["first"] }),
      hook("first"),
    ]);

    expect(registry.executionPlan().map((item) => item.id)).toEqual([
      "first",
      "middle",
      "late",
      "stable",
    ]);
  });

  it("rejects duplicate IDs, missing dependencies and dependency cycles", () => {
    expect(() => createRuleRegistry([hook("same"), hook("same")])).toThrow(
      new RuleRegistryError("duplicate-id", "same")
    );
    expect(() =>
      createRuleRegistry([hook("one", { after: ["missing"] })])
    ).toThrow(new RuleRegistryError("missing-dependency", "one -> missing"));
    expect(() =>
      createRuleRegistry([
        hook("one", { after: ["two"] }),
        hook("two", { after: ["one"] }),
      ])
    ).toThrow(new RuleRegistryError("dependency-cycle", "one, two"));
  });

  it("does not allow preferences to disable mandatory rules or move rules across stages", () => {
    const registry = createRuleRegistry([
      hook("hard", {
        stage: "hard-constraint",
        configurable: false,
      }),
      hook("soft"),
    ]);

    expect(
      registry.executionPlan([
        { id: "hard", enabled: false, order: 99 },
        { id: "soft", enabled: false, order: 0 },
      ])
    ).toMatchObject([
      { id: "hard", enabled: true, stage: "hard-constraint" },
      { id: "soft", enabled: false, stage: "protection" },
    ]);
  });
});
