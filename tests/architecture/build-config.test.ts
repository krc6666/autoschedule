import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { UserConfig } from "vite";

import config from "../../vite.config";

describe("生产 Worker 构建合同", () => {
  it("开发环境直接交给 Vite 处理 HiGHS 的 WebAssembly 文件", () => {
    const resolved = config as UserConfig;

    expect(resolved.optimizeDeps?.exclude).toContain("@bubblyworld/highs-ts");
    expect(resolved.optimizeDeps?.exclude).toContain("@autoschedule/highs-ts");
  });

  it("使用支持 HiGHS 代码分包的 ES 模块格式", () => {
    const resolved = config as UserConfig;

    expect(resolved.worker?.format).toBe("es");
  });

  it("仅在用户触发外部操作或无 Worker 环境时加载大型适配器", () => {
    const root = process.cwd();
    const transfer = readFileSync(
      join(root, "src", "app", "controllers", "transfer-controller.ts"),
      "utf8"
    );
    const records = readFileSync(
      join(root, "src", "app", "controllers", "records-controller.ts"),
      "utf8"
    );
    const runner = readFileSync(
      join(root, "src", "infrastructure", "schedule-runner.ts"),
      "utf8"
    );

    expect(transfer).not.toMatch(
      /from\s+["']\.\.\/\.\.\/infrastructure\/excel["']/
    );
    expect(records).not.toMatch(
      /from\s+["']\.\.\/\.\.\/infrastructure\/(?:excel|duty-roster-excel)["']/
    );
    expect(transfer).toContain('import("../../infrastructure/excel")');
    expect(records).toContain('import("../../infrastructure/excel")');
    expect(runner).not.toMatch(/from\s+["']\.\/solver\/highs-solver["']/);
    expect(runner).toContain('import("./solver/highs-solver")');
  });

  it("把功能回归和压力基准串行纳入完整门禁", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.test).toContain(
      "--exclude tests/performance/**"
    );
    expect(packageJson.scripts["test:performance"]).toBe(
      "vitest run tests/performance"
    );
    expect(packageJson.scripts.verify).toBe(
      "npm run typecheck && npm test && npm run test:performance && npm run build"
    );
  });
});
