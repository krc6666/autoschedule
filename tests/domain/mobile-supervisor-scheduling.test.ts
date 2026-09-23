import { describe, expect, it } from "vitest";

import type { Assignment, PositionRule } from "../../src/model";
import { createOrdinaryStaffDefaultState } from "../helpers/ordinary-scheduling-state";
import { generateSchedule } from "../helpers/generate-schedule";
import { defaultHighsSolver } from "../../src/infrastructure/solver/highs-solver";
import { assignMobileSupervisorByCounterCoverage } from "../../src/domain/assignments/ke166-assignment";
import { createMobileSupervisorCoverageScheduleGuard } from "../../src/domain/kernel/schedule-guard";
import { createScheduleLedger } from "../../src/domain/kernel/schedule-ledger";

const DATE = "2026-09-23";

function singleFlightState() {
  const state = createOrdinaryStaffDefaultState();
  state.staff = state.staff
    .filter((person) => person.status === "正常")
    .slice(0, 3);
  state.staff.forEach((person) => {
    person.dutyQualified = false;
    person.nightShift = true;
  });
  state.flights = [
    {
      id: "cx931",
      flightNo: "CX931",
      startTime: "21:00",
      endTime: "23:00",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    },
  ];
  state.history = [];
  state.assignments = [];
  state.dutyRosterOverrides = [
    {
      date: DATE,
      cxPreflightStaffId: null,
      dutyStaffId: null,
      standbyStaffIds: [null, null],
    },
  ];
  state.settings.minimumRegularTransitionMinutes = 0;
  state.settings.workloadBalanceEnabled = false;
  state.settings.lateShiftRecoveryEnabled = false;
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.positionTransitionPolicies = [];
  state.settings.ordinaryPriorityPositions = [];
  return state;
}

function rules(
  base: PositionRule,
  supervisorIds: string[],
  counterIds: string[],
  counterRemark = ""
): PositionRule[] {
  return [
    {
      ...base,
      id: "cx931-supervisor",
      flightNo: "CX931",
      name: "督导",
      category: "机动督导",
      remark: "",
      minPassengers: 0,
      fatiguePoints: 5,
      qualifiedStaffIds: supervisorIds,
    },
    {
      ...base,
      id: "cx931-counter",
      flightNo: "CX931",
      name: "G09",
      category: "常规",
      remark: counterRemark,
      minPassengers: 0,
      fatiguePoints: 7,
      qualifiedStaffIds: counterIds,
    },
  ];
}

describe("all-flight mobile-supervisor scheduling", { timeout: 15_000 }, () => {
  it("automatically binds a non-KE166 supervisor to an allowed counter when staffing is short", async () => {
    const state = singleFlightState();
    const worker = state.staff[0]!;
    state.staff = [worker];
    state.positionRules = rules(
      state.positionRules[0]!,
      [worker.id],
      [worker.id]
    );

    const result = await generateSchedule(state, DATE);
    const supervisor = result.assignments.find(
      (assignment) => assignment.positionRuleId === "cx931-supervisor"
    )!;
    const counter = result.assignments.find(
      (assignment) => assignment.positionRuleId === "cx931-counter"
    )!;

    expect(supervisor).toMatchObject({
      staffId: worker.id,
      status: "assigned",
      workHours: 2,
      fatiguePoints: 5,
    });
    expect(counter).toMatchObject({
      staffId: worker.id,
      status: "assigned",
      workHours: 0,
      fatiguePoints: 7,
      supervisorSourceAssignmentId: supervisor.id,
    });
    expect(
      result.assignments.reduce((total, assignment) => {
        return total + assignment.workHours;
      }, 0)
    ).toBe(2);
    expect(
      result.assignments.reduce((total, assignment) => {
        return total + assignment.fatiguePoints;
      }, 0)
    ).toBe(12);
  });

  it("keeps a non-KE166 supervisor independent when an idle candidate exists", async () => {
    const state = singleFlightState();
    const counterWorker = state.staff[0]!;
    const independentSupervisor = state.staff[1]!;
    state.staff = [counterWorker, independentSupervisor];
    state.positionRules = rules(
      state.positionRules[0]!,
      [counterWorker.id, independentSupervisor.id],
      [counterWorker.id]
    );

    const result = await generateSchedule(state, DATE);
    const supervisor = result.assignments.find(
      (assignment) => assignment.positionRuleId === "cx931-supervisor"
    )!;
    const counter = result.assignments.find(
      (assignment) => assignment.positionRuleId === "cx931-counter"
    )!;

    expect(supervisor).toMatchObject({
      staffId: independentSupervisor.id,
      workHours: 2,
    });
    expect(counter).toMatchObject({
      staffId: counterWorker.id,
      workHours: 2,
    });
    expect(counter.supervisorSourceAssignmentId).toBeUndefined();
  });

  it("rebuilds and clears a previous manual supervisor binding on rerun", async () => {
    const state = singleFlightState();
    const counterWorker = state.staff[0]!;
    const independentSupervisor = state.staff[1]!;
    state.staff = [counterWorker, independentSupervisor];
    state.positionRules = rules(
      state.positionRules[0]!,
      [counterWorker.id, independentSupervisor.id],
      [counterWorker.id]
    );
    state.assignments = [
      {
        id: "manual-supervisor",
        flightId: "cx931",
        flightNo: "CX931",
        positionRuleId: "cx931-supervisor",
        position: "督导",
        staffId: counterWorker.id,
        staffName: counterWorker.name,
        startTime: "21:00",
        endTime: "23:00",
        workHours: 2,
        fatiguePoints: 5,
        remark: "",
        manualRemark: "人工兼任",
        status: "assigned",
      },
      {
        id: "manual-counter",
        flightId: "cx931",
        flightNo: "CX931",
        positionRuleId: "cx931-counter",
        position: "G09",
        staffId: counterWorker.id,
        staffName: counterWorker.name,
        startTime: "21:00",
        endTime: "23:00",
        workHours: 0,
        fatiguePoints: 7,
        remark: "",
        manualRemark: "人工兼任",
        status: "assigned",
        supervisorSourceAssignmentId: "manual-supervisor",
      },
    ];

    const result = await generateSchedule(state, DATE);
    const supervisor = result.assignments.find(
      (assignment) => assignment.positionRuleId === "cx931-supervisor"
    )!;
    const counter = result.assignments.find(
      (assignment) => assignment.positionRuleId === "cx931-counter"
    )!;

    expect(supervisor).toMatchObject({
      staffId: independentSupervisor.id,
      workHours: 2,
      manualRemark: "",
    });
    expect(counter).toMatchObject({
      staffId: counterWorker.id,
      workHours: 2,
      manualRemark: "",
    });
    expect(counter.supervisorSourceAssignmentId).toBeUndefined();
    expect(result.assignments.map((assignment) => assignment.id)).not.toEqual(
      expect.arrayContaining(["manual-supervisor", "manual-counter"])
    );
  });

  it("does not bind a non-KE166 supervisor to a forbidden counter", async () => {
    const state = singleFlightState();
    const worker = state.staff[0]!;
    state.staff = [worker];
    state.positionRules = rules(
      state.positionRules[0]!,
      [worker.id],
      [worker.id],
      "申报"
    );

    const result = await generateSchedule(state, DATE);
    const supervisor = result.assignments.find(
      (assignment) => assignment.positionRuleId === "cx931-supervisor"
    )!;
    const counter = result.assignments.find(
      (assignment) => assignment.positionRuleId === "cx931-counter"
    )!;

    expect(counter).toMatchObject({ staffId: worker.id, workHours: 2 });
    expect(counter.supervisorSourceAssignmentId).toBeUndefined();
    expect(supervisor).toMatchObject({ staffId: null, status: "unfilled" });
    expect(result.warnings).toContain("CX931 / 督导 无可用人员");
  });

  it("uses the existing safe reassignment before binding a non-KE166 supervisor", async () => {
    const state = singleFlightState();
    const supervisorWorker = state.staff[0]!;
    const relayWorker = state.staff[1]!;
    state.staff = [supervisorWorker, relayWorker];
    state.settings.mobileSupervisorCoverageRules = [
      {
        id: "forbid-blocked-counter",
        enabled: true,
        flightNo: "CX931",
        matchField: "remark",
        keyword: "不兼任",
        mode: "forbid",
      },
    ];
    const base = state.positionRules[0]!;
    const supervisorRule: PositionRule = {
      ...base,
      id: "cx931-supervisor",
      flightNo: "CX931",
      name: "督导",
      category: "机动督导",
      remark: "",
      minPassengers: 0,
      qualifiedStaffIds: [supervisorWorker.id],
    };
    const blockedCounterRule: PositionRule = {
      ...base,
      id: "cx931-g08",
      flightNo: "CX931",
      name: "G08",
      category: "常规",
      remark: "不兼任",
      minPassengers: 0,
      qualifiedStaffIds: [supervisorWorker.id, relayWorker.id],
    };
    const allowedCounterRule: PositionRule = {
      ...base,
      id: "cx931-g09",
      flightNo: "CX931",
      name: "G09",
      category: "常规",
      remark: "",
      minPassengers: 0,
      qualifiedStaffIds: [supervisorWorker.id, relayWorker.id],
    };
    state.positionRules = [
      supervisorRule,
      blockedCounterRule,
      allowedCounterRule,
    ];
    const assignments: Assignment[] = [
      {
        id: "g08-assignment",
        flightId: "cx931",
        flightNo: "CX931",
        positionRuleId: blockedCounterRule.id,
        position: blockedCounterRule.name,
        staffId: supervisorWorker.id,
        staffName: supervisorWorker.name,
        startTime: "21:00",
        endTime: "23:00",
        workHours: 2,
        fatiguePoints: blockedCounterRule.fatiguePoints,
        remark: blockedCounterRule.remark,
        manualRemark: "",
        status: "assigned",
      },
      {
        id: "g09-assignment",
        flightId: "cx931",
        flightNo: "CX931",
        positionRuleId: allowedCounterRule.id,
        position: allowedCounterRule.name,
        staffId: relayWorker.id,
        staffName: relayWorker.name,
        startTime: "21:00",
        endTime: "23:00",
        workHours: 2,
        fatiguePoints: allowedCounterRule.fatiguePoints,
        remark: allowedCounterRule.remark,
        manualRemark: "",
        status: "assigned",
      },
    ];

    const supervisor = await assignMobileSupervisorByCounterCoverage(
      defaultHighsSolver,
      state,
      assignments,
      state.flights[0]!,
      supervisorRule,
      DATE
    );

    expect(supervisor).toMatchObject({
      staffId: supervisorWorker.id,
      status: "assigned",
    });
    expect(
      assignments.find((item) => item.id === "g08-assignment")
    ).toMatchObject({
      staffId: relayWorker.id,
      workHours: 2,
    });
    expect(
      assignments.find((item) => item.id === "g09-assignment")
    ).toMatchObject({
      staffId: supervisorWorker.id,
      workHours: 0,
      supervisorSourceAssignmentId: supervisor!.id,
    });
  });

  it("does not apply the KE166 consecutive-supervisor preference to another flight", async () => {
    const state = singleFlightState();
    const firstWorker = state.staff[0]!;
    const secondWorker = state.staff[1]!;
    state.staff = [firstWorker, secondWorker];
    const base = state.positionRules[0]!;
    const supervisorRule: PositionRule = {
      ...base,
      id: "cx931-supervisor",
      flightNo: "CX931",
      name: "督导",
      category: "机动督导",
      remark: "",
      minPassengers: 0,
      qualifiedStaffIds: [firstWorker.id, secondWorker.id],
    };
    const counterRules = ["G08", "G09"].map<PositionRule>((name, index) => ({
      ...base,
      id: `cx931-counter-${index}`,
      flightNo: "CX931",
      name,
      category: "常规",
      remark: "",
      minPassengers: 0,
      fatiguePoints: 1,
      qualifiedStaffIds: [firstWorker.id, secondWorker.id],
    }));
    state.positionRules = [supervisorRule, ...counterRules];
    state.history = [
      {
        id: "previous-supervisor",
        date: "2026-09-21",
        flightNo: "CX931",
        position: "督导",
        staffId: firstWorker.id,
        staffName: firstWorker.name,
        startTime: "21:00",
        endTime: "23:00",
        workHours: 0,
        fatiguePoints: 0,
        remark: "",
      },
    ];
    const assignments: Assignment[] = counterRules.map((rule, index) => {
      const person = index === 0 ? firstWorker : secondWorker;
      return {
        id: `counter-assignment-${index}`,
        flightId: "cx931",
        flightNo: "CX931",
        positionRuleId: rule.id,
        position: rule.name,
        staffId: person.id,
        staffName: person.name,
        startTime: "21:00",
        endTime: "23:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      };
    });

    const supervisor = await assignMobileSupervisorByCounterCoverage(
      defaultHighsSolver,
      state,
      assignments,
      state.flights[0]!,
      supervisorRule,
      DATE
    );

    expect(supervisor?.staffId).toBe(firstWorker.id);
    expect(assignments[0]).toMatchObject({
      staffId: firstWorker.id,
      workHours: 0,
      supervisorSourceAssignmentId: supervisor!.id,
    });
  });

  it("rejects a later write that breaks a valid mobile-supervisor link", () => {
    const state = singleFlightState();
    const supervisorWorker = state.staff[0]!;
    const otherWorker = state.staff[1]!;
    state.staff = [supervisorWorker, otherWorker];
    state.positionRules = rules(
      state.positionRules[0]!,
      [supervisorWorker.id],
      [supervisorWorker.id, otherWorker.id]
    );
    const valid: Assignment[] = [
      {
        id: "supervisor-assignment",
        flightId: "cx931",
        flightNo: "CX931",
        positionRuleId: "cx931-supervisor",
        position: "督导",
        staffId: supervisorWorker.id,
        staffName: supervisorWorker.name,
        startTime: "21:00",
        endTime: "23:00",
        workHours: 2,
        fatiguePoints: 5,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
      {
        id: "counter-assignment",
        flightId: "cx931",
        flightNo: "CX931",
        positionRuleId: "cx931-counter",
        position: "G09",
        staffId: supervisorWorker.id,
        staffName: supervisorWorker.name,
        startTime: "21:00",
        endTime: "23:00",
        workHours: 0,
        fatiguePoints: 7,
        remark: "",
        manualRemark: "",
        status: "assigned",
        supervisorSourceAssignmentId: "supervisor-assignment",
      },
    ];
    const ledger = createScheduleLedger(valid, {
      guards: [createMobileSupervisorCoverageScheduleGuard()],
      guardContext: {
        phase: "partial",
        mobileSupervisorCoverageFacts: { state, date: DATE },
      },
    });
    const broken = valid.map((assignment) => ({ ...assignment }));
    broken[1]!.staffId = otherWorker.id;
    broken[1]!.staffName = otherWorker.name;

    expect(() =>
      ledger.commit({ type: "replace", assignments: broken })
    ).toThrow(/机动督导.*同一人员/);
    expect(ledger.snapshot()).toEqual(valid);

    const unlinked = valid.map((assignment) => ({ ...assignment }));
    delete unlinked[1]!.supervisorSourceAssignmentId;
    expect(() =>
      ledger.commit({ type: "replace", assignments: unlinked })
    ).toThrow(/机动督导.*兼任关联/);
    expect(ledger.snapshot()).toEqual(valid);
  });
});
