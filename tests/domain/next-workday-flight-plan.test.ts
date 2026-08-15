import { describe, expect, it } from "vitest";

import {
  buildNextWorkdayFlightCandidates,
  materializeNextWorkdayFlights,
} from "../../src/domain/flights/next-workday-flight-plan";
import type { FlightTemplate } from "../../src/model";

const template = (id: string, flightNo: string): FlightTemplate => ({
  id,
  flightNo,
  startTime: "09:00",
  endTime: "11:00",
  positions: ["G18", "G19"],
  remark: "模板",
});

describe("next workday flight plan", () => {
  it("uses the target weekday plan instead of the current shift as the default selection", () => {
    const candidates = buildNextWorkdayFlightCandidates(
      [
        template("template-cx937", "CX937"),
        template("template-ke166", "KE166"),
      ],
      ["KE166"]
    );

    expect(candidates.map((item) => item.flightNo)).toEqual(["CX937", "KE166"]);
    expect(
      candidates
        .filter((item) => item.selectedByDefault)
        .map((item) => item.flightNo)
    ).toEqual(["KE166"]);
  });

  it("materializes only selected flights with zero booked passengers", () => {
    const candidates = buildNextWorkdayFlightCandidates(
      [
        template("template-cx937", "CX937"),
        template("template-ke166", "KE166"),
      ],
      ["KE166"]
    );

    const selected = candidates
      .filter((item) => item.flightNo === "KE166")
      .map((item) => item.id);
    const result = materializeNextWorkdayFlights(candidates, selected);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      flightNo: "KE166",
      bookedPassengers: 0,
      positions: ["G18", "G19"],
    });
  });
});
