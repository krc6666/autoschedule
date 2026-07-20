import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { renderHistory } from "./history-view";

describe("history view", () => {
  it("groups archived work by date and renders each day as a read-only flight schedule", () => {
    const state = createDefaultState();
    state.history = [
      { id: "h1", date: "2026-07-18", flightNo: "CX937", position: "G13", staffId: "1", staffName: "甲", startTime: "06:00", endTime: "08:00", workHours: 2, fatiguePoints: 2, remark: "申报" },
      { id: "h2", date: "2026-07-18", flightNo: "TR121", position: "H02", staffId: "2", staffName: "乙", startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 4, remark: "" },
      { id: "h3", date: "2026-07-16", flightNo: "CX937", position: "G13", staffId: "2", staffName: "乙", startTime: "06:00", endTime: "08:00", workHours: 2, fatiguePoints: 2, remark: "" }
    ];
    const html = renderHistory(state);
    expect(html).toContain('class="history-day" open');
    expect(html).toContain('class="schedule-grid-table history-schedule-grid"');
    expect(html).toContain('<th scope="col" colspan="2">');
    expect(html).toContain("2026-07-18");
    expect(html).toContain("CX937");
    expect(html).toContain("TR121");
    expect(html).toContain("甲");
    expect(html).toContain("乙");
  });
});
