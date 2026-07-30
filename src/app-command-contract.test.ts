import { describe, expect, it } from "vitest";

import {
  APP_CHANGE_ACTIONS,
  APP_CLICK_ACTIONS,
  isAppAction,
  isAppChangeAction,
  isAppClickAction,
} from "./app-command-contract";

describe("app command contract", () => {
  it("keeps click and change commands disjoint and rejects unknown strings", () => {
    expect(APP_CLICK_ACTIONS.every(isAppClickAction)).toBe(true);
    expect(APP_CHANGE_ACTIONS.every(isAppChangeAction)).toBe(true);
    expect(APP_CLICK_ACTIONS.some((action) => isAppChangeAction(action))).toBe(
      false
    );
    expect(APP_CHANGE_ACTIONS.some((action) => isAppClickAction(action))).toBe(
      false
    );
    expect(isAppAction("misspelled-action")).toBe(false);
  });
});
