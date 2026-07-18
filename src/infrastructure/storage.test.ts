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
});
