// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { ApplicationDialog } from "../../src/app/application-view-state";
import { createDefaultState } from "../../src/defaults";
import { buildFlightPlanReconciliation } from "../../src/domain/flights/flight-plan-reconciliation";
import type { OnlineFlightQueryResult } from "../../src/infrastructure/flight-query";
import "../../src/ui/components/flight-query-dialog";
import { mountElement } from "./lit-test-helpers";

function dialog(
  state: ReturnType<typeof createDefaultState>,
  result: OnlineFlightQueryResult,
  currentDate: string
): Extract<ApplicationDialog, { kind: "flight-query" }> {
  return {
    kind: "flight-query",
    date: result.date,
    loading: false,
    reconciliation: buildFlightPlanReconciliation(state, currentDate, result),
    fetchedAt: result.fetchedAt,
    error: "",
  };
}

describe("online flight query dialog", () => {
  it("keeps the editable date, 06:00 boundary, exact additions, and explicit removals", async () => {
    const state = createDefaultState();
    const template = state.templates[0]!;
    state.flights = [
      state.flights.find((flight) => flight.flightNo !== template.flightNo)!,
    ];
    const result: OnlineFlightQueryResult = {
      date: "2026-07-27",
      nextDate: "2026-07-28",
      fetchedAt: "2026-07-26T05:49:13.434Z",
      sourceUrls: [],
      flights: [
        {
          key: "exact",
          date: "2026-07-27",
          flightNo: template.flightNo,
          departureTime: "11:30",
          destination: "HKG",
          destinationCity: "Hong Kong",
          country: "香港",
          countryCode: "HK",
        },
      ],
    };
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-flight-query-dialog", {
      dialog: dialog(state, result, "2026-07-27"),
    });
    const text = element.textContent ?? "";

    expect(
      element.querySelector<HTMLInputElement>('input[type="date"]')?.value
    ).toBe("2026-07-27");
    expect(text).toContain("排除当日 00:00-06:00");
    expect(text).toContain("纳入次日 00:00-06:00");
    expect(text).toContain("建议新增");
    expect(
      element.querySelector<HTMLInputElement>('input[aria-label^="新增"]')
        ?.checked
    ).toBe(true);
    expect(
      element.querySelector<HTMLInputElement>('input[aria-label^="删除"]')
        ?.checked
    ).toBe(false);
  });

  it("blocks removal selection when query and schedule dates differ", async () => {
    const state = createDefaultState();
    const retained = state.flights[0]!;
    const result: OnlineFlightQueryResult = {
      date: "2026-07-28",
      nextDate: "2026-07-29",
      fetchedAt: "2026-07-26T05:49:13.434Z",
      sourceUrls: [],
      flights: [
        {
          key: "retained",
          date: "2026-07-28",
          flightNo: retained.flightNo,
          departureTime: "11:30",
          destination: "HKG",
          destinationCity: "Hong Kong",
          country: "香港",
          countryCode: "HK",
        },
      ],
    };
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-flight-query-dialog", {
      dialog: dialog(state, result, "2026-07-27"),
    });

    expect(element.textContent).toContain("查询日期与当前排班日期不一致");
    expect(
      element.querySelector<HTMLInputElement>('input[aria-label^="删除"]')
        ?.disabled
    ).toBe(true);
  });
});
