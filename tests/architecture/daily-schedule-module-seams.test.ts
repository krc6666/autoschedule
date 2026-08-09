import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("每日整体模型职责边界", () => {
  it("把模型建立、求解编排和结果转换放在三个明确模块中", () => {
    const root = process.cwd();
    const kernel = join(root, "src", "domain", "kernel");
    const optimizerPath = join(kernel, "daily-schedule-optimizer.ts");
    const modelPath = join(kernel, "daily-schedule-model.ts");
    const resultPath = join(kernel, "daily-schedule-result.ts");

    expect(existsSync(modelPath)).toBe(true);
    expect(existsSync(resultPath)).toBe(true);

    const optimizer = readFileSync(optimizerPath, "utf8");
    expect(optimizer).toContain('from "./daily-schedule-model"');
    expect(optimizer).toContain('from "./daily-schedule-result"');
    expect(optimizer).toContain("solver.solve");
    expect(optimizer).not.toContain("function staffChoicesForTasks");
    expect(optimizer).not.toContain("function attachDecisionTraces");
    expect(optimizer).not.toContain("function decodeAssignments");
    expect(optimizer.split(/\r?\n/).length).toBeLessThanOrEqual(100);
  });
});
