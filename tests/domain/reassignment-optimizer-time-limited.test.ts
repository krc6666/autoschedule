import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { optimizeReassignment } from "../../src/domain/solver/reassignment-optimizer";
import type { SolverPort } from "../../src/domain/solver/solver-port";
import type { Assignment, Flight, PositionRule } from "../../src/model";

function fixture() {
  const state = createDefaultState();
  const [first, second] = state.staff.slice(0, 2).map((person, index) => ({
    ...person,
    id: `staff-${index}`,
    name: `人员${index}`,
    staffType: "常规" as const,
    status: "正常" as const,
  }));
  state.staff = [first!, second!];
  state.history = [];
  state.assignments = [];
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.workloadBalanceEnabled = false;
  const flight: Flight = {
    id: "flight",
    flightNo: "F100",
    startTime: "08:00",
    endTime: "10:00",
    bookedPassengers: 100,
    positions: [],
    remark: "",
  };
  const rule: PositionRule = {
    ...state.positionRules[0]!,
    id: "rule",
    flightNo: flight.flightNo,
    name: "H01",
    category: "常规",
    manual: false,
    qualifiedStaffIds: [first!.id, second!.id],
  };
  const primary: Assignment = {
    id: "primary",
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule.id,
    position: rule.name,
    staffId: first!.id,
    staffName: first!.name,
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: 2,
    fatiguePoints: rule.fatiguePoints,
    remark: "",
    manualRemark: "",
    status: "assigned",
  };
  state.flights = [flight];
  state.positionRules = [rule];
  state.assignments = [primary];
  return { state, primary };
}

const timeLimitedFeasibleSolver: SolverPort = {
  async solve() {
    return {
      termination: "time-limited-feasible" as const,
      selectedVariableIds: new Set(["0"]),
      objectiveValues: new Map(),
    };
  },
};

describe("reassignment optimizer time-limited feasible opt-in", () => {
  it("does not adopt a time-limited feasible result by default", async () => {
    const { state, primary } = fixture();
    const result = await optimizeReassignment({
      solver: timeLimitedFeasibleSolver,
      state,
      assignments: [primary],
      primary,
      movableAssignments: [],
      date: "2026-09-18",
      review: "ke166-supervisor",
      primaryCandidateAllowed: (person) => person.id === "staff-1",
    });

    expect(result.changes).toBeNull();
  });

  it("adopts a time-limited feasible result only when explicitly enabled", async () => {
    const { state, primary } = fixture();
    const result = await optimizeReassignment({
      solver: timeLimitedFeasibleSolver,
      state,
      assignments: [primary],
      primary,
      movableAssignments: [],
      date: "2026-09-18",
      review: "ke166-supervisor",
      primaryCandidateAllowed: (person) => person.id === "staff-1",
      acceptTimeLimitedFeasible: true,
    });

    expect(result.termination).toBe("time-limited-feasible");
    expect(result.changes).toEqual([
      expect.objectContaining({ assignmentId: "primary", staffId: "staff-1" }),
    ]);
  });

  it("still rejects a time-limited feasible result that fails safety review", async () => {
    const { state, primary } = fixture();
    const result = await optimizeReassignment({
      solver: timeLimitedFeasibleSolver,
      state,
      assignments: [primary],
      primary,
      movableAssignments: [],
      date: "2026-09-18",
      review: "ke166-supervisor",
      primaryCandidateAllowed: (person) => person.id === "staff-1",
      acceptTimeLimitedFeasible: true,
      validateChanges: () => ["安全复核拒绝"],
      timeoutMs: 1,
    });

    expect(result.changes).toBeNull();
  });
});
