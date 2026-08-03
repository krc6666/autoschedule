// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import "../../src/ui/components/history-page";
import { mountElement } from "../ui/lit-test-helpers";

function historyDate(workdayIndex: number): string {
  const date = new Date(Date.UTC(2026, 6, 30 - workdayIndex * 2));
  return date.toISOString().slice(0, 10);
}

describe("history page performance safeguards", () => {
  it("opens 5000 archived records without rendering every collapsed day", async () => {
    const state = createDefaultState();
    state.history = Array.from({ length: 5000 }, (_, index) => {
      const person = state.staff[index % state.staff.length]!;
      const positionIndex = index % 25;
      return {
        id: `long-history-${index}`,
        date: historyDate(Math.floor(index / 25)),
        flightNo: `ARCHIVE${Math.floor(positionIndex / 5) + 1}`,
        position: `P${positionIndex + 1}`,
        staffId: person.id,
        staffName: person.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 2,
        remark: "",
      };
    });

    const started = performance.now();
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-history-page", { model: state });
    const elapsed = performance.now() - started;

    expect(element.querySelectorAll(".history-day")).toHaveLength(200);
    expect(element.querySelectorAll(".history-person")).toHaveLength(25);
    expect(elapsed).toBeLessThan(5000);

    const secondDay =
      element.querySelectorAll<HTMLDetailsElement>(".history-day")[1]!;
    secondDay.open = true;
    secondDay.dispatchEvent(new Event("toggle"));
    await element.updateComplete;

    expect(element.querySelectorAll(".history-person")).toHaveLength(50);
  }, 15_000);
});
