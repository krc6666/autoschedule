import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { Assignment } from "../../src/model";
import { reviewNextDutyRest } from "../../src/domain/reviews/next-duty-rest-review";
import { defaultHighsSolver } from "../../src/infrastructure/solver/highs-solver";

describe("next workday duty rest review", () => {
  it("safely swaps the protected worker from a priority position to an ordinary position", async () => {
    const state = createDefaultState();
    const [protectedWorker, alternate] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [protectedWorker!, alternate!];
    protectedWorker!.dutyQualified = true;
    alternate!.dutyQualified = true;
    state.flights = [
      {
        id: "flight",
        flightNo: "F100",
        startTime: "18:00",
        endTime: "20:00",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "priority",
        flightNo: "F100",
        name: "G20",
        category: "常规",
        remark: "一号",
        qualifiedStaffIds: [protectedWorker!.id, alternate!.id],
      },
      {
        ...base,
        id: "ordinary",
        flightNo: "F100",
        name: "G19",
        category: "常规",
        remark: "",
        qualifiedStaffIds: [protectedWorker!.id, alternate!.id],
      },
    ];
    state.dutyRosterOverrides = [
      {
        date: "2026-08-16",
        cxPreflightStaffId: null,
        dutyStaffId: protectedWorker!.id,
        standbyStaffIds: [null, null],
      },
    ];
    const assignments: Assignment[] = [
      {
        id: "priority-assignment",
        flightId: "flight",
        flightNo: "F100",
        positionRuleId: "priority",
        position: "G20",
        staffId: protectedWorker!.id,
        staffName: protectedWorker!.name,
        startTime: "18:00",
        endTime: "20:00",
        workHours: 2,
        fatiguePoints: 4,
        remark: "一号",
        manualRemark: "",
        status: "assigned",
      },
      {
        id: "ordinary-assignment",
        flightId: "flight",
        flightNo: "F100",
        positionRuleId: "ordinary",
        position: "G19",
        staffId: alternate!.id,
        staffName: alternate!.name,
        startTime: "18:00",
        endTime: "20:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
    ];

    await expect(
      reviewNextDutyRest(
        defaultHighsSolver,
        state,
        assignments,
        "2026-08-14",
        new Set()
      )
    ).resolves.toEqual([]);
    expect(
      assignments.find((item) => item.id === "priority-assignment")?.staffId
    ).toBe(alternate!.id);
    expect(
      assignments.find((item) => item.id === "ordinary-assignment")?.staffId
    ).toBe(protectedWorker!.id);
    expect(assignments[0]?.decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "next-duty-rest",
          outcome: "selected",
        }),
      ])
    );
  });
});
