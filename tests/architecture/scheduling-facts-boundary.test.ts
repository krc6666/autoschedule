import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const domainRoot = join(repositoryRoot, "src", "domain");
const allowedAppStateImports = new Set([
  "src/domain/flights/flight-plan-reconciliation.ts",
  "src/domain/kernel/schedule-lifecycle.ts",
  "src/domain/shared/scheduling-facts.ts",
]);

function domainFiles(directory = domainRoot): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry);
    return statSync(absolute).isDirectory()
      ? domainFiles(absolute)
      : extname(absolute) === ".ts"
        ? [absolute]
        : [];
  });
}

function projectPath(file: string): string {
  return relative(repositoryRoot, file).replaceAll("\\", "/");
}

function importsAppState(fileName: string): boolean {
  const source = readFileSync(fileName, "utf8");
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  return file.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) => element.name.text === "AppState"
      )
  );
}

describe("排班事实依赖边界", () => {
  it("完整 AppState 只进入投影和应用状态职责", () => {
    const directImports = domainFiles()
      .filter(importsAppState)
      .map(projectPath)
      .sort();

    expect(directImports).toEqual([...allowedAppStateImports].sort());
  });
});
