import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { Assignment } from "../../src/model";
import {
  clearActiveSchedule,
  installGeneratedSchedule,
  markActiveScheduleStale,
} from "../../src/domain/kernel/schedule-lifecycle";
import { createScheduleSafetySession } from "../../src/domain/kernel/schedule-safety-session";
import { createScheduleRunFacts } from "../../src/domain/shared/schedule-run-facts";

function safetyCredential(date: string, assignments: readonly Assignment[]) {
  const state = createDefaultState();
  return createScheduleSafetySession({
    phase: "final",
    state,
    date,
    runFacts: createScheduleRunFacts(state, date),
  }).createCredential(date, assignments);
}

describe("schedule lifecycle", () => {
  it("stores compact FNV fingerprints in safety credentials", () => {
    const credential = safetyCredential("2026-07-30", []);

    expect(credential.assignmentsFingerprint).toMatch(
      /^credential-v1:[0-9a-f]{16}$/
    );
    expect(credential.contextFingerprint).toMatch(
      /^credential-v1:[0-9a-f]{16}$/
    );
    expect(credential.integrityFingerprint).toMatch(
      /^credential-v1:[0-9a-f]{16}$/
    );
    expect(credential.assignmentsFingerprint).not.toContain("[");
  });

  it("rejects installing a generated result without a safety credential and preserves the old schedule", () => {
    const state = createDefaultState();
    const oldAssignment = {
      id: "old-assignment",
      flightId: "old-flight",
      flightNo: "OLD",
      positionRuleId: null,
      position: "position",
      staffId: null,
      staffName: "",
      startTime: "08:00",
      endTime: "10:00",
      workHours: 2,
      fatiguePoints: 1,
      remark: "",
      manualRemark: "",
      status: "unfilled" as const,
    };
    state.assignments = [oldAssignment];

    expect(() =>
      installGeneratedSchedule(state, "2026-07-30", {
        assignments: [],
        unfilledCount: 0,
        warnings: [],
      })
    ).toThrow(/credential|凭证|安全/i);
    expect(state.assignments).toEqual([oldAssignment]);
    expect(state.activeScheduleDate).toBeNull();
  });

  it("rejects a result whose assignments changed after final safety review", () => {
    const state = createDefaultState();
    const oldAssignment = { id: "old", status: "unfilled" as const } as never;
    state.assignments = [oldAssignment];
    const assignments: Assignment[] = [];
    const result = {
      assignments,
      unfilledCount: 0,
      warnings: [],
      safetyCredential: safetyCredential("2026-07-30", assignments),
    };
    result.assignments.push({ id: "tampered" } as never);

    expect(() => installGeneratedSchedule(state, "2026-07-30", result)).toThrow(
      /credential|凭证|安全/i
    );
    expect(state.assignments).toEqual([oldAssignment]);
  });

  it("rejects a safety credential issued for a different schedule date", () => {
    const state = createDefaultState();
    const oldAssignment = { id: "old", status: "unfilled" as const } as never;
    state.assignments = [oldAssignment];
    const assignments: Assignment[] = [];
    const result = {
      assignments,
      unfilledCount: 0,
      warnings: [],
      safetyCredential: safetyCredential("2026-07-29", assignments),
    };

    expect(() => installGeneratedSchedule(state, "2026-07-30", result)).toThrow(
      /credential|凭证|安全/i
    );
    expect(state.assignments).toEqual([oldAssignment]);
  });

  it("offers one explicit state transition for stale, cleared, and generated schedules", () => {
    const state = createDefaultState();
    const assignment = {
      id: "assignment",
      flightId: "flight",
      flightNo: "F1",
      positionRuleId: null,
      position: "岗位",
      staffId: null,
      staffName: "",
      startTime: "08:00",
      endTime: "10:00",
      workHours: 2,
      fatiguePoints: 1,
      remark: "",
      manualRemark: "",
      status: "unfilled" as const,
    };
    const result = {
      assignments: [assignment],
      unfilledCount: 1,
      warnings: [],
    };
    installGeneratedSchedule(state, "2026-07-30", {
      ...result,
      safetyCredential: safetyCredential("2026-07-30", result.assignments),
    });
    expect(state).toMatchObject({
      activeScheduleDate: "2026-07-30",
      schedulePolicyStale: false,
    });
    expect(state.scheduleRuleFingerprint).toEqual(expect.any(String));
    expect(markActiveScheduleStale(state)).toBe(true);
    clearActiveSchedule(state);
    expect(state).toMatchObject({
      assignments: [],
      activeScheduleDate: null,
      schedulePolicyStale: false,
    });
  });
});
