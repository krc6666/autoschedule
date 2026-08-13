import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  crossFlightPriorityCandidateScore,
  crossFlightPriorityReassignmentReasons,
} from "../../src/domain/rules/cross-flight-priority";
import { reviewLateShiftRecovery } from "../../src/domain/reviews/late-shift-recovery-review";
import { defaultHighsSolver } from "../../src/infrastructure/solver/highs-solver";
import type { Assignment } from "../../src/model";

function assignment(
  id: string,
  flightNo: string,
  position: string,
  staffId: string,
  startTime = "08:00",
  endTime = "10:00"
): Assignment {
  return {
    id,
    flightId: flightNo,
    flightNo,
    positionRuleId: null,
    position,
    staffId,
    staffName: staffId,
    startTime,
    endTime,
    workHours: 2,
    fatiguePoints: 1,
    remark: "",
    manualRemark: "",
    status: "assigned",
  };
}

describe("cross-flight priority", () => {
  it("blocks moving a protected worker when the replacement has worse rotation frequency", () => {
    const state = createDefaultState();
    state.activeScheduleDate = "2026-08-21";
    state.settings.crossFlightPriorityPolicies = [
      { id: "p1", enabled: true, flightNo: "KE166", positions: ["H02"] },
    ];
    state.positionRules.push({
      id: "ke-h02",
      flightNo: "KE166",
      name: "H02",
      category: "常规",
      remark: "一号",
      qualifiedStaffIds: ["staff-1", "staff-2"],
      manual: false,
      fatiguePoints: 5,
      minPassengers: 0,
      earlyReleaseMinutes: 0,
    });
    state.history.push(
      {
        id: "history-1",
        date: "2026-08-15",
        flightNo: "KE166",
        position: "H02",
        staffId: "staff-2",
        staffName: "staff-2",
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 5,
        remark: "一号",
      },
      {
        id: "history-2",
        date: "2026-08-16",
        flightNo: "KE166",
        position: "H02",
        staffId: "staff-2",
        staffName: "staff-2",
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 5,
        remark: "一号",
      }
    );
    const original = [assignment("ke", "KE166", "H02", "staff-1")];
    const planned = [
      assignment("ke", "KE166", "H02", "staff-2"),
      assignment("cx", "CX931", "G20", "staff-1"),
    ];
    expect(
      crossFlightPriorityReassignmentReasons(
        state,
        original,
        planned,
        "2026-08-21"
      )
    ).toEqual(["调整会破坏KE166重点岗位轮换，优先保留原人员"]);
  });

  it("allows a same-frequency qualified replacement for any configured priority position", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      { id: "p1", enabled: true, flightNo: "AA100", positions: ["控制"] },
    ];
    state.positionRules.push({
      id: "aa-control",
      flightNo: "AA100",
      name: "控制",
      category: "常规",
      remark: "控制",
      qualifiedStaffIds: ["staff-1", "staff-2"],
      manual: false,
      fatiguePoints: 5,
      minPassengers: 0,
      earlyReleaseMinutes: 0,
    });
    const original = [assignment("priority", "AA100", "控制", "staff-1")];
    const planned = [
      assignment("priority", "AA100", "控制", "staff-2"),
      assignment("other", "BB200", "P1", "staff-1"),
    ];
    expect(
      crossFlightPriorityReassignmentReasons(
        state,
        original,
        planned,
        "2026-08-21"
      )
    ).toEqual([]);
  });

  it("allows a lower-frequency replacement for a configured priority position", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      { id: "p1", enabled: true, flightNo: "AA100", positions: ["P1"] },
    ];
    state.history.push({
      id: "history-priority",
      date: "2026-08-15",
      flightNo: "AA100",
      position: "P1",
      staffId: "staff-1",
      staffName: "staff-1",
      startTime: "08:00",
      endTime: "10:00",
      workHours: 2,
      fatiguePoints: 5,
      remark: "",
    });
    const original = [assignment("priority", "AA100", "P1", "staff-1")];
    const planned = [
      assignment("priority", "AA100", "P1", "staff-2"),
      assignment("other", "BB200", "P2", "staff-1"),
    ];

    expect(
      crossFlightPriorityReassignmentReasons(
        state,
        original,
        planned,
        "2026-08-21"
      )
    ).toEqual([]);
  });

  it("allows a safe exchange inside the protected flight", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      { id: "p1", enabled: true, flightNo: "KE166", positions: ["H02", "H03"] },
    ];
    const original = [
      assignment("h02", "KE166", "H02", "staff-1"),
      assignment("h03", "KE166", "H03", "staff-2"),
    ];
    const planned = [
      assignment("h02", "KE166", "H02", "staff-2"),
      assignment("h03", "KE166", "H03", "staff-1"),
    ];
    expect(
      crossFlightPriorityReassignmentReasons(
        state,
        original,
        planned,
        "2026-08-21"
      )
    ).toEqual([]);
  });

  it("lets the recovery review replace a protected-position worker with an equally rotated qualified worker", async () => {
    const state = createDefaultState();
    const [protectedWorker, replacementWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [protectedWorker!, replacementWorker!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
      person.nightShift = true;
    });
    state.settings.minimumRegularTransitionMinutes = 0;
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.workloadBalanceEnabled = false;
    state.settings.positionTransitionPolicies = [];
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "late-one",
        enabled: true,
        flightNo: "LATE900",
        matchField: "remark",
        keyword: "一号",
        nextWorkdayCutoffTime: "",
      },
    ];
    state.settings.nextWorkdayRecoveryTargets = [
      {
        id: "recovery-control",
        enabled: true,
        flightNo: "AA100",
        positionKeyword: "控制",
      },
    ];
    state.settings.crossFlightPriorityPolicies = [
      { id: "p1", enabled: true, flightNo: "AA100", positions: ["控制"] },
    ];
    state.flights = [
      {
        id: "priority-flight",
        flightNo: "AA100",
        startTime: "08:00",
        endTime: "10:00",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
      {
        id: "overlapping-flight",
        flightNo: "BB200",
        startTime: "08:00",
        endTime: "10:00",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "priority-control",
        flightNo: "AA100",
        name: "控制",
        remark: "控制",
        category: "常规",
        fatiguePoints: 5,
        qualifiedStaffIds: [protectedWorker!.id, replacementWorker!.id],
      },
      {
        ...base,
        id: "overlapping-position",
        flightNo: "BB200",
        name: "P1",
        remark: "",
        category: "常规",
        fatiguePoints: 5,
        qualifiedStaffIds: [protectedWorker!.id, replacementWorker!.id],
      },
    ];
    state.history = [
      {
        id: "previous-late-one",
        date: "2026-08-19",
        flightNo: "LATE900",
        position: "P9",
        staffId: protectedWorker!.id,
        staffName: protectedWorker!.name,
        startTime: "21:30",
        endTime: "23:30",
        workHours: 2,
        fatiguePoints: 8,
        remark: "一号",
      },
    ];
    const priority = {
      ...assignment("priority", "AA100", "控制", protectedWorker!.id),
      flightId: "priority-flight",
      positionRuleId: "priority-control",
      staffName: protectedWorker!.name,
      fatiguePoints: 5,
      remark: "控制",
    };
    const overlapping = {
      ...assignment("overlapping", "BB200", "P1", replacementWorker!.id),
      flightId: "overlapping-flight",
      positionRuleId: "overlapping-position",
      staffName: replacementWorker!.name,
      fatiguePoints: 5,
    };
    const assignments = [priority, overlapping];

    const warnings = await reviewLateShiftRecovery(
      defaultHighsSolver,
      state,
      assignments,
      "2026-08-21",
      new Set()
    );

    expect(warnings).toEqual([]);
    expect(priority.staffId).toBe(replacementWorker!.id);
    expect(overlapping.staffId).toBe(protectedWorker!.id);
    expect(
      assignments.every((item) => item.status === "assigned" && item.staffId)
    ).toBe(true);
    expect(priority.decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "late-shift-recovery",
          outcome: "selected",
        }),
      ])
    );
  });

  it("is inactive without configuration and remains generic", () => {
    const state = createDefaultState();
    expect(
      crossFlightPriorityCandidateScore(state, {
        flightNo: "KE166",
        position: "H02",
      })
    ).toBe(0);
    state.settings.crossFlightPriorityPolicies = [
      { id: "p1", enabled: true, flightNo: "AB123", positions: ["P1"] },
    ];
    expect(
      crossFlightPriorityCandidateScore(state, {
        flightNo: "AB123",
        position: "P1",
      })
    ).toBe(1);
  });

  it("does not block a non-overlapping handoff", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      { id: "p1", enabled: true, flightNo: "KE166", positions: ["H02"] },
    ];
    const original = [assignment("ke", "KE166", "H02", "staff-1")];
    const planned = [
      assignment("ke", "KE166", "H02", "staff-2"),
      assignment("cx", "CX931", "G20", "staff-1", "12:00", "14:00"),
    ];
    expect(
      crossFlightPriorityReassignmentReasons(
        state,
        original,
        planned,
        "2026-08-21"
      )
    ).toEqual([]);
  });
});
