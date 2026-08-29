import { describe, expect, it } from "vitest";

import {
  buildCurrentScheduleFlightCandidates,
  buildNextWorkdayFlightCandidates,
  materializeCurrentScheduleFlights,
  materializeNextWorkdayFlights,
  updateFlightSelectionBookedPassengers,
} from "../../src/domain/flights/next-workday-flight-plan";
import type { Flight, FlightTemplate } from "../../src/model";

const template = (id: string, flightNo: string): FlightTemplate => ({
  id,
  flightNo,
  startTime: "09:00",
  endTime: "11:00",
  positions: ["G18", "G19"],
  remark: "模板",
});

describe("next workday flight plan", () => {
  it("shows every template plus unmatched current flights and selects only today's flights", () => {
    const current: Flight[] = [
      {
        id: "current-cx937",
        flightNo: "CX937",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 128,
        positions: ["CURRENT"],
        remark: "当日调整",
      },
      {
        id: "current-extra",
        flightNo: "EXTRA100",
        startTime: "20:00",
        endTime: "22:00",
        bookedPassengers: 66,
        positions: ["X01"],
        remark: "当天临时航班",
      },
    ];

    const candidates = buildCurrentScheduleFlightCandidates(
      [
        template("template-cx937", "CX937"),
        template("template-ke166", "KE166"),
      ],
      current
    );

    expect(candidates.map((item) => item.flightNo)).toEqual([
      "CX937",
      "EXTRA100",
      "KE166",
    ]);
    expect(
      candidates
        .filter((item) => item.selectedByDefault)
        .map((item) => item.flightNo)
    ).toEqual(["CX937", "EXTRA100"]);
    expect(candidates.find((item) => item.flightNo === "CX937")).toMatchObject({
      bookedPassengers: 128,
      positions: ["CURRENT"],
      remark: "当日调整",
      sourceFlightId: "current-cx937",
    });
    expect(candidates.find((item) => item.flightNo === "KE166")).toMatchObject({
      bookedPassengers: 0,
      selectedByDefault: false,
    });
  });

  it("materializes the selected current schedule while preserving existing flight ids", () => {
    const current: Flight[] = [
      {
        id: "current-cx937",
        flightNo: "CX937",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 80,
        positions: ["G18"],
        remark: "当前航班",
      },
    ];
    const candidates = buildCurrentScheduleFlightCandidates(
      [
        template("template-cx937", "CX937"),
        template("template-ke166", "KE166"),
      ],
      current
    );
    const cx = candidates.find((item) => item.flightNo === "CX937")!;
    const ke = candidates.find((item) => item.flightNo === "KE166")!;
    const edited = updateFlightSelectionBookedPassengers(
      candidates,
      ke.id,
      186
    );

    expect(materializeCurrentScheduleFlights(edited, [cx.id, ke.id])).toEqual([
      expect.objectContaining({
        id: "current-cx937",
        flightNo: "CX937",
        bookedPassengers: 80,
      }),
      expect.objectContaining({
        id: "selected-ke166",
        flightNo: "KE166",
        bookedPassengers: 186,
      }),
    ]);
  });

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

  it("materializes only selected flights with their entered booked passengers", () => {
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
    const edited = updateFlightSelectionBookedPassengers(
      candidates,
      selected[0]!,
      186
    );
    const result = materializeNextWorkdayFlights(edited, selected);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      flightNo: "KE166",
      bookedPassengers: 186,
      positions: ["G18", "G19"],
    });
  });

  it("normalizes invalid passenger input without changing other candidates", () => {
    const candidates = buildNextWorkdayFlightCandidates(
      [
        template("template-cx937", "CX937"),
        template("template-ke166", "KE166"),
      ],
      []
    );

    const edited = updateFlightSelectionBookedPassengers(
      candidates,
      candidates[0]!.id,
      -12
    );

    expect(edited.map((item) => item.bookedPassengers)).toEqual([0, 0]);
    expect(edited).not.toBe(candidates);
  });
});
