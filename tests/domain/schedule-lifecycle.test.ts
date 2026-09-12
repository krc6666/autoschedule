import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { Assignment } from "../../src/model";
import {
  clearActiveSchedule,
  installGeneratedSchedule,
  markActiveScheduleStale,
} from "../../src/domain/kernel/schedule-lifecycle";
import { createScheduleSafetyCredential } from "../../src/domain/kernel/schedule-safety-credential";

describe("schedule lifecycle", () => {
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
      safetyCredential: createScheduleSafetyCredential({
        date: "2026-07-30",
        assignments,
        context: { phase: "final" },
      }),
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
      safetyCredential: createScheduleSafetyCredential({
        date: "2026-07-29",
        assignments,
        context: { phase: "final" },
      }),
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
      safetyCredential: createScheduleSafetyCredential({
        date: "2026-07-30",
        assignments: result.assignments,
        context: { phase: "final" },
      }),
    });
    expect(state).toMatchObject({
      activeScheduleDate: "2026-07-30",
      schedulePolicyStale: false,
    });
    expect(markActiveScheduleStale(state)).toBe(true);
    clearActiveSchedule(state);
    expect(state).toMatchObject({
      assignments: [],
      activeScheduleDate: null,
      schedulePolicyStale: false,
    });
  });
});
