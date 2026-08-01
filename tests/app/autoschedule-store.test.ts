import { describe, expect, it, vi } from "vitest";

import { createAutoscheduleStore } from "../../src/app/store/autoschedule-store";
import { createDefaultState } from "../../src/defaults";

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
});
