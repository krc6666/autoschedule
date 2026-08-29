// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { buildNextWorkdayFlightCandidates } from "../../src/domain/flights/next-workday-flight-plan";
import { buildCurrentScheduleFlightCandidates } from "../../src/domain/flights/next-workday-flight-plan";
import { replaceWeeklyFlightPlan } from "../../src/domain/flights/weekly-flight-plan";
import {
  UI_COMMAND_EVENT,
  type UiCommandEvent,
} from "../../src/ui/events/ui-command";
import "../../src/ui/components/app-dialog";
import { mountElement } from "./lit-test-helpers";

describe("next workday flight picker dialog", () => {
  it("renders current reschedule choices with today's flights selected", async () => {
    const model = createDefaultState();
    const current = [model.flights[0]!];
    current[0]!.bookedPassengers = 88;
    const candidates = buildCurrentScheduleFlightCandidates(
      model.templates,
      current
    );
    const selectedIds = candidates
      .filter((item) => item.selectedByDefault)
      .map((item) => item.id);
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-dialog", {
      model,
      dialog: {
        kind: "reschedule-flight-picker",
        date: "2026-08-29",
        candidates,
        selectedIds,
      },
    });

    expect(element.textContent).toContain("确认并重新排班");
    expect(element.textContent).not.toContain("归档并生成后天排班");
    expect(
      element.querySelectorAll('input[type="checkbox"]:checked').length
    ).toBe(1);
    expect(
      element.querySelector<HTMLInputElement>(
        'input[aria-label="CX937 预定人数"]'
      )?.value
    ).toBe("88");
  });

  it("dispatches reschedule passenger updates and selection commands", async () => {
    const model = createDefaultState();
    const candidates = buildCurrentScheduleFlightCandidates(model.templates, [
      model.flights[0]!,
    ]);
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-dialog", {
      model,
      dialog: {
        kind: "reschedule-flight-picker",
        date: "2026-08-29",
        candidates,
        selectedIds: candidates
          .filter((item) => item.selectedByDefault)
          .map((item) => item.id),
      },
    });
    const commands: UiCommandEvent["detail"][] = [];
    element.addEventListener(UI_COMMAND_EVENT, (event) => {
      commands.push((event as UiCommandEvent).detail);
    });

    const input = element.querySelector<HTMLInputElement>(
      'input[aria-label="CX937 预定人数"]'
    )!;
    input.value = "128";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(commands.at(-1)).toEqual({
      type: "update-reschedule-flight-picker-passengers",
      candidateId: candidates.find((item) => item.flightNo === "CX937")!.id,
      bookedPassengers: 128,
    });

    const unchecked = element.querySelector<HTMLInputElement>(
      'input[type="checkbox"]:not(:checked)'
    )!;
    unchecked.checked = true;
    unchecked.dispatchEvent(new Event("change", { bubbles: true }));
    expect(commands.at(-1)).toMatchObject({
      type: "update-reschedule-flight-picker-selection",
    });
  });

  it("renders local flight choices without an online query control", async () => {
    const model = createDefaultState();
    model.weeklyFlightPlans = replaceWeeklyFlightPlan(
      model.weeklyFlightPlans,
      1,
      [model.templates[0]!.flightNo]
    );
    const candidates = buildNextWorkdayFlightCandidates(
      model.templates,
      model.weeklyFlightPlans[0]!.flightNos
    );
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-dialog", {
      model,
      dialog: {
        kind: "next-workday-flight-picker",
        date: "2026-08-17",
        weekday: 1,
        candidates,
        selectedIds: candidates
          .filter((item) => item.selectedByDefault)
          .map((item) => item.id),
      },
    });

    expect(element.textContent).toContain("选择");
    expect(element.textContent).toContain("星期一");
    expect(element.textContent).toContain("恢复星期一预设");
    expect(element.textContent).toContain("全选");
    expect(element.textContent).toContain("清空");
    expect(element.textContent).toContain("已选择");
    expect(element.querySelectorAll('input[type="checkbox"]').length).toBe(
      candidates.length
    );
    const passengerInputs = element.querySelectorAll<HTMLInputElement>(
      'input[type="number"][data-next-workday-passengers]'
    );
    expect(passengerInputs.length).toBe(candidates.length);
    expect(passengerInputs[0]!.min).toBe("0");
    expect(passengerInputs[0]!.step).toBe("1");
    expect(element.textContent).not.toContain("在线查询");
  });

  it("dispatches a temporary passenger update for the edited flight", async () => {
    const model = createDefaultState();
    const candidates = buildNextWorkdayFlightCandidates(model.templates, []);
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-dialog", {
      model,
      dialog: {
        kind: "next-workday-flight-picker",
        date: "2026-08-17",
        weekday: 1,
        candidates,
        selectedIds: [candidates[0]!.id],
      },
    });
    const commands: UiCommandEvent["detail"][] = [];
    element.addEventListener(UI_COMMAND_EVENT, (event) => {
      commands.push((event as UiCommandEvent).detail);
    });
    const input = element.querySelector<HTMLInputElement>(
      'input[type="number"][data-next-workday-passengers]'
    )!;

    input.value = "128";
    input.dispatchEvent(new Event("change", { bubbles: true }));

    expect(commands.at(-1)).toEqual({
      type: "update-next-workday-flight-picker-passengers",
      candidateId: candidates[0]!.id,
      bookedPassengers: 128,
    });
  });
});
