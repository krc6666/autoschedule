import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type {
  AppState,
  Assignment,
  Flight,
  PositionRule,
} from "../../src/model";
import { evaluateAutomaticHardConstraints } from "../../src/domain/rules/built-in-rule-registry";
import { timeConflictAssignmentIds } from "../../src/domain/assignments/assignment-time-conflicts";

function conflictState(): AppState {
  const state = createDefaultState();
  const person = {
    ...state.staff[0]!,
    id: "conflict-person",
    name: "冲突人员",
    status: "正常" as const,
    staffType: "常规" as const,
    nightShift: true,
  };
  state.staff = [person];
  state.flights = [];
  state.positionRules = [];
  state.assignments = [];
  state.history = [];
  state.settings.minimumRegularTransitionMinutes = 0;
  state.settings.mobileSupervisorCoverageRules = [];
  state.settings.mobileSupervisorFillRules = [];
  return state;
}

function addFlight(
  state: AppState,
  id: string,
  startTime: string,
  endTime: string
): Flight {
  const flight: Flight = {
    id,
    flightNo: id.toUpperCase(),
    startTime,
    endTime,
    bookedPassengers: 100,
    positions: [],
    remark: "",
  };
  state.flights.push(flight);
  return flight;
}

function addAssignment(
  state: AppState,
  flight: Flight,
  options: {
    id: string;
    name: string;
    category?: PositionRule["category"];
    coverageRole?: PositionRule["coverageRole"];
    earlyReleaseMinutes?: number;
    staffId?: string;
    supervisorSourceAssignmentId?: string;
    supervisorFillRuleId?: string;
  }
): Assignment {
  const baseRule = createDefaultState().positionRules[0]!;
  const rule: PositionRule = {
    ...baseRule,
    id: `${options.id}-rule`,
    flightNo: flight.flightNo,
    name: options.name,
    category: options.category ?? "常规",
    coverageRole: options.coverageRole,
    earlyReleaseMinutes: options.earlyReleaseMinutes ?? 0,
    qualifiedStaffIds: state.staff.map((person) => person.id),
    manual: false,
    minPassengers: 0,
  };
  const staffId = options.staffId ?? state.staff[0]!.id;
  const assignment: Assignment = {
    id: options.id,
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule.id,
    position: rule.name,
    staffId,
    staffName:
      state.staff.find((person) => person.id === staffId)?.name ?? "其他人员",
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: 2,
    fatiguePoints: 1,
    remark: "",
    manualRemark: "",
    status: "assigned",
    supervisorSourceAssignmentId: options.supervisorSourceAssignmentId,
    supervisorFillRuleId: options.supervisorFillRuleId,
  };
  state.positionRules.push(rule);
  state.assignments.push(assignment);
  return assignment;
}

function expectNoConflict(state: AppState, ...assignments: Assignment[]): void {
  const ids = timeConflictAssignmentIds(state, state.assignments);
  for (const assignment of assignments)
    expect(ids.has(assignment.id)).toBe(false);
}

function expectConflict(state: AppState, ...assignments: Assignment[]): void {
  const ids = timeConflictAssignmentIds(state, state.assignments);
  for (const assignment of assignments)
    expect(ids.has(assignment.id)).toBe(true);
}

describe("assignment time conflict display facts", () => {
  it("excludes a valid same-flight mobile-supervisor counter reuse", () => {
    const state = conflictState();
    const flight = addFlight(state, "same-flight", "08:00", "10:00");
    const supervisor = addAssignment(state, flight, {
      id: "supervisor",
      name: "机动督导",
      category: "机动督导",
    });
    const counter = addAssignment(state, flight, {
      id: "counter",
      name: "H05",
      supervisorSourceAssignmentId: supervisor.id,
    });
    state.settings.mobileSupervisorCoverageRules = [
      {
        id: "allow-h05",
        enabled: true,
        flightNo: flight.flightNo,
        matchField: "position",
        keyword: "H05",
        mode: "allow",
      },
    ];

    expectNoConflict(state, supervisor, counter);
  });

  it("excludes a valid recorded supervisor-fill relation", () => {
    const state = conflictState();
    const flight = addFlight(state, "fill-flight", "08:00", "10:00");
    const supervisor = addAssignment(state, flight, {
      id: "fill-supervisor",
      name: "机动督导",
      category: "机动督导",
    });
    const target = addAssignment(state, flight, {
      id: "fill-target",
      name: "H05",
      coverageRole: "supervisor-fill",
      supervisorSourceAssignmentId: supervisor.id,
      supervisorFillRuleId: "fill-rule",
    });
    target.workHours = 0;
    target.fatiguePoints = 0;
    state.settings.mobileSupervisorFillRules = [
      {
        id: "fill-rule",
        enabled: true,
        sourceFlightNo: flight.flightNo,
        sourcePositionKeyword: "机动督导",
        targetFlightNo: flight.flightNo,
        targetPositionKeyword: "H05",
        allowAutomatic: false,
        allowManual: true,
      },
    ];

    expectNoConflict(state, supervisor, target);
  });

  it("excludes a valid diversion early-release transfer", () => {
    const state = conflictState();
    const diversionFlight = addFlight(state, "diversion", "13:00", "15:00");
    const nextFlight = addFlight(state, "next", "14:30", "16:00");
    const diversion = addAssignment(state, diversionFlight, {
      id: "diversion-assignment",
      name: "分流",
      category: "分流",
      earlyReleaseMinutes: 60,
    });
    const next = addAssignment(state, nextFlight, {
      id: "next-assignment",
      name: "H01",
    });

    expectNoConflict(state, diversion, next);
  });

  it("excludes a valid same-flight guide reuse", () => {
    const state = conflictState();
    const flight = addFlight(state, "guide-flight", "08:00", "10:00");
    const source = addAssignment(state, flight, {
      id: "guide-source",
      name: "H01",
    });
    const guide = addAssignment(state, flight, {
      id: "guide",
      name: "柜台引导",
      category: "引导",
    });
    guide.workHours = 0;
    guide.fatiguePoints = 0;

    expectNoConflict(state, source, guide);
  });

  it("keeps a mobile supervisor purple for a real cross-flight overlap", () => {
    const state = conflictState();
    const firstFlight = addFlight(state, "first", "08:00", "10:00");
    const secondFlight = addFlight(state, "second", "09:00", "11:00");
    const supervisor = addAssignment(state, firstFlight, {
      id: "cross-supervisor",
      name: "机动督导",
      category: "机动督导",
    });
    const counter = addAssignment(state, secondFlight, {
      id: "cross-counter",
      name: "H05",
      supervisorSourceAssignmentId: supervisor.id,
    });

    expectConflict(state, supervisor, counter);
  });

  it("keeps a diversion worker purple outside the early-release window", () => {
    const state = conflictState();
    const diversionFlight = addFlight(
      state,
      "long-diversion",
      "13:00",
      "15:00"
    );
    const nextFlight = addFlight(state, "early-next", "13:30", "16:00");
    const diversion = addAssignment(state, diversionFlight, {
      id: "long-diversion-assignment",
      name: "分流",
      category: "分流",
      earlyReleaseMinutes: 60,
    });
    const next = addAssignment(state, nextFlight, {
      id: "early-next-assignment",
      name: "H01",
    });

    expectConflict(state, diversion, next);
  });

  it("keeps broken or mismatched supervisor relations purple", () => {
    const state = conflictState();
    const otherPerson = {
      ...state.staff[0]!,
      id: "other-person",
      name: "其他人员",
    };
    state.staff.push(otherPerson);
    const flight = addFlight(state, "broken-flight", "08:00", "10:00");
    const supervisor = addAssignment(state, flight, {
      id: "broken-supervisor",
      name: "机动督导",
      category: "机动督导",
    });
    const unlinked = addAssignment(state, flight, {
      id: "unlinked-counter",
      name: "H05",
    });

    expectConflict(state, supervisor, unlinked);

    const mismatchedSource = addAssignment(state, flight, {
      id: "mismatched-supervisor",
      name: "另一机动督导",
      category: "机动督导",
      staffId: otherPerson.id,
    });
    unlinked.supervisorSourceAssignmentId = mismatchedSource.id;
    expectConflict(state, supervisor, unlinked);
  });

  it("does not treat a broken supervisor-fill link as ordinary counter reuse", () => {
    const state = conflictState();
    const flight = addFlight(state, "broken-fill-flight", "08:00", "10:00");
    const supervisor = addAssignment(state, flight, {
      id: "broken-fill-supervisor",
      name: "机动督导",
      category: "机动督导",
    });
    const target = addAssignment(state, flight, {
      id: "broken-fill-target",
      name: "H05",
      coverageRole: "supervisor-fill",
      supervisorSourceAssignmentId: supervisor.id,
    });
    state.settings.mobileSupervisorFillRules = [
      {
        id: "required-fill-rule",
        enabled: true,
        sourceFlightNo: flight.flightNo,
        sourcePositionKeyword: "机动督导",
        targetFlightNo: flight.flightNo,
        targetPositionKeyword: "H05",
        allowAutomatic: true,
        allowManual: true,
      },
    ];

    expectConflict(state, supervisor, target);
  });

  it("keeps ordinary same-flight and cross-flight overlaps purple", () => {
    const state = conflictState();
    const firstFlight = addFlight(state, "ordinary-a", "08:00", "10:00");
    const secondFlight = addFlight(state, "ordinary-b", "09:00", "11:00");
    const first = addAssignment(state, firstFlight, {
      id: "ordinary-first",
      name: "H01",
    });
    const sameFlight = addAssignment(state, firstFlight, {
      id: "ordinary-same-flight",
      name: "H02",
    });
    const crossFlight = addAssignment(state, secondFlight, {
      id: "ordinary-cross-flight",
      name: "H03",
    });

    expectConflict(state, first, sameFlight, crossFlight);
  });

  it("removes purple as soon as the overlap is removed or a valid relation is restored", () => {
    const state = conflictState();
    const flight = addFlight(state, "restored-flight", "08:00", "10:00");
    const supervisor = addAssignment(state, flight, {
      id: "restored-supervisor",
      name: "机动督导",
      category: "机动督导",
    });
    const counter = addAssignment(state, flight, {
      id: "restored-counter",
      name: "H05",
    });
    state.settings.mobileSupervisorCoverageRules = [
      {
        id: "restore-h05",
        enabled: true,
        flightNo: flight.flightNo,
        matchField: "position",
        keyword: "H05",
        mode: "allow",
      },
    ];
    expectConflict(state, supervisor, counter);

    counter.supervisorSourceAssignmentId = supervisor.id;
    expectNoConflict(state, supervisor, counter);

    delete counter.supervisorSourceAssignmentId;
    const otherPerson = {
      ...state.staff[0]!,
      id: "resolved-person",
      name: "解除冲突人员",
    };
    state.staff.push(otherPerson);
    counter.staffId = otherPerson.id;
    counter.staffName = otherPerson.name;
    expectNoConflict(state, supervisor, counter);
  });

  it("does not relax the automatic hard time-conflict constraint", () => {
    const state = conflictState();
    const firstFlight = addFlight(state, "automatic-a", "08:00", "10:00");
    const secondFlight = addFlight(state, "automatic-b", "09:00", "11:00");
    addAssignment(state, firstFlight, {
      id: "automatic-existing",
      name: "H01",
    });
    const targetRule = addAssignment(state, secondFlight, {
      id: "automatic-target",
      name: "H02",
    });
    state.assignments.pop();

    const diagnostic = evaluateAutomaticHardConstraints({
      state,
      assignments: state.assignments,
      flight: secondFlight,
      rule: state.positionRules.find(
        (rule) => rule.id === targetRule.positionRuleId
      )!,
      person: state.staff[0]!,
      workHours: 2,
      transitionMode: "forbid",
    });

    expect(diagnostic.eligible).toBe(false);
    expect(diagnostic.violations.map((violation) => violation.code)).toContain(
      "time-conflict"
    );
  });
});
