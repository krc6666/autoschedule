import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("CI workflow", () => {
  it("runs verify for pull requests as well as pushes", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "deploy-pages.yml"),
      "utf8"
    );
    expect(workflow).toMatch(/\n\s*pull_request:\s*(?:\n|$)/);
    expect(workflow).toContain("npm run verify");
  });
});
