import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  movePlugin,
  movePluginRule,
  registerLoadedPlugin,
  removePlugin,
  setPluginEnabled,
  setPluginRuleEnabled,
} from "../../src/app/plugin-actions";
import type { LoadedPlugin } from "../../src/infrastructure/plugin-host";

function loaded(
  id: string,
  stage: "protection" | "stable-order" = "protection"
): LoadedPlugin {
  return {
    fileName: `${id}.js`,
    enabled: true,
    manifest: {
      apiVersion: 1,
      id,
      name: id,
      rules: [
        {
          id: "first",
          label: "第一条",
          stage,
          enabled: true,
          match: {},
          preferredStaffIds: ["1"],
        },
        {
          id: "second",
          label: "第二条",
          stage,
          enabled: true,
          match: {},
          preferredStaffIds: ["2"],
        },
      ],
    },
  };
}

describe("plugin actions", () => {
  it("registers metadata, preserves explicit settings on reload and marks schedules stale", () => {
    const state = createDefaultState();
    state.assignments = [{}] as never;
    registerLoadedPlugin(state, loaded("example.one"));
    setPluginEnabled(state, "example.one", false);
    setPluginRuleEnabled(state, "example.one", "first", false);
    registerLoadedPlugin(state, loaded("example.one"));

    expect(state.pluginConfigurations).toMatchObject([
      {
        id: "example.one",
        enabled: false,
        status: "loaded",
        rules: [
          { id: "first", enabled: false },
          { id: "second", enabled: true },
        ],
      },
    ]);
    expect(state.schedulePolicyStale).toBe(true);
  });

  it("orders plugins and same-stage rules and removes them explicitly", () => {
    const state = createDefaultState();
    registerLoadedPlugin(state, loaded("example.one"));
    registerLoadedPlugin(state, loaded("example.two"));

    expect(movePlugin(state, "example.two", -1)).toBe(true);
    expect(state.pluginConfigurations.map((plugin) => plugin.id)).toEqual([
      "example.two",
      "example.one",
    ]);
    expect(movePluginRule(state, "example.one", "second", -1)).toBe(true);
    expect(state.pluginConfigurations[1]?.rules.map((rule) => rule.id)).toEqual(
      ["second", "first"]
    );
    expect(removePlugin(state, "example.two")).toBe(true);
    expect(state.pluginConfigurations).toHaveLength(1);
  });
});
