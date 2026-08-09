import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("规则配置动作职责边界", () => {
  it("集合变更统一失效旧班表，字段清洗仍由具体规则动作负责", () => {
    const root = process.cwd();
    const app = join(root, "src", "app");
    const collectionPath = join(app, "policy-collection-actions.ts");
    const policyPath = join(app, "policy-actions.ts");

    expect(existsSync(collectionPath)).toBe(true);
    const collection = readFileSync(collectionPath, "utf8");
    const policy = readFileSync(policyPath, "utf8");

    expect(policy).toContain('from "./policy-collection-actions"');
    expect(policy).not.toContain(".findIndex(");
    expect(policy).not.toMatch(/\.filter\(\s*\(item\) => item\.id !== id/);
    expect(collection).toContain("markActiveScheduleStale");
    expect(collection).not.toContain("flightNo");
    expect(collection).not.toContain("positionKeyword");
    expect(collection).not.toContain("matchField");
    expect(policy).toContain("normalizeText");
  });
});
