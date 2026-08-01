import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("typed UI command boundary", () => {
  it("uses the current typed command event without retaining the old data-action contract", () => {
    const root = process.cwd();
    const commands = readFileSync(
      join(root, "src", "ui", "events", "ui-command.ts"),
      "utf8"
    );
    const application = readFileSync(
      join(root, "src", "ui", "components", "autoschedule-app.ts"),
      "utf8"
    );

    expect(existsSync(join(root, "src", "app-command-contract.ts"))).toBe(
      false
    );
    expect(commands).toContain("export type UiCommand");
    expect(commands).toContain("class UiCommandEvent");
    expect(application).toContain("UiCommandHandler");
    expect(application).not.toContain("data-action=");
  });
});
