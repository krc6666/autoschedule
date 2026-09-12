import { describe, expect, it } from "vitest";

import type { Assignment } from "../../src/model";
import { createScheduleLedger } from "../../src/domain/kernel/schedule-ledger";
import type { HalfRestFacts } from "../../src/domain/rules/half-rest";
import { createDefaultScheduleGuards } from "../../src/domain/kernel/schedule-guard";

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

  it("rejects an illegal automatic half-rest proposal at the shared commit boundary", () => {
    const facts: HalfRestFacts = {
      requestedStaffIds: ["half-rest-worker"],
      activeStaffIds: new Set(["half-rest-worker"]),
      minimumWorkStaffIds: new Set(),
      ignoredWarnings: [],
      modesByStaffId: new Map([["half-rest-worker", "late-start"]]),
      earlyFinishStaffIds: new Set(),
      lateStartStaffIds: new Set(["half-rest-worker"]),
    };
    const illegal = {
      ...assignment,
      id: "illegal-half-rest",
      flightId: "morning-flight",
      flightNo: "M100",
      staffId: "half-rest-worker",
      staffName: "半休人员",
      startTime: "09:00",
      endTime: "11:00",
      status: "assigned" as const,
    };
    const ledger = createScheduleLedger([], {
      guards: createDefaultScheduleGuards(),
      guardContext: { phase: "partial", halfRestFacts: facts },
    });
    const legal = {
      ...illegal,
      id: "legal-half-rest",
      flightId: "afternoon-flight",
      flightNo: "A100",
      startTime: "13:00",
      endTime: "15:00",
    };
    ledger.commit({ type: "append", assignments: [legal] });

    expect(() =>
      ledger.commit({ type: "replace", assignments: [illegal] })
    ).toThrow(/半休|half-rest/i);
    expect(ledger.snapshot()).toEqual([legal]);
  });
});
