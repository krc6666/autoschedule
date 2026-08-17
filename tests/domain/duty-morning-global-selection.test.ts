import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { generateSchedule } from "../helpers/generate-schedule";

describe("duty morning global selection", () => {
  it("keeps a strict recovery target feasible when the preferred morning task overlaps it", async () => {
    const state = createDefaultState();
    const [dutyWorker, protectedWorker] = state.staff.slice(0, 2);
    expect(dutyWorker).toBeDefined();
    expect(protectedWorker).toBeDefined();
    state.staff = [dutyWorker!, protectedWorker!].map((person) => ({
      ...person,
      status: "正常",
      staffType: "常规",
      dutyQualified: true,
      nightShift: true,
    }));

    const date = "2026-08-11";
    state.dutyRosterOverrides = [
      {
        date,
        cxPreflightStaffId: null,
        dutyStaffId: dutyWorker!.id,
        standbyStaffIds: [null, null],
      },
    ];
    state.flights = [
      {
        id: "strict-target-flight",
        flightNo: "CX937",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
      {
        id: "preferred-morning-flight",
        flightNo: "KE166",
        startTime: "09:15",
        endTime: "11:15",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const baseRule = state.positionRules[0]!;
    state.positionRules = [
      {
        ...baseRule,
        id: "strict-control",
        flightNo: "CX937",
        name: "G18",
        remark: "控制",
        category: "常规",
        qualifiedStaffIds: [dutyWorker!.id, protectedWorker!.id],
      },
      {
        ...baseRule,
        id: "preferred-h04",
        flightNo: "KE166",
        name: "H04",
        remark: "",
        category: "常规",
        qualifiedStaffIds: [dutyWorker!.id, protectedWorker!.id],
      },
    ];
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.nextWorkdayRecoveryMode = "forbid";
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "late-h02",
        enabled: true,
        flightNo: "TR121",
        matchField: "position",
        keyword: "H02",
        nextWorkdayCutoffTime: "",
      },
    ];
    state.settings.nextWorkdayRecoveryTargets = [
      {
        id: "strict-cx937-g18",
        flightNo: "CX937",
        positionKeyword: "G18",
        enabled: true,
      },
    ];
    state.history = [
      {
        id: "previous-late-h02",
        date: "2026-08-09",
        flightNo: "TR121",
        position: "H02",
        staffId: protectedWorker!.id,
        staffName: protectedWorker!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 10,
        remark: "",
      },
    ];

    const result = await generateSchedule(state, date);
    const strictTarget = result.assignments.find(
      (assignment) => assignment.positionRuleId === "strict-control"
    );
    const preferredMorning = result.assignments.find(
      (assignment) => assignment.positionRuleId === "preferred-h04"
    );

    expect(result.unfilledCount).toBe(0);
    expect(strictTarget?.staffId).toBe(dutyWorker!.id);
    expect(preferredMorning?.staffId).toBe(protectedWorker!.id);
  });
});
