import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { renderShell } from "./shell";

describe("application shell", () => {
  it("places scheduling policy after schedule as the fifth work module", () => {
    const html = renderShell(createDefaultState(), "policy", "2026-07-18", "");
    expect(html).toContain('data-nav="policy"');
    expect(html.indexOf('data-nav="schedule"')).toBeLessThan(html.indexOf('data-nav="policy"'));
    expect(html.indexOf('data-nav="policy"')).toBeLessThan(html.indexOf('data-nav="history"'));
  });
});
