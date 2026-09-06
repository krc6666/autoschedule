// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import "../../src/ui/components/history-page";
import {
  UI_COMMAND_EVENT,
  type UiCommandEvent,
} from "../../src/ui/events/ui-command";
import { mountElement, settleLit } from "./lit-test-helpers";

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
    expect(
      element.querySelector('[aria-label="删除这条历史记录"]')
    ).not.toBeNull();
    expect(element.textContent).not.toContain("导入上一班图片");
  });

  it("emits one date-level edit command for a complete archived day", async () => {
    const state = createDefaultState();
    state.history = [
      {
        id: "editable-history",
        date: "2026-08-20",
        flightNo: "CX937",
        position: "G01",
        staffId: state.staff[0]!.id,
        staffName: state.staff[0]!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 2,
        remark: "",
        historyCoverage: "complete",
      },
    ];
    const commands: UiCommandEvent["detail"][] = [];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-history-page", { model: state });
    element.addEventListener(UI_COMMAND_EVENT, (event) => {
      commands.push((event as UiCommandEvent).detail);
    });
    await settleLit();

    const editButtons = element.querySelectorAll<HTMLButtonElement>(
      '[aria-label="编辑该日排班"]'
    );
    expect(editButtons).toHaveLength(1);
    editButtons[0]!.click();
    expect(commands).toEqual([
      { type: "edit-history-date", date: "2026-08-20" },
    ]);
  });

  it("does not offer editing for a late-priority-only archive", async () => {
    const state = createDefaultState();
    state.history = [
      {
        id: "partial-history",
        date: "2026-08-20",
        flightNo: "TR121",
        position: "H02",
        staffId: state.staff[0]!.id,
        staffName: state.staff[0]!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 4,
        remark: "一号",
        historyCoverage: "late-priority-only",
      },
    ];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-history-page", { model: state });

    expect(element.querySelector('[aria-label="编辑该日排班"]')).toBeNull();
  });
});
