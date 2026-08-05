import { describe, expect, it, vi } from "vitest";

import { createAutoscheduleStore } from "../../src/app/store/autoschedule-store";
import { createDefaultState } from "../../src/defaults";
import { buildFlightPlanReconciliation } from "../../src/domain/flights/flight-plan-reconciliation";

describe("autoschedule store", () => {
  it("exposes one state owner and commits named commands through Immer", () => {
    const store = createAutoscheduleStore(createDefaultState());
    const before = store.getState().model;
    const listener = vi.fn();
    store.subscribe(listener);

    store.getState().configuration.addStaff();

    expect(store.getState().model).not.toBe(before);
    expect(store.getState().model.staff).toHaveLength(before.staff.length + 1);
    expect(Object.isFrozen(store.getState().model.staff)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("returns domain command results without exposing a generic mutable draft", () => {
    const store = createAutoscheduleStore(createDefaultState());
    const id = store.getState().model.flights[0]!.id;

    expect(store.getState().configuration.deleteFlight(id)).toBe(true);
    expect(
      store.getState().model.flights.some((flight) => flight.id === id)
    ).toBe(false);
    expect(store.getState()).not.toHaveProperty("update");
  });

  it("adds a flight template while the command is running through Immer", () => {
    const store = createAutoscheduleStore(createDefaultState());
    const template = store.getState().model.templates[0]!;
    const beforeCount = store.getState().model.flights.length;

    expect(store.getState().configuration.addTemplateFlight(template.id)).toBe(
      true
    );
    expect(store.getState().model.flights).toHaveLength(beforeCount + 1);
    expect(store.getState().model.flights.at(-1)).toMatchObject({
      flightNo: template.flightNo,
      startTime: template.startTime,
      endTime: template.endTime,
      positions: template.positions,
      bookedPassengers: 0,
    });
  });

  it("adds online-query selections while the command is running through Immer", () => {
    const initial = createDefaultState();
    const template = initial.templates[0]!;
    initial.flights = initial.flights.filter(
      (flight) => flight.flightNo !== template.flightNo
    );
    const store = createAutoscheduleStore(initial);
    const reconciliation = buildFlightPlanReconciliation(
      store.getState().model,
      "2026-08-05",
      {
        date: "2026-08-05",
        flights: [{ flightNo: template.flightNo }],
      }
    );

    expect(
      store
        .getState()
        .configuration.applyFlightPlan(reconciliation, [template.id], [])
    ).toEqual({ added: 1, removed: 0, skipped: 0 });
    expect(
      store
        .getState()
        .model.flights.some((flight) => flight.flightNo === template.flightNo)
    ).toBe(true);
  });
});
