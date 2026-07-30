import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { Assignment } from "../model";
import {
  applyRotationCycleStaff,
  findSafeRotationCycle,
  ROTATION_REVIEW_POLICIES,
  reassignmentSafetyReasons,
} from "./rotation-review-safety";

describe("rotation review safety", () => {
  it("requires an explicit safety policy for every review purpose", () => {
    expect(Object.keys(ROTATION_REVIEW_POLICIES).sort()).toEqual([
      "consecutive",
      "coverage",
      "frequency",
      "ke166-supervisor",
      "next-duty-rest",
      "recovery",
    ]);
    expect(ROTATION_REVIEW_POLICIES.coverage).toMatchObject({
      assignedCount: "may-increase",
      protectDutyMorning: false,
      transitionMode: "forbid",
    });
    expect(ROTATION_REVIEW_POLICIES.frequency).toMatchObject({
      frequency: "improve-primary",
      protectPreviousWorkdayLoad: true,
      preventStaffWithoutWork: true,
    });
  });

  function createFrequencyFixture() {
    const state = createDefaultState();
    const [originalWorker, replacementWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [originalWorker!, replacementWorker!];
    state.flights = [
      {
        id: "flight",
        flightNo: "F100",
        startTime: "08:00",
        endTime: "10:00",
        bookedPassengers: 100,
        positions: ["G20"],
        remark: "",
      },
    ];
    const baseRule = state.positionRules[0]!;
    state.positionRules = [
      {
        ...baseRule,
        id: "g20",
        flightNo: "F100",
        name: "G20",
        category: "常规",
        remark: "一号",
        qualifiedStaffIds: [originalWorker!.id, replacementWorker!.id],
      },
    ];
    const target: Assignment = {
      id: "target",
      flightId: "flight",
      flightNo: "F100",
      positionRuleId: "g20",
      position: "G20",
      staffId: originalWorker!.id,
      staffName: originalWorker!.name,
      startTime: "08:00",
      endTime: "10:00",
      workHours: 2,
      fatiguePoints: 2,
      remark: "一号",
      manualRemark: "",
      status: "assigned",
    };
    return {
      state,
      originalWorker: originalWorker!,
      replacementWorker: replacementWorker!,
      target,
    };
  }

  it("prevents a frequency reassignment from leaving the original worker with no actual work", () => {
    const { state, replacementWorker, target } = createFrequencyFixture();

    const reasons = reassignmentSafetyReasons({
      kind: "plan",
      state,
      assignments: [target],
      changes: [{ assignmentId: target.id, staffId: replacementWorker!.id }],
      primaryAssignmentId: target.id,
      date: "2026-07-30",
      review: "frequency",
    });

    expect(reasons).toContain("重排会使原人员当日无实际岗位");
  });

  it("accepts a lower-frequency replacement when the original worker keeps another assignment", () => {
    const { state, originalWorker, replacementWorker, target } =
      createFrequencyFixture();
    state.history = [
      {
        id: "history",
        date: "2026-07-28",
        flightNo: "F100",
        position: "G20",
        staffId: originalWorker.id,
        staffName: originalWorker.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 2,
        remark: "",
      },
    ];
    const otherWork: Assignment = {
      ...target,
      id: "other",
      flightId: "other-flight",
      flightNo: "F200",
      positionRuleId: null,
      position: "G18",
      staffId: originalWorker.id,
      staffName: originalWorker.name,
      startTime: "12:00",
      endTime: "14:00",
    };

    const reasons = reassignmentSafetyReasons({
      kind: "plan",
      state,
      assignments: [target, otherWork],
      changes: [{ assignmentId: target.id, staffId: replacementWorker.id }],
      primaryAssignmentId: target.id,
      date: "2026-07-30",
      review: "frequency",
    });

    expect(reasons).toEqual([]);
  });

  it("finds the shortest safe cycle through the shared search interface", () => {
    const { state, originalWorker, replacementWorker, target } =
      createFrequencyFixture();
    const baseRule = state.positionRules[0]!;
    state.positionRules.push({
      ...baseRule,
      id: "g19",
      flightNo: "F100",
      name: "G19",
      category: "常规",
      remark: "",
      qualifiedStaffIds: [originalWorker.id, replacementWorker.id],
    });
    const alternate: Assignment = {
      ...target,
      id: "alternate",
      positionRuleId: "g19",
      position: "G19",
      staffId: replacementWorker.id,
      staffName: replacementWorker.name,
      fatiguePoints: 1,
      remark: "",
    };

    const result = findSafeRotationCycle({
      state,
      assignments: [target, alternate],
      primary: target,
      date: "2026-07-30",
      review: "next-duty-rest",
      lockedAssignmentIds: new Set(),
      maxAssignments: 3,
    });

    expect(result.cycle?.map((assignment) => assignment.id)).toEqual([
      target.id,
      alternate.id,
    ]);
    expect(result.attemptedReasons).toEqual([]);
  });

  it("applies a safe cycle atomically and returns the original occupants", () => {
    const { originalWorker, replacementWorker, target } =
      createFrequencyFixture();
    const alternate: Assignment = {
      ...target,
      id: "alternate",
      positionRuleId: "g19",
      position: "G19",
      staffId: replacementWorker.id,
      staffName: replacementWorker.name,
    };

    const original = applyRotationCycleStaff([target, alternate]);

    expect(target.staffId).toBe(replacementWorker.id);
    expect(alternate.staffId).toBe(originalWorker.id);
    expect(original.map((occupant) => occupant.assignmentId)).toEqual([
      target.id,
      alternate.id,
    ]);
    expect(original.map((occupant) => occupant.staffId)).toEqual([
      originalWorker.id,
      replacementWorker.id,
    ]);
  });
});
