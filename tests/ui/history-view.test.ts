// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import "../../src/ui/components/history-page";
import { mountElement } from "./lit-test-helpers";

describe("history page", () => {
  it("groups archived work by date in a read-only flight grid", async () => {
    const state = createDefaultState();
    state.history = [
      {
        id: "h1",
        date: "2026-07-18",
        flightNo: "CX937",
        position: "G13",
        staffId: "1",
        staffName: "甲",
        startTime: "06:00",
        endTime: "08:00",
        workHours: 2,
        fatiguePoints: 2,
        remark: "申报",
      },
      {
        id: "h2",
        date: "2026-07-18",
        flightNo: "TR121",
        position: "H02",
        staffId: "2",
        staffName: "乙",
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 4,
        remark: "",
      },
      {
        id: "h3",
        date: "2026-07-16",
        flightNo: "CX937",
        position: "G13",
        staffId: "2",
        staffName: "乙",
        startTime: "06:00",
        endTime: "08:00",
        workHours: 2,
        fatiguePoints: 2,
        remark: "",
      },
    ];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-history-page", { model: state });

    expect(element.querySelectorAll(".history-day")).toHaveLength(2);
    expect(element.querySelector(".history-day")?.hasAttribute("open")).toBe(
      true
    );
    expect(
      element.querySelector(".history-day")?.querySelectorAll('th[colspan="2"]')
    ).toHaveLength(2);
    expect(element.textContent).toContain("2026-07-18");
    expect(element.textContent).toContain("CX937");
    expect(element.textContent).toContain("TR121");
    expect(element.textContent).toContain("甲");
  });
});
