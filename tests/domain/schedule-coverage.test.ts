import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { compactRegularAssignments } from "../../src/domain/coverage/schedule-coverage";
import { createScheduleFrequencyFacts } from "../../src/domain/statistics/schedule-frequency";
import type { Assignment, PositionRule, Staff } from "../../src/model";

function assignment(
  id: string,
  rule: PositionRule,
  person: Staff | null,
  status: Assignment["status"]
): Assignment {
  return {
    id,
    flightId: "flight",
    flightNo: "CX937",
    positionRuleId: rule.id,
    position: rule.name,
    staffId: person?.id ?? null,
    staffName: person?.name ?? "",
    startTime: "08:30",
    endTime: "10:30",
    workHours: 2,
    fatiguePoints: rule.fatiguePoints,
    remark: rule.remark,
    manualRemark: "",
    status,
  };
}

describe("regular position compaction", () => {
  it("keeps an already selected low-frequency supervisor while filling an ordinary gap", () => {
    const state = createDefaultState();
    const [underused, frequent] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [underused!, frequent!];
    const flight = {
      id: "flight",
      flightNo: "CX937",
      startTime: "08:30",
      endTime: "10:30",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    };
    state.flights = [flight];
    const base = state.positionRules[0]!;
    const supervisor = {
      ...base,
      id: "supervisor",
      flightNo: "CX937",
      name: "督导",
      remark: "",
      category: "常规",
      qualifiedStaffIds: [underused!.id, frequent!.id],
    } satisfies PositionRule;
    const gap = {
      ...base,
      id: "gap",
      flightNo: "CX937",
      name: "G19",
      remark: "",
      category: "常规",
      qualifiedStaffIds: [underused!.id, frequent!.id],
    } satisfies PositionRule;
    const tail = {
      ...base,
      id: "tail",
      flightNo: "CX937",
      name: "G13",
      remark: "",
      category: "常规",
      qualifiedStaffIds: [underused!.id, frequent!.id],
    } satisfies PositionRule;
    state.positionRules = [supervisor, gap, tail];
    const assignments = [
      assignment("supervisor-assignment", supervisor, underused!, "assigned"),
      assignment("gap-assignment", gap, null, "unfilled"),
      assignment("tail-assignment", tail, frequent!, "assigned"),
    ];

    compactRegularAssignments(
      state,
      assignments,
      new Set(),
      "2026-09-07",
      createScheduleFrequencyFacts(state, "2026-09-07")
    );

    expect(
      assignments.find((item) => item.id === "supervisor-assignment")?.staffId
    ).toBe(underused!.id);
    expect(
      assignments.find((item) => item.id === "gap-assignment")?.staffId
    ).toBe(frequent!.id);
  });
});
