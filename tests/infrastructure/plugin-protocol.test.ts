import { describe, expect, it } from "vitest";

import {
  PLUGIN_API_VERSION,
  parsePluginManifest,
  validatePluginSource,
} from "../../src/infrastructure/plugin-protocol";

describe("plugin protocol", () => {
  it("accepts a versioned declarative candidate preference", () => {
    expect(
      parsePluginManifest({
        apiVersion: PLUGIN_API_VERSION,
        id: "example.balance",
        name: "示例规则",
        rules: [
          {
            id: "prefer-trained-staff",
            label: "优先培训人员",
            stage: "protection",
            match: { flightNo: "F100", positionKeyword: "G01" },
            preferredStaffIds: ["1", "2"],
          },
        ],
      })
    ).toMatchObject({ id: "example.balance", rules: [{ enabled: true }] });
  });

  it("rejects incompatible versions, protected stages and executable values", () => {
    expect(() =>
      parsePluginManifest({
        apiVersion: 999,
        id: "bad",
        name: "bad",
        rules: [],
      })
    ).toThrow(/API/);
    expect(() =>
      parsePluginManifest({
        apiVersion: PLUGIN_API_VERSION,
        id: "bad.plugin",
        name: "bad",
        rules: [
          {
            id: "hard",
            label: "越权",
            stage: "hard-constraint",
            match: {},
            preferredStaffIds: ["1"],
          },
        ],
      })
    ).toThrow(/阶段/);
    expect(() =>
      parsePluginManifest({
        apiVersion: PLUGIN_API_VERSION,
        id: "bad.plugin",
        name: "bad",
        rules: [{ run: () => true }],
      })
    ).toThrow();
  });

  it("requires one self-contained default export and rejects imports", async () => {
    await expect(
      validatePluginSource("export default { apiVersion: 1 };")
    ).resolves.toBeUndefined();
    await expect(
      validatePluginSource("import value from 'remote'; export default value;")
    ).rejects.toThrow(/导入/);
    await expect(
      validatePluginSource("export const value = 1;")
    ).rejects.toThrow(/default/);
  });
});
