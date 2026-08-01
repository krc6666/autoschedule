import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { registerLoadedPlugin } from "../../src/app/plugin-actions";
import type { LoadedPlugin } from "../../src/infrastructure/plugin-host";
import { PluginSession } from "../../src/infrastructure/plugin-session";

const loaded: LoadedPlugin = {
  fileName: "sample.js",
  enabled: true,
  manifest: {
    apiVersion: 1,
    id: "sample.plugin",
    name: "示例插件",
    rules: [
      {
        id: "first",
        label: "第一条",
        stage: "protection",
        enabled: true,
        match: {},
        preferredStaffIds: ["1"],
      },
      {
        id: "second",
        label: "第二条",
        stage: "stable-order",
        enabled: true,
        match: {},
        preferredStaffIds: ["2"],
      },
    ],
  },
};

describe("plugin session", () => {
  it("projects only loaded and enabled metadata without persisting source", () => {
    const state = createDefaultState();
    const session = new PluginSession();
    session.install(loaded);
    registerLoadedPlugin(state, loaded);
    state.pluginConfigurations[0]!.rules[0]!.enabled = false;

    expect(
      session.manifests(state.pluginConfigurations)[0]?.rules
    ).toMatchObject([
      { id: "first", enabled: false },
      { id: "second", enabled: true },
    ]);
    state.pluginConfigurations[0]!.status = "needs-reload";
    expect(session.manifests(state.pluginConfigurations)).toEqual([]);
  });
});
