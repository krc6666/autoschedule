import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { generateSchedule } from "../domain/scheduler";
import { renderSchedule } from "./schedule-view";

describe("schedule view", () => {
  it("renders aligned Bootstrap table rows without dropping configured remarks", () => {
    const state = createDefaultState();
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    const html = renderSchedule(state, "2026-07-18");
    expect(html).toContain("table table-sm table-bordered");
    expect(html).toContain("position-remark");
    expect(html).toContain("申报");
    expect(html).toContain("data-empty-slot");
    expect(html).toContain("引导岗位");
    expect(html).not.toContain("支援与行政");
    expect(html).not.toContain("flight-column-cells");
  });
});
