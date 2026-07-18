import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { loadState, saveState, STORAGE_KEY } from "./storage";

describe("state persistence", () => {
  it("falls back to valid defaults for corrupt persisted data", () => {
    const state = loadState({ getItem: () => "not-json" });
    expect(state.version).toBe(1);
    expect(state.staff.length).toBeGreaterThan(0);
  });

  it("round-trips the domain state", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    const state = createDefaultState();
    state.staff[0]!.remark = "changed";
    saveState(state, storage);
    expect(values.has(STORAGE_KEY)).toBe(true);
    expect(loadState(storage).staff[0]!.remark).toBe("changed");
  });

  it("removes obsolete generic support cells from afternoon and evening flights", () => {
    const state = createDefaultState();
    const afternoon = state.flights.find((flight) => flight.flightNo === "FD573")!;
    state.assignments = [{
      id: "obsolete-support", flightId: afternoon.id, flightNo: afternoon.flightNo, positionRuleId: null,
      position: "临时支援", staffId: null, staffName: "", startTime: afternoon.startTime, endTime: afternoon.endTime,
      workHours: 2, fatiguePoints: 1, remark: "", manualRemark: "", status: "manual"
    }];
    const loaded = loadState({ getItem: () => JSON.stringify(state) });
    expect(loaded.assignments).toHaveLength(0);
  });

  it("removes obsolete guide rows that were copied into flights without a position rule", () => {
    const state = createDefaultState();
    const flight = state.flights.find((item) => item.flightNo === "TR121")!;
    state.assignments = [{
      id: "copied-guide", flightId: flight.id, flightNo: flight.flightNo, positionRuleId: null,
      position: "柜台引导1", staffId: null, staffName: "", startTime: flight.startTime, endTime: flight.endTime,
      workHours: 0, fatiguePoints: 1, remark: "", manualRemark: "", status: "manual"
    }];
    const loaded = loadState({ getItem: () => JSON.stringify(state) });
    expect(loaded.assignments).toHaveLength(0);
  });
});
