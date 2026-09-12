import { describe, expect, it } from "vitest";

import type { Assignment } from "../../src/model";
import type { HalfRestFacts } from "../../src/domain/rules/half-rest";
import {
  ScheduleGuardError,
  assertScheduleAssignmentsSafe,
  createDefaultScheduleGuards,
} from "../../src/domain/kernel/schedule-guard";

const halfRestFacts: HalfRestFacts = {
  requestedStaffIds: ["half-rest-worker"],
  activeStaffIds: new Set(["half-rest-worker"]),
  minimumWorkStaffIds: new Set(),
  ignoredWarnings: [],
  modesByStaffId: new Map([["half-rest-worker", "late-start"]]),
  earlyFinishStaffIds: new Set(),
  lateStartStaffIds: new Set(["half-rest-worker"]),
};

const legalAfternoonAssignment: Assignment = {
  id: "afternoon-assignment",
  flightId: "flight-afternoon",
  flightNo: "A100",
  positionRuleId: "rule-1",
  position: "G01",
  staffId: "half-rest-worker",
  staffName: "半休人员",
  startTime: "13:00",
  endTime: "15:00",
  workHours: 2,
  fatiguePoints: 1,
  remark: "",
  manualRemark: "",
  status: "assigned",
};

const illegalMorningAssignment: Assignment = {
  ...legalAfternoonAssignment,
  id: "morning-assignment",
  flightId: "flight-morning",
  flightNo: "M100",
  startTime: "09:00",
  endTime: "11:00",
};

describe("unified schedule guard", () => {
  it("keeps a legal result safe, then rejects a post-stage move before noon", () => {
    expect(() =>
      assertScheduleAssignmentsSafe({
        assignments: [legalAfternoonAssignment],
        context: { phase: "partial", halfRestFacts },
        guards: createDefaultScheduleGuards(),
      })
    ).not.toThrow();

    expect(() =>
      assertScheduleAssignmentsSafe({
        assignments: [illegalMorningAssignment],
        context: { phase: "partial", halfRestFacts },
        guards: createDefaultScheduleGuards(),
      })
    ).toThrow(ScheduleGuardError);
  });

  it("allows manual assignments in the automatic guard boundary", () => {
    expect(() =>
      assertScheduleAssignmentsSafe({
        assignments: [{ ...illegalMorningAssignment, status: "manual" }],
        context: { phase: "partial", halfRestFacts },
        guards: createDefaultScheduleGuards(),
      })
    ).not.toThrow();
  });
});
