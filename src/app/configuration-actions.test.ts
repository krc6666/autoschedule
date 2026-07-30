import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import {
  applyFlightPlanReconciliation,
  addFlightsFromTemplates,
  deleteStaff,
  updateConfigurationField,
} from "./configuration-actions";
import { buildFlightPlanReconciliation } from "../domain/flight-plan-reconciliation";
import type { OnlineFlightQueryResult } from "../infrastructure/flight-query";

describe("configuration actions", () => {
  it("applies a flight template and invalidates the active schedule", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const template = state.templates[1]!;
    state.assignments = [
      {
        id: "assignment",
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: null,
        position: "临时岗位",
        staffId: null,
        staffName: "",
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: 0,
        fatiguePoints: 0,
        remark: "",
        manualRemark: "",
        status: "manual",
      },
    ];
    state.activeScheduleDate = "2026-07-25";
    state.schedulePolicyStale = true;

    expect(
      updateConfigurationField(
        state,
        "flight",
        flight.id,
        "flightNo",
        template.flightNo.toLowerCase()
      )
    ).toBe("updated");
    expect(flight).toMatchObject({
      flightNo: template.flightNo,
      startTime: template.startTime,
      endTime: template.endTime,
      positions: template.positions,
    });
    expect(state.assignments).toEqual([]);
    expect(state.activeScheduleDate).toBeNull();
    expect(state.schedulePolicyStale).toBe(false);
  });

  it("keeps mobile-supervisor positions automatic and removes a deleted staff member from references", () => {
    const state = createDefaultState();
    const rule = state.positionRules[0]!;
    const person = state.staff.find((item) =>
      rule.qualifiedStaffIds.includes(item.id)
    )!;
    rule.manual = true;

    expect(
      updateConfigurationField(
        state,
        "position",
        rule.id,
        "category",
        "机动督导"
      )
    ).toBe("updated");
    expect(rule.manual).toBe(false);
    expect(deleteStaff(state, person.id)).toBe(true);
    expect(state.staff.some((item) => item.id === person.id)).toBe(false);
    expect(
      state.positionRules.every(
        (item) => !item.qualifiedStaffIds.includes(person.id)
      )
    ).toBe(true);
  });

  it("adds selected online-query templates without duplicating or overwriting existing flights", () => {
    const state = createDefaultState();
    const [existingTemplate, newTemplate] = state.templates;
    state.flights = [
      {
        ...structuredClone(existingTemplate!),
        id: "existing",
        bookedPassengers: 88,
      },
    ];
    state.assignments = [
      {
        id: "assignment",
        flightId: "existing",
        flightNo: existingTemplate!.flightNo,
        positionRuleId: null,
        position: "临时岗位",
        staffId: null,
        staffName: "",
        startTime: existingTemplate!.startTime,
        endTime: existingTemplate!.endTime,
        workHours: 0,
        fatiguePoints: 0,
        remark: "",
        manualRemark: "",
        status: "manual",
      },
    ];
    state.activeScheduleDate = "2026-07-27";

    const result = addFlightsFromTemplates(state, [
      existingTemplate!.id,
      newTemplate!.id,
      newTemplate!.id,
    ]);

    expect(result).toEqual({ added: 1, skipped: 2 });
    expect(
      state.flights.find((flight) => flight.id === "existing")?.bookedPassengers
    ).toBe(88);
    expect(
      state.flights.filter(
        (flight) => flight.flightNo === newTemplate!.flightNo
      )
    ).toHaveLength(1);
    expect(state.assignments).toEqual([]);
    expect(state.activeScheduleDate).toBeNull();
  });

  it("atomically applies selected additions and confirmed removals", () => {
    const state = createDefaultState();
    const [retainedTemplate, addedTemplate, removedTemplate] = state.templates;
    state.flights = [
      {
        ...structuredClone(retainedTemplate!),
        id: "retained",
        bookedPassengers: 88,
        remark: "人工备注",
      },
      {
        ...structuredClone(removedTemplate!),
        id: "removed",
        bookedPassengers: 66,
      },
    ];
    state.assignments = [
      {
        id: "assignment",
        flightId: "retained",
        flightNo: retainedTemplate!.flightNo,
        positionRuleId: null,
        position: "临时岗位",
        staffId: null,
        staffName: "",
        startTime: retainedTemplate!.startTime,
        endTime: retainedTemplate!.endTime,
        workHours: 0,
        fatiguePoints: 0,
        remark: "",
        manualRemark: "",
        status: "manual",
      },
    ];
    state.activeScheduleDate = "2026-07-27";
    const query: OnlineFlightQueryResult = {
      date: "2026-07-27",
      nextDate: "2026-07-28",
      fetchedAt: "2026-07-26T05:49:13.434Z",
      sourceUrls: [],
      flights: [retainedTemplate!, addedTemplate!].map((template, index) => ({
        key: String(index),
        date: "2026-07-27",
        flightNo: template.flightNo,
        departureTime: "10:00",
        destination: "ICN",
        destinationCity: "Seoul",
        country: "韩国",
        countryCode: "KR",
      })),
    };
    const reconciliation = buildFlightPlanReconciliation(
      state,
      "2026-07-27",
      query
    );

    const result = applyFlightPlanReconciliation(
      state,
      reconciliation,
      [addedTemplate!.id],
      ["removed"]
    );

    expect(result).toEqual({ added: 1, removed: 1, skipped: 0 });
    expect(state.flights.map((flight) => flight.flightNo)).toEqual([
      retainedTemplate!.flightNo,
      addedTemplate!.flightNo,
    ]);
    expect(state.flights[0]).toMatchObject({
      id: "retained",
      bookedPassengers: 88,
      remark: "人工备注",
    });
    expect(state.assignments).toEqual([]);
    expect(state.activeScheduleDate).toBeNull();
  });

  it("does not remove flights when reconciliation removal is blocked", () => {
    const state = createDefaultState();
    const query: OnlineFlightQueryResult = {
      date: "2026-07-28",
      nextDate: "2026-07-29",
      fetchedAt: "2026-07-26T05:49:13.434Z",
      sourceUrls: [],
      flights: [],
    };
    const reconciliation = buildFlightPlanReconciliation(
      state,
      "2026-07-27",
      query
    );
    const flightIds = state.flights.map((flight) => flight.id);

    const result = applyFlightPlanReconciliation(
      state,
      reconciliation,
      [],
      flightIds
    );

    expect(result.removed).toBe(0);
    expect(state.flights.map((flight) => flight.id)).toEqual(flightIds);
  });
});
