// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { buildNextWorkdayFlightCandidates } from "../../src/domain/flights/next-workday-flight-plan";
import { replaceWeeklyFlightPlan } from "../../src/domain/flights/weekly-flight-plan";
import "../../src/ui/components/app-dialog";
import { mountElement } from "./lit-test-helpers";

describe("next workday flight picker dialog", () => {
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
    expect(element.textContent).not.toContain("在线查询");
  });
});
