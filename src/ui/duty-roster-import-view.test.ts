import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { DutyRosterImportPreview } from "../infrastructure/duty-roster-excel";
import { renderDutyRosterImportPreview } from "./duty-roster-import-view";

describe("duty roster import preview", () => {
  it("shows actual duty and next-day standby dates before applying", () => {
    const state = createDefaultState();
    const preview: DutyRosterImportPreview = {
      month: "2026-07", referenceDate: "2026-07-01", recognizedAssignments: 3, canApply: true, warnings: ["示例提醒"], errors: [],
      rows: [{ date: "2026-07-01", standbyDate: "2026-07-02", dutyStaffId: state.staff[0]!.id, standbyStaffIds: [state.staff[1]!.id, state.staff[2]!.id] }]
    };

    const html = renderDutyRosterImportPreview(state, preview);

    expect(html).toContain("2026-07-01");
    expect(html).toContain("2026-07-02");
    expect(html).toContain("次日备勤");
    expect(html).toContain("示例提醒");
  });
});
