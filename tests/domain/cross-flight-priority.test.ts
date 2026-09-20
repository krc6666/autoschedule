import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  crossFlightPriorityCandidateScore,
  crossFlightPriorityPolicyRank,
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

describe("cross-flight staff priority", () => {
  it("uses flight number plus selected staff and top-to-bottom order", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      { id: "ke", enabled: true, flightNo: "KE166", staffIds: ["staff-1"] },
      { id: "cx", enabled: true, flightNo: "CX937", staffIds: ["staff-1"] },
    ];
    expect(
      crossFlightPriorityPolicyRank(state, {
        flightNo: "KE166",
        staffId: "staff-1",
      })
    ).toBe(0);
    expect(
      crossFlightPriorityPolicyRank(state, {
        flightNo: "CX937",
        staffId: "staff-1",
      })
    ).toBe(1);
    expect(
      crossFlightPriorityPolicyRank(state, {
        flightNo: "KE166",
        staffId: "staff-2",
      })
    ).toBeNull();
  });

  it("protects selected staff independent of the position name", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      { id: "ke", enabled: true, flightNo: "KE166", staffIds: ["staff-1"] },
    ];
    expect(
      crossFlightPriorityCandidateScore(state, {
        flightNo: "KE166",
        staffId: "staff-1",
      })
    ).toBe(1);
    expect(
      crossFlightPriorityCandidateScore(state, {
        flightNo: "KE166",
        staffId: "staff-2",
      })
    ).toBe(0);
  });

  it("blocks a later review from moving selected staff to an overlapping flight", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      { id: "ke", enabled: true, flightNo: "KE166", staffIds: ["staff-1"] },
    ];
    const original = [assignment("ke-h02", "KE166", "H02", "staff-1")];
    const planned = [
      assignment("ke-h02", "KE166", "H02", "staff-2"),
      assignment("cx-g20", "CX937", "G20", "staff-1"),
    ];
    expect(
      crossFlightPriorityReassignmentReasons(
        state,
        original,
        planned,
        "2026-09-18"
      )
    ).toEqual(["调整会把重点人员调离KE166，优先保留原航班安排"]);
  });

  it("allows selected staff to change positions inside the priority flight", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      { id: "ke", enabled: true, flightNo: "KE166", staffIds: ["staff-1"] },
    ];
    const original = [
      assignment("ke-h02", "KE166", "H02", "staff-1"),
      assignment("ke-h03", "KE166", "H03", "staff-2"),
    ];
    const planned = [
      assignment("ke-h02", "KE166", "H02", "staff-2"),
      assignment("ke-h03", "KE166", "H03", "staff-1"),
    ];
    expect(
      crossFlightPriorityReassignmentReasons(
        state,
        original,
        planned,
        "2026-09-18"
      )
    ).toEqual([]);
  });

  it("keeps selected staff on the priority flight when a recovery review tries to swap flights", async () => {
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
      {
        id: "priority-person",
        enabled: true,
        flightNo: "AA100",
        staffIds: [protectedWorker!.id],
      },
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

    await reviewLateShiftRecovery(
      defaultHighsSolver,
      state,
      assignments,
      "2026-08-21",
      new Set()
    );

    expect(priority.staffId).toBe(protectedWorker!.id);
    expect(overlapping.staffId).toBe(replacementWorker!.id);
  });

  it("allows moving selected staff to a non-overlapping flight", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      { id: "ke", enabled: true, flightNo: "KE166", staffIds: ["staff-1"] },
    ];
    const original = [assignment("ke-h02", "KE166", "H02", "staff-1")];
    const planned = [
      assignment("ke-h02", "KE166", "H02", "staff-2"),
      assignment("cx-g20", "CX937", "G20", "staff-1", "12:00", "14:00"),
    ];
    expect(
      crossFlightPriorityReassignmentReasons(
        state,
        original,
        planned,
        "2026-09-18"
      )
    ).toEqual([]);
  });

  it("allows a later review to move selected staff from a lower row to a higher row", () => {
    const state = createDefaultState();
    state.settings.crossFlightPriorityPolicies = [
      { id: "ke", enabled: true, flightNo: "KE166", staffIds: ["staff-1"] },
      { id: "cx", enabled: true, flightNo: "CX937", staffIds: ["staff-1"] },
    ];
    const original = [assignment("cx-g20", "CX937", "G20", "staff-1")];
    const planned = [
      assignment("cx-g20", "CX937", "G20", "staff-2"),
      assignment("ke-h02", "KE166", "H02", "staff-1"),
    ];

    expect(
      crossFlightPriorityReassignmentReasons(
        state,
        original,
        planned,
        "2026-09-20"
      )
    ).toEqual([]);
  });
});
