import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { OnlineFlightQueryResult } from "../infrastructure/flight-query";
import { renderOnlineFlightQuery } from "./online-flight-query-view";

describe("online flight query view", () => {
  it("shows an editable query date and the confirmed 06:00 workday boundary", () => {
    const html = renderOnlineFlightQuery(createDefaultState(), "2026-07-27", "2026-07-27", null);

    expect(html).toContain('id="online-flight-query-date"');
    expect(html).toContain('value="2026-07-27"');
    expect(html).toContain("排除当日 00:00–06:00");
    expect(html).toContain("纳入次日 00:00–06:00");
    expect(html).toContain('data-action="run-online-flight-query"');
  });

  it("allows exact template matches and leaves differently named flights unmatched", () => {
    const state = createDefaultState();
    state.flights = [];
    const exactTemplate = state.templates[0]!;
    const result: OnlineFlightQueryResult = {
      date: "2026-07-27",
      nextDate: "2026-07-28",
      fetchedAt: "2026-07-26T05:49:13.434Z",
      sourceUrls: [],
      flights: [
        { key: "exact", date: "2026-07-27", flightNo: exactTemplate.flightNo, departureTime: "11:30", destination: "HKG", destinationCity: "Hong Kong", country: "香港", countryCode: "HK" },
        { key: "alias", date: "2026-07-28", flightNo: "TWB616", departureTime: "01:10", destination: "ICN", destinationCity: "Seoul", country: "韩国", countryCode: "KR" }
      ]
    };

    const html = renderOnlineFlightQuery(state, "2026-07-27", "2026-07-27", result);

    expect(html).toContain(`data-template-id="${exactTemplate.id}"`);
    expect(html).toContain("建议新增");
    expect(html).toContain("TWB616");
    expect(html).toContain("缺少同名模板");
    expect(html).toContain('data-action="apply-flight-plan-reconciliation"');
  });

  it("shows removal candidates unchecked and blocks them when the result date differs", () => {
    const state = createDefaultState();
    const retained = state.flights[0]!;
    const removal = state.flights[1]!;
    const result: OnlineFlightQueryResult = {
      date: "2026-07-28", nextDate: "2026-07-29", fetchedAt: "2026-07-26T05:49:13.434Z", sourceUrls: [],
      flights: [{ key: "retained", date: "2026-07-28", flightNo: retained.flightNo, departureTime: "11:30", destination: "HKG", destinationCity: "Hong Kong", country: "香港", countryCode: "HK" }]
    };

    const html = renderOnlineFlightQuery(state, "2026-07-27", "2026-07-28", result);

    expect(html).toContain("待确认删减");
    expect(html).toContain(removal.flightNo);
    expect(html).toMatch(new RegExp(`name="online-flight-removal"[^>]*value="${removal.id}"[^>]*disabled`));
    expect(html).not.toMatch(new RegExp(`name="online-flight-removal"[^>]*value="${removal.id}"[^>]*checked`));
    expect(html).toContain("查询日期与当前排班日期不一致");
  });

  it("leaves same-date removal candidates enabled but unchecked", () => {
    const state = createDefaultState();
    const retained = state.flights[0]!;
    const removal = state.flights[1]!;
    const result: OnlineFlightQueryResult = {
      date: "2026-07-27", nextDate: "2026-07-28", fetchedAt: "2026-07-26T05:49:13.434Z", sourceUrls: [],
      flights: [{ key: "retained", date: "2026-07-27", flightNo: retained.flightNo, departureTime: "11:30", destination: "HKG", destinationCity: "Hong Kong", country: "香港", countryCode: "HK" }]
    };

    const html = renderOnlineFlightQuery(state, "2026-07-27", "2026-07-27", result);
    const removalCheckbox = html.match(new RegExp(`<input[^>]*name="online-flight-removal"[^>]*value="${removal.id}"[^>]*>`))?.[0];

    expect(removalCheckbox).toBeDefined();
    expect(removalCheckbox).not.toContain("checked");
    expect(removalCheckbox).not.toContain("disabled");
  });
});
