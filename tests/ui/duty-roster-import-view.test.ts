// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { DutyRosterImportPreview } from "../../src/infrastructure/duty-roster-excel";
import "../../src/ui/components/duty-roster-import-dialog";
import { mountElement } from "./lit-test-helpers";

describe("duty roster import dialog", () => {
  it("shows real duty and next-day standby dates before applying", async () => {
    const state = createDefaultState();
    const preview: DutyRosterImportPreview = {
      month: "2026-07",
      referenceDate: "2026-07-01",
      recognizedAssignments: 3,
      canApply: true,
      warnings: ["示例提醒"],
      errors: [],
      rows: [
        {
          date: "2026-07-01",
          standbyDate: "2026-07-02",
          dutyStaffId: state.staff[0]!.id,
          standbyStaffIds: [state.staff[1]!.id, state.staff[2]!.id],
        },
      ],
    };
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-duty-roster-import-dialog", { model: state, preview });

    expect(element.textContent).toContain("2026-07-01");
    expect(element.textContent).toContain("2026-07-02");
    expect(element.textContent).toContain("次日备勤");
    expect(element.textContent).toContain("示例提醒");
    expect(
      element.querySelector<HTMLButtonElement>(".btn-primary")?.disabled
    ).toBe(false);
  });
});
