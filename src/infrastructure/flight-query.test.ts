import { describe, expect, it, vi } from "vitest";

import { queryInternationalFlights } from "./flight-query";

describe("online flight query", () => {
  it("queries the selected workday from 06:00 through next-day 06:00 and keeps international flights", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      airport: "WUH",
      date: "2026-07-27",
      nextDate: "2026-07-28",
      startCutoff: 6,
      cutoff: 6,
      fetchedAt: "2026-07-26T05:49:13.434Z",
      sourceUrls: ["https://example.test/source"],
      flights: [
        { date: "2026-07-27", flight: "CX937", departureTime: "11:30", destination: "HKG", destinationCity: "Hong Kong", country: "香港", countryCode: "HK" },
        { date: "2026-07-27", flight: "MU100", departureTime: "12:00", destination: "PVG", destinationCity: "Shanghai", country: "中国大陆", countryCode: "CN" },
        { date: "2026-07-28", flight: "TR121", departureTime: "00:55", destination: "SIN", destinationCity: "Singapore", country: "新加坡", countryCode: "SG" },
        { date: "2026-07-28", flight: "XX001", departureTime: "01:00", destination: "XXX", destinationCity: "Unknown", country: "未识别", countryCode: "UNKNOWN" }
      ]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await queryInternationalFlights("2026-07-27", fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "https://flight-query-tool.vercel.app/api/flights?airport=WUH&date=2026-07-27&startCutoff=6&cutoff=6",
      { headers: { Accept: "application/json" } }
    );
    expect(result.flights.map((flight) => flight.flightNo)).toEqual(["CX937", "TR121"]);
    expect(result.flights[1]).toMatchObject({ date: "2026-07-28", departureTime: "00:55" });
  });

  it("reports an invalid response instead of importing unknown data", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));

    await expect(queryInternationalFlights("2026-07-27", fetcher)).rejects.toThrow("航班查询接口返回格式异常");
  });
});
