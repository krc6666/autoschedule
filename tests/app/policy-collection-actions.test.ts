import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  appendPolicyItem,
  deletePolicyItem,
  movePolicyItem,
  updatePolicyItem,
} from "../../src/app/policy-collection-actions";

function stateWithActiveSchedule() {
  const state = createDefaultState();
  state.assignments = [
    {
      id: "assignment",
      flightId: "flight",
      flightNo: "TR121",
      positionRuleId: null,
      position: "临时岗位",
      staffId: null,
      staffName: "",
      startTime: "20:00",
      endTime: "21:00",
      workHours: 0,
      fatiguePoints: 0,
      remark: "",
      manualRemark: "",
      status: "manual" as const,
    },
  ];
  return state;
}

describe("policy collection actions", () => {
  it("marks the active schedule stale only after a real collection change", () => {
    const state = stateWithActiveSchedule();
    const items = [{ id: "first" }, { id: "second" }];

    expect(movePolicyItem(state, items, "first", -1)).toBe(false);
    expect(deletePolicyItem(state, items, "missing")).toBe(false);
    expect(state.schedulePolicyStale).toBe(false);

    const added = appendPolicyItem(state, items, { id: "third" });
    expect(added.id).toBe("third");
    expect(state.schedulePolicyStale).toBe(true);
  });

  it("owns ordered movement and deletion without knowing policy fields", () => {
    const state = stateWithActiveSchedule();
    const items = [{ id: "first" }, { id: "second" }, { id: "third" }];

    expect(movePolicyItem(state, items, "second", -1)).toBe(true);
    expect(items.map((item) => item.id)).toEqual(["second", "first", "third"]);
    state.schedulePolicyStale = false;
    expect(deletePolicyItem(state, items, "first")).toBe(true);
    expect(items.map((item) => item.id)).toEqual(["second", "third"]);
    expect(state.schedulePolicyStale).toBe(true);
  });

  it("keeps valid unchanged updates separate from missing or invalid updates", () => {
    const state = stateWithActiveSchedule();
    const items = [{ id: "target", enabled: true }];

    expect(updatePolicyItem(state, items, "target", () => "unchanged")).toBe(
      true
    );
    expect(state.schedulePolicyStale).toBe(false);
    expect(updatePolicyItem(state, items, "target", () => "invalid")).toBe(
      false
    );
    expect(updatePolicyItem(state, items, "missing", () => "changed")).toBe(
      false
    );

    expect(
      updatePolicyItem(state, items, "target", (item) => {
        item.enabled = false;
        return "changed";
      })
    ).toBe(true);
    expect(items[0]?.enabled).toBe(false);
    expect(state.schedulePolicyStale).toBe(true);
  });
});
