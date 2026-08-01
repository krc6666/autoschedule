import { describe, expect, it } from "vitest";

import type { Assignment } from "../../src/model";
import { createScheduleLedger } from "../../src/domain/kernel/schedule-ledger";

const assignment: Assignment = {
  id: "assignment-1",
  flightId: "flight-1",
  flightNo: "F100",
  positionRuleId: "rule-1",
  position: "G01",
  staffId: null,
  staffName: "",
  startTime: "08:00",
  endTime: "10:00",
  workHours: 2,
  fatiguePoints: 1,
  remark: "",
  manualRemark: "",
  status: "unfilled",
};

describe("schedule ledger", () => {
  it("exposes immutable snapshots and commits validated proposals atomically", () => {
    const ledger = createScheduleLedger();
    ledger.commit({ type: "append", assignments: [assignment] });
    const before = ledger.snapshot();

    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before[0])).toBe(true);
    expect(() => {
      (before[0] as Assignment).staffId = "staff-1";
    }).toThrow();

    expect(() =>
      ledger.commit({
        type: "replace",
        assignments: [
          { ...assignment, id: "duplicate" },
          { ...assignment, id: "duplicate" },
        ],
      })
    ).toThrow(/重复/);
    expect(ledger.snapshot()).toEqual(before);
  });
});
