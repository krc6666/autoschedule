import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const sourceRoot = join(repositoryRoot, "src");

function sourceFiles(directory = sourceRoot): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry);
    return statSync(absolute).isDirectory()
      ? sourceFiles(absolute)
      : extname(absolute) === ".ts"
        ? [absolute]
        : [];
  });
}

function projectPath(file: string): string {
  return relative(repositoryRoot, file).replaceAll("\\", "/");
}

function rawHtmlTemplateCount(source: string, fileName: string): number {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isTemplateExpression(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)) &&
      /<[a-z!/]/i.test(node.getText(file))
    ) {
      const parent = node.parent;
      const isLitTemplate =
        ts.isTaggedTemplateExpression(parent) &&
        parent.template === node &&
        parent.tag.getText(file) === "html";
      if (!isLitTemplate) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

describe("断裂式重建架构门禁", () => {
  it("不保留字符串 HTML、innerHTML 或手工拼接渲染", () => {
    const renderingFiles = sourceFiles().filter((file) => {
      const path = projectPath(file);
      return (
        path === "src/app.ts" ||
        path.startsWith("src/ui/") ||
        path === "src/infrastructure/share.ts"
      );
    });
    const violations = renderingFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const reasons = [
        source.includes("innerHTML") ? "innerHTML" : "",
        rawHtmlTemplateCount(source, file) ? "HTML template string" : "",
        /\.join\(\s*["']{2}\s*\)/.test(source)
          ? "manual HTML concatenation"
          : "",
      ].filter(Boolean);
      return reasons.map((reason) => `${projectPath(file)}: ${reason}`);
    });

    expect(violations).toEqual([]);
  });

  it("应用入口只做组装，不再充当查询式页面控制器", () => {
    const source = readFileSync(join(sourceRoot, "app.ts"), "utf8");

    expect(source).not.toContain("querySelector");
    expect(source).not.toContain("addEventListener");
    expect(source).not.toContain("closest<");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(200);
  });

  it("规则注册项携带真实执行器且不存在注册表外双轨分发表", () => {
    const registry = readFileSync(
      join(sourceRoot, "domain", "rules", "rule-registry.ts"),
      "utf8"
    );
    const production = sourceFiles()
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(registry).toMatch(/execute\s*:/);
    expect(production).not.toContain("CANDIDATE_PRIORITY_COMPARATORS");
    expect(production).not.toContain("POST_SCHEDULE_REVIEW_HANDLERS");
  });

  it("不保留旧 UI 入口、兼容转发或门面 Store", () => {
    const paths = sourceFiles().map(projectPath);
    const forbidden = [
      "src/app/app-store.ts",
      "src/ui/config-view.ts",
      "src/ui/duty-roster-import-view.ts",
      "src/ui/duty-roster-view.ts",
      "src/ui/flights-view.ts",
      "src/ui/history-view.ts",
      "src/ui/online-flight-query-view.ts",
      "src/ui/overview-view.ts",
      "src/ui/schedule-policy-view.ts",
      "src/ui/schedule-progress.ts",
      "src/ui/schedule-view.ts",
      "src/ui/shell.ts",
      "src/ui/statistics-view.ts",
    ];

    expect(paths.filter((path) => forbidden.includes(path))).toEqual([]);
  });
});
