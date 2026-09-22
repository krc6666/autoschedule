import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { Assignment, PositionRule } from "../../src/model";
import { createScheduleLedger } from "../../src/domain/kernel/schedule-ledger";
import { schedulingDecision } from "../../src/domain/rules/schedule-rule-contract";
import type { HalfRestFacts } from "../../src/domain/rules/half-rest";
import { createScheduleFrequencyFacts } from "../../src/domain/statistics/schedule-frequency";
import {
  createDefaultScheduleGuards,
  createSameDayLateObligationScheduleGuard,
  createLateShiftPositionReliefScheduleGuard,
  createKe166SnapshotScheduleGuard,
  createScarceQualificationScheduleGuard,
  createDutyPositionScheduleGuard,
  ScheduleGuardError,
  type ScheduleGuardContext,
} from "../../src/domain/kernel/schedule-guard";

const assignment: Assignment = {
  id: "assignment-1",
  flightId: "flight-1",
  flightNo: "F100",
  positionRuleId: "rule-1",
  position: "G01",
  staffId: null,
  staffName: "",
  startTime: "08:00",
  endTime: "10:00",
  workHours: 2,
  fatiguePoints: 1,
  remark: "",
  manualRemark: "",
  status: "unfilled",
};

describe("schedule ledger", () => {
  it("reports a readable missing guard context error", () => {
    const ledger = createScheduleLedger([], {
      guards: [createDefaultScheduleGuards()[0]!],
    });

    expect(() =>
      ledger.commit({ type: "append", assignments: [assignment] })
    ).toThrow("排班 ledger 守卫缺少上下文");
  });

  it("exposes immutable snapshots and commits validated proposals atomically", () => {
    const ledger = createScheduleLedger();
    ledger.commit({ type: "append", assignments: [assignment] });
    const before = ledger.snapshot();

    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before[0])).toBe(true);
    expect(() => {
      (before[0] as Assignment).staffId = "staff-1";
    }).toThrow();

    expect(() =>
      ledger.commit({
        type: "replace",
        assignments: [
          { ...assignment, id: "duplicate" },
          { ...assignment, id: "duplicate" },
        ],
      })
    ).toThrow(/重复/);
    expect(ledger.snapshot()).toEqual(before);
  });

  it("rejects an illegal automatic half-rest proposal at the shared commit boundary", () => {
    const facts: HalfRestFacts = {
      requestedStaffIds: ["half-rest-worker"],
      activeStaffIds: new Set(["half-rest-worker"]),
      minimumWorkStaffIds: new Set(),
      ignoredWarnings: [],
      modesByStaffId: new Map([["half-rest-worker", "late-start"]]),
      earlyFinishStaffIds: new Set(),
      lateStartStaffIds: new Set(["half-rest-worker"]),
    };
    const illegal = {
      ...assignment,
      id: "illegal-half-rest",
      flightId: "morning-flight",
      flightNo: "M100",
      staffId: "half-rest-worker",
      staffName: "半休人员",
      startTime: "09:00",
      endTime: "11:00",
      status: "assigned" as const,
    };
    const ledger = createScheduleLedger([], {
      guards: createDefaultScheduleGuards(),
      guardContext: { phase: "partial", halfRestFacts: facts },
    });
    const legal = {
      ...illegal,
      id: "legal-half-rest",
      flightId: "afternoon-flight",
      flightNo: "A100",
      startTime: "13:00",
      endTime: "15:00",
    };
    ledger.commit({ type: "append", assignments: [legal] });

    expect(() =>
      ledger.commit({ type: "replace", assignments: [illegal] })
    ).toThrow(/半休|half-rest/i);
    expect(ledger.snapshot()).toEqual([legal]);
  });

  it("rejects a post-stage same-airline priority conflict at the shared commit boundary", () => {
    const controlRule: PositionRule = {
      id: "cx-control-rule",
      flightNo: "CX100",
      name: "\u63a7\u5236",
      category: "\u5e38\u89c4",
      remark: "\u63a7\u5236",
      qualifiedStaffIds: ["worker-1"],
      manual: false,
      fatiguePoints: 1,
      minPassengers: 0,
      earlyReleaseMinutes: 0,
    };
    const oneRule: PositionRule = {
      ...controlRule,
      id: "cx-one-rule",
      flightNo: "CX200",
      name: "\u4e00\u53f7",
      remark: "\u4e00\u53f7",
    };
    const existing = {
      ...assignment,
      id: "existing-cx-control",
      flightId: "flight-cx-100",
      flightNo: "CX100",
      positionRuleId: controlRule.id,
      position: controlRule.name,
      staffId: "worker-1",
      staffName: "worker-1",
      status: "assigned" as const,
    };
    const illegal = {
      ...existing,
      id: "illegal-cx-one",
      flightId: "flight-cx-200",
      flightNo: "CX200",
      positionRuleId: oneRule.id,
      position: oneRule.name,
      remark: oneRule.remark,
    };
    const guardContext: ScheduleGuardContext = {
      phase: "partial" as const,
      airlineRotationFacts: {
        positionRules: [controlRule, oneRule],
      },
    };
    const ledger = createScheduleLedger([existing], {
      guards: createDefaultScheduleGuards(),
      guardContext,
    });

    let error: unknown;
    try {
      ledger.commit({ type: "replace", assignments: [existing, illegal] });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ScheduleGuardError);
    expect((error as ScheduleGuardError).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "same-day-cross-flight-priority",
        }),
      ])
    );
    expect(ledger.snapshot()).toEqual([existing]);
  });

  it("rejects a post-stage minimum-flight-transition violation at the shared commit boundary", () => {
    const sourceFlight = {
      id: "flight-aa-100",
      flightNo: "AA100",
      startTime: "08:00",
      endTime: "10:00",
    };
    const targetFlight = {
      ...sourceFlight,
      id: "flight-bb-200",
      flightNo: "BB200",
      startTime: "11:29",
      endTime: "12:29",
    };
    const sourceRule: PositionRule = {
      id: "aa-rule",
      flightNo: sourceFlight.flightNo,
      name: "G01",
      category: "\u5e38\u89c4",
      remark: "",
      qualifiedStaffIds: ["worker-transition"],
      manual: false,
      fatiguePoints: 1,
      minPassengers: 0,
      earlyReleaseMinutes: 0,
    };
    const targetRule: PositionRule = {
      ...sourceRule,
      id: "bb-rule",
      flightNo: targetFlight.flightNo,
      name: "H01",
    };
    const existing = {
      ...assignment,
      id: "existing-aa",
      flightId: sourceFlight.id,
      flightNo: sourceFlight.flightNo,
      positionRuleId: sourceRule.id,
      position: sourceRule.name,
      staffId: "worker-transition",
      staffName: "worker-transition",
      startTime: sourceFlight.startTime,
      endTime: sourceFlight.endTime,
      workHours: 2,
      status: "assigned" as const,
    };
    const illegal = {
      ...existing,
      id: "illegal-bb",
      flightId: targetFlight.id,
      flightNo: targetFlight.flightNo,
      positionRuleId: targetRule.id,
      position: targetRule.name,
      startTime: targetFlight.startTime,
      endTime: targetFlight.endTime,
      workHours: 1,
    };
    const guardContext = {
      phase: "partial" as const,
      minimumFlightTransitionFacts: {
        flights: [sourceFlight, targetFlight],
        positionRules: [sourceRule, targetRule],
        settings: {
          minimumRegularTransitionMinutes: 90,
          nightEnd: "05:00",
        },
      },
    } as unknown as ScheduleGuardContext;
    const ledger = createScheduleLedger([existing], {
      guards: createDefaultScheduleGuards(),
      guardContext,
    });

    let error: unknown;
    try {
      ledger.commit({ type: "replace", assignments: [existing, illegal] });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ScheduleGuardError);
    expect((error as ScheduleGuardError).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "minimum-flight-transition",
        }),
      ])
    );
    expect(ledger.snapshot()).toEqual([existing]);
  });

  it("allows an exact minimum-flight-transition gap", () => {
    const sourceFlight = {
      id: "flight-aa-exact",
      flightNo: "AA100",
      startTime: "08:00",
      endTime: "10:00",
    };
    const targetFlight = {
      ...sourceFlight,
      id: "flight-bb-exact",
      flightNo: "BB200",
      startTime: "11:30",
      endTime: "12:30",
    };
    const sourceRule: PositionRule = {
      id: "aa-exact-rule",
      flightNo: sourceFlight.flightNo,
      name: "G01",
      category: "\u5e38\u89c4",
      remark: "",
      qualifiedStaffIds: ["worker-transition-exact"],
      manual: false,
      fatiguePoints: 1,
      minPassengers: 0,
      earlyReleaseMinutes: 0,
    };
    const targetRule: PositionRule = {
      ...sourceRule,
      id: "bb-exact-rule",
      flightNo: targetFlight.flightNo,
      name: "H01",
    };
    const first = {
      ...assignment,
      id: "exact-first",
      flightId: sourceFlight.id,
      flightNo: sourceFlight.flightNo,
      positionRuleId: sourceRule.id,
      position: sourceRule.name,
      staffId: "worker-transition-exact",
      staffName: "worker-transition-exact",
      startTime: sourceFlight.startTime,
      endTime: sourceFlight.endTime,
      workHours: 2,
      status: "assigned" as const,
    };
    const second = {
      ...first,
      id: "exact-second",
      flightId: targetFlight.id,
      flightNo: targetFlight.flightNo,
      positionRuleId: targetRule.id,
      position: targetRule.name,
      startTime: targetFlight.startTime,
      endTime: targetFlight.endTime,
      workHours: 1,
    };
    const guardContext = {
      phase: "partial" as const,
      minimumFlightTransitionFacts: {
        flights: [sourceFlight, targetFlight],
        positionRules: [sourceRule, targetRule],
        settings: {
          minimumRegularTransitionMinutes: 90,
          nightEnd: "05:00",
        },
      },
    } as unknown as ScheduleGuardContext;
    const ledger = createScheduleLedger([first], {
      guards: createDefaultScheduleGuards(),
      guardContext,
    });

    expect(() =>
      ledger.commit({ type: "replace", assignments: [first, second] })
    ).not.toThrow();
    expect(ledger.snapshot()).toEqual([first, second]);
  });

  it("allows a valid afternoon diversion transfer below the global gap", () => {
    const sourceFlight = {
      id: "flight-diversion-source",
      flightNo: "AA300",
      startTime: "13:00",
      endTime: "15:00",
    };
    const targetFlight = {
      ...sourceFlight,
      id: "flight-diversion-target",
      flightNo: "BB400",
      startTime: "14:45",
      endTime: "16:00",
    };
    const sourceRule: PositionRule = {
      id: "diversion-source-rule",
      flightNo: sourceFlight.flightNo,
      name: "G09",
      category: "\u5206\u6d41",
      remark: "",
      qualifiedStaffIds: ["worker-transition-diversion"],
      manual: false,
      fatiguePoints: 1,
      minPassengers: 0,
      earlyReleaseMinutes: 30,
    };
    const targetRule: PositionRule = {
      ...sourceRule,
      id: "diversion-target-rule",
      flightNo: targetFlight.flightNo,
      name: "H09",
      category: "\u5e38\u89c4",
      earlyReleaseMinutes: 0,
    };
    const first = {
      ...assignment,
      id: "diversion-first",
      flightId: sourceFlight.id,
      flightNo: sourceFlight.flightNo,
      positionRuleId: sourceRule.id,
      position: sourceRule.name,
      staffId: "worker-transition-diversion",
      staffName: "worker-transition-diversion",
      startTime: sourceFlight.startTime,
      endTime: sourceFlight.endTime,
      workHours: 2,
      status: "assigned" as const,
    };
    const second = {
      ...first,
      id: "diversion-second",
      flightId: targetFlight.id,
      flightNo: targetFlight.flightNo,
      positionRuleId: targetRule.id,
      position: targetRule.name,
      startTime: targetFlight.startTime,
      endTime: targetFlight.endTime,
      workHours: 1,
    };
    const guardContext = {
      phase: "partial" as const,
      minimumFlightTransitionFacts: {
        flights: [sourceFlight, targetFlight],
        positionRules: [sourceRule, targetRule],
        settings: {
          minimumRegularTransitionMinutes: 90,
          nightEnd: "05:00",
        },
      },
    } as unknown as ScheduleGuardContext;
    const ledger = createScheduleLedger([first], {
      guards: createDefaultScheduleGuards(),
      guardContext,
    });

    expect(() =>
      ledger.commit({ type: "replace", assignments: [first, second] })
    ).not.toThrow();
    expect(ledger.snapshot()).toEqual([first, second]);
  });

  it("records a next-workday cutoff warning without rejecting the proposal", () => {
    const protectedAssignment = {
      ...assignment,
      id: "cutoff-after",
      flightId: "cutoff-flight",
      flightNo: "DAY200",
      staffId: "cutoff-worker",
      staffName: "cutoff-worker",
      startTime: "12:00",
      endTime: "14:00",
      status: "assigned" as const,
    };
    const warningSink: string[] = [];
    const guardContext = {
      phase: "partial" as const,
      warningSink,
      lateShiftCutoffFacts: {
        state: {
          history: [],
          settings: {
            lateShiftRecoveryEnabled: true,
            nightEnd: "05:00",
          },
        },
        date: "2026-08-23",
        crossDayRecovery: {
          previousWorkday: {
            previousDate: "2026-08-21",
            finalLateRecords: [],
            protectedRecords: [],
            protectedStaffIds: new Set<string>(["cutoff-worker"]),
            scopedProtectedStaffIds: new Set<string>(["cutoff-worker"]),
          },
          cutoffByStaffId: new Map([
            [
              "cutoff-worker",
              {
                cutoffTime: "12:00",
                cutoffMinutes: 12 * 60,
                previousEndMinutes: 23 * 60,
                sourceRecords: [],
              },
            ],
          ]),
        },
      },
    } as unknown as ScheduleGuardContext;
    const ledger = createScheduleLedger([], {
      guards: createDefaultScheduleGuards(),
      guardContext,
    });

    expect(() =>
      ledger.commit({ type: "append", assignments: [protectedAssignment] })
    ).not.toThrow();
    expect(ledger.snapshot()).toEqual([protectedAssignment]);
    expect(warningSink).toEqual(
      expect.arrayContaining([expect.stringContaining("次班截止")])
    );
  });

  it("records a cross-workday qualification reservation shortfall without rejecting the proposal", () => {
    const state = createDefaultState();
    const worker = {
      ...state.staff[0]!,
      id: "reservation-worker",
      name: "reservation-worker",
      staffType: "\u5e38\u89c4" as const,
      status: "\u6b63\u5e38" as const,
    };
    const lateFlight = {
      ...state.flights[0]!,
      id: "late-flight",
      flightNo: "LATE100",
      startTime: "21:00",
      endTime: "23:30",
    };
    const nextTemplate = {
      ...state.templates[0]!,
      id: "next-template",
      flightNo: "NEXT200",
      startTime: "08:00",
      endTime: "10:00",
      positions: ["\u63a7\u5236"],
    };
    const lateRule: PositionRule = {
      ...state.positionRules[0]!,
      id: "late-rule",
      flightNo: lateFlight.flightNo,
      name: "G01",
      category: "\u5e38\u89c4",
      remark: "",
      qualifiedStaffIds: [worker.id],
      manual: false,
      earlyReleaseMinutes: 0,
    };
    const nextRule: PositionRule = {
      ...lateRule,
      id: "next-control",
      flightNo: nextTemplate.flightNo,
      name: "\u63a7\u5236",
    };
    state.staff = [worker];
    state.flights = [lateFlight];
    state.templates = [nextTemplate];
    state.positionRules = [lateRule, nextRule];
    state.settings.crossWorkdayQualificationReservations = [
      {
        id: "reserve-next-control",
        enabled: true,
        flightNo: nextTemplate.flightNo,
        matchField: "position",
        keyword: "\u63a7\u5236",
        minimumStaffCount: 1,
      },
    ];
    const lateAssignment = {
      ...assignment,
      id: "late-assignment",
      flightId: lateFlight.id,
      flightNo: lateFlight.flightNo,
      positionRuleId: lateRule.id,
      position: lateRule.name,
      staffId: worker.id,
      staffName: worker.name,
      startTime: lateFlight.startTime,
      endTime: lateFlight.endTime,
      workHours: 2.5,
      status: "assigned" as const,
    };
    const warningSink: string[] = [];
    const guardContext: ScheduleGuardContext = {
      phase: "partial" as const,
      warningSink,
      crossWorkdayQualificationReservationFacts: { state },
    };
    const ledger = createScheduleLedger([], {
      guards: createDefaultScheduleGuards(),
      guardContext,
    });

    expect(() =>
      ledger.commit({ type: "append", assignments: [lateAssignment] })
    ).not.toThrow();
    expect(ledger.snapshot()).toEqual([lateAssignment]);
    expect(warningSink).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "\u4e0b\u4e00\u5de5\u4f5c\u73ed NEXT200/\u63a7\u5236\u9700\u8981\u4fdd\u7559 1 \u540d\u5408\u683c\u4eba\u5458"
        ),
      ])
    );
  });

  it("records a late-priority frequency warning when a post-stage proposal chooses an overused worker", () => {
    const state = createDefaultState();
    const underused = {
      ...state.staff[0]!,
      id: "late-underused",
      name: "late-underused",
      staffType: "\u5e38\u89c4" as const,
      status: "\u6b63\u5e38" as const,
      nightShift: true,
    };
    const overused = {
      ...state.staff[1]!,
      id: "late-overused",
      name: "late-overused",
      staffType: "\u5e38\u89c4" as const,
      status: "\u6b63\u5e38" as const,
      nightShift: true,
    };
    const lateFlight = {
      ...state.flights[0]!,
      id: "late-priority-flight",
      flightNo: "FD573",
      startTime: "21:55",
      endTime: "23:55",
    };
    const lateRule: PositionRule = {
      ...state.positionRules[0]!,
      id: "late-declaration-rule",
      flightNo: lateFlight.flightNo,
      name: "H04",
      category: "\u5e38\u89c4",
      remark: "\u7533\u62a5",
      qualifiedStaffIds: [underused.id, overused.id],
      manual: false,
    };
    state.staff = [underused, overused];
    state.flights = [lateFlight];
    state.positionRules = [lateRule];
    state.settings.positionRotationEnabled = true;
    state.settings.lateShiftEndTime = "23:00";
    state.settings.latePriorityFlightNumbers = [lateFlight.flightNo];
    state.history = ["2026-08-12", "2026-08-14"].map((date, index) => ({
      id: `overused-history-${index}`,
      date,
      flightNo: lateFlight.flightNo,
      position: lateRule.name,
      staffId: overused.id,
      staffName: overused.name,
      startTime: lateFlight.startTime,
      endTime: lateFlight.endTime,
      workHours: 2,
      fatiguePoints: lateRule.fatiguePoints,
      remark: lateRule.remark,
    }));
    const legal = {
      ...assignment,
      id: "late-priority-assignment",
      flightId: lateFlight.id,
      flightNo: lateFlight.flightNo,
      positionRuleId: lateRule.id,
      position: lateRule.name,
      staffId: underused.id,
      staffName: underused.name,
      startTime: lateFlight.startTime,
      endTime: lateFlight.endTime,
      workHours: 2,
      fatiguePoints: lateRule.fatiguePoints,
      remark: lateRule.remark,
      status: "assigned" as const,
    };
    const illegal = {
      ...legal,
      staffId: overused.id,
      staffName: overused.name,
    };
    const warningSink: string[] = [];
    const guardContext: ScheduleGuardContext = {
      phase: "partial" as const,
      warningSink,
      latePriorityFrequencyFacts: {
        state,
        date: "2026-08-18",
        scheduleFrequency: createScheduleFrequencyFacts(state, "2026-08-18"),
      },
    };
    const ledger = createScheduleLedger([legal], {
      guards: createDefaultScheduleGuards(),
      guardContext,
    });

    expect(() =>
      ledger.commit({ type: "replace", assignments: [illegal] })
    ).not.toThrow();
    expect(ledger.snapshot()).toEqual([illegal]);
    expect(warningSink).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "\u672b\u73ed\u91cd\u70b9\u5c97\u4f4d\u5206\u7c7b\u516c\u5e73"
        ),
      ])
    );
  });

  it("rejects a strict next-workday recovery target assigned to a protected worker", () => {
    const state = createDefaultState();
    const worker = {
      ...state.staff[0]!,
      id: "recovery-protected-worker",
      name: "recovery-protected-worker",
      staffType: "常规" as const,
      status: "正常" as const,
    };
    const flight = {
      ...state.flights[0]!,
      id: "recovery-target-flight",
      flightNo: "NEXT100",
      startTime: "09:00",
      endTime: "11:00",
    };
    const rule: PositionRule = {
      ...state.positionRules[0]!,
      id: "recovery-target-rule",
      flightNo: flight.flightNo,
      name: "控制",
      remark: "",
      qualifiedStaffIds: [worker.id],
      manual: false,
    };
    state.staff = [worker];
    state.flights = [flight];
    state.positionRules = [rule];
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.nextWorkdayRecoveryMode = "forbid";
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "late-position",
        enabled: true,
        flightNo: "LATE100",
        matchField: "position",
        keyword: "督导",
        nextWorkdayCutoffTime: "",
      },
    ];
    state.settings.nextWorkdayRecoveryTargets = [
      {
        id: "strict-target",
        enabled: true,
        flightNo: flight.flightNo,
        positionKeyword: rule.name,
      },
    ];
    state.history = [
      {
        id: "late-history",
        date: "2026-08-21",
        flightNo: "LATE100",
        position: "督导",
        staffId: worker.id,
        staffName: worker.name,
        startTime: "21:00",
        endTime: "23:30",
        workHours: 2.5,
        fatiguePoints: 5,
        remark: "",
      },
    ];
    const illegal = {
      ...assignment,
      id: "strict-recovery-illegal",
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: worker.id,
      staffName: worker.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      status: "assigned" as const,
    };
    const guardContext: ScheduleGuardContext = {
      phase: "partial",
      strictNextWorkdayRecoveryFacts: { state, date: "2026-08-23" },
    } as ScheduleGuardContext;
    const ledger = createScheduleLedger([], {
      guards: createDefaultScheduleGuards(),
      guardContext,
    });

    expect(() =>
      ledger.commit({ type: "append", assignments: [illegal] })
    ).toThrow(/严格跨工作日恢复/);
    expect(ledger.snapshot()).toEqual([]);
  });

  it("records a late-priority aggregate rotation warning without rejecting the proposal", () => {
    const state = createDefaultState();
    const underused = {
      ...state.staff[0]!,
      id: "aggregate-underused",
      name: "aggregate-underused",
      staffType: "常规" as const,
      status: "正常" as const,
      nightShift: true,
    };
    const overused = {
      ...state.staff[1]!,
      id: "aggregate-overused",
      name: "aggregate-overused",
      staffType: "常规" as const,
      status: "正常" as const,
      nightShift: true,
    };
    const flight = {
      ...state.flights[0]!,
      id: "aggregate-flight",
      flightNo: "FD574",
      startTime: "21:55",
      endTime: "23:55",
    };
    const rule: PositionRule = {
      ...state.positionRules[0]!,
      id: "aggregate-rule",
      flightNo: flight.flightNo,
      name: "H04",
      remark: "申报",
      qualifiedStaffIds: [underused.id, overused.id],
      manual: false,
    };
    state.staff = [underused, overused];
    state.flights = [flight];
    state.positionRules = [rule];
    state.settings.positionRotationEnabled = true;
    state.settings.lateShiftEndTime = "23:00";
    state.settings.latePriorityFlightNumbers = [flight.flightNo];
    state.history = ["2026-08-12", "2026-08-14"].map((date, index) => ({
      id: `aggregate-history-${index}`,
      date,
      flightNo: flight.flightNo,
      position: rule.name,
      staffId: overused.id,
      staffName: overused.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      workHours: 2,
      fatiguePoints: rule.fatiguePoints,
      remark: rule.remark,
    }));
    const proposed = {
      ...assignment,
      id: "aggregate-assignment",
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: overused.id,
      staffName: overused.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      status: "assigned" as const,
    };
    const warningSink: string[] = [];
    const guardContext = {
      phase: "partial" as const,
      warningSink,
      latePriorityAggregateRotationFacts: {
        state,
        date: "2026-08-18",
        scheduleFrequency: createScheduleFrequencyFacts(state, "2026-08-18"),
      },
    } as unknown as ScheduleGuardContext;
    const ledger = createScheduleLedger([], {
      guards: createDefaultScheduleGuards(),
      guardContext,
    });

    expect(() =>
      ledger.commit({ type: "append", assignments: [proposed] })
    ).not.toThrow();
    expect(warningSink).toEqual(
      expect.arrayContaining([expect.stringContaining("末班重点岗位合计轮换")])
    );
  });

  it("records a high-fatigue ordinary consecutive warning without rejecting the proposal", () => {
    const state = createDefaultState();
    const worker = {
      ...state.staff[0]!,
      id: "high-fatigue-worker",
      name: "high-fatigue-worker",
      staffType: "常规" as const,
      status: "正常" as const,
    };
    const flight = {
      ...state.flights[0]!,
      id: "high-fatigue-flight",
      flightNo: "ZZ900",
      startTime: "13:00",
      endTime: "15:00",
    };
    const rule: PositionRule = {
      ...state.positionRules[0]!,
      id: "high-fatigue-rule",
      flightNo: flight.flightNo,
      name: "G09",
      category: "常规",
      remark: "",
      fatiguePoints: 8,
      qualifiedStaffIds: [worker.id],
      manual: false,
    };
    state.staff = [worker];
    state.flights = [flight];
    state.positionRules = [rule];
    state.settings.positionRotationEnabled = true;
    state.settings.highLoadFatigueThreshold = 5;
    state.history = [
      {
        id: "high-fatigue-history",
        date: "2026-08-21",
        flightNo: flight.flightNo,
        position: rule.name,
        staffId: worker.id,
        staffName: worker.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: 2,
        fatiguePoints: rule.fatiguePoints,
        remark: rule.remark,
      },
    ];
    const proposed = {
      ...assignment,
      id: "high-fatigue-assignment",
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: worker.id,
      staffName: worker.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      fatiguePoints: rule.fatiguePoints,
      status: "assigned" as const,
    };
    const warningSink: string[] = [];
    const guardContext = {
      phase: "partial" as const,
      warningSink,
      highFatiguePositionFacts: {
        state,
        date: "2026-08-23",
        scheduleFrequency: createScheduleFrequencyFacts(state, "2026-08-23"),
      },
    } as unknown as ScheduleGuardContext;
    const ledger = createScheduleLedger([], {
      guards: createDefaultScheduleGuards(),
      guardContext,
    });

    expect(() =>
      ledger.commit({ type: "append", assignments: [proposed] })
    ).not.toThrow();
    expect(warningSink).toEqual(
      expect.arrayContaining([expect.stringContaining("承担高疲劳普通岗位")])
    );
  });

  it("rejects a strict configured position-transition violation at the commit boundary", () => {
    const state = createDefaultState();
    const worker = {
      ...state.staff[0]!,
      id: "strict-transition-worker",
      name: "strict-transition-worker",
      staffType: "常规" as const,
      status: "正常" as const,
    };
    const sourceFlight = {
      ...state.flights[0]!,
      id: "strict-source-flight",
      flightNo: "CX931",
      startTime: "08:00",
      endTime: "10:00",
    };
    const targetFlight = {
      ...sourceFlight,
      id: "strict-target-flight",
      flightNo: "TR121",
      startTime: "12:00",
      endTime: "14:00",
    };
    const sourceRule: PositionRule = {
      ...state.positionRules[0]!,
      id: "strict-source-rule",
      flightNo: sourceFlight.flightNo,
      name: "督导",
      category: "常规",
      qualifiedStaffIds: [worker.id],
      manual: false,
    };
    const targetRule: PositionRule = {
      ...sourceRule,
      id: "strict-target-rule",
      flightNo: targetFlight.flightNo,
      name: "H02",
    };
    state.staff = [worker];
    state.flights = [sourceFlight, targetFlight];
    state.positionRules = [sourceRule, targetRule];
    state.settings.positionTransitionPolicies = [
      {
        id: "strict-policy",
        name: "strict policy",
        enabled: true,
        mode: "forbid",
        sourceFlightNo: sourceFlight.flightNo,
        sourcePositions: [sourceRule.name],
        targetFlightNo: targetFlight.flightNo,
        targetPosition: targetRule.name,
        minimumGapMinutes: 180,
      },
    ];
    const first = {
      ...assignment,
      id: "strict-first",
      flightId: sourceFlight.id,
      flightNo: sourceFlight.flightNo,
      positionRuleId: sourceRule.id,
      position: sourceRule.name,
      staffId: worker.id,
      staffName: worker.name,
      startTime: sourceFlight.startTime,
      endTime: sourceFlight.endTime,
      status: "assigned" as const,
    };
    const second = {
      ...first,
      id: "strict-second",
      flightId: targetFlight.id,
      flightNo: targetFlight.flightNo,
      positionRuleId: targetRule.id,
      position: targetRule.name,
      startTime: targetFlight.startTime,
      endTime: targetFlight.endTime,
    };
    const ledger = createScheduleLedger([], {
      guards: createDefaultScheduleGuards(),
      guardContext: {
        phase: "final",
        positionTransitionFacts: { state },
      } as unknown as ScheduleGuardContext,
    });

    expect(() =>
      ledger.commit({ type: "append", assignments: [first, second] })
    ).toThrow(/position-transition|严格岗位衔接/);
    expect(ledger.snapshot()).toEqual([]);
  });

  it("records a general priority-position frequency warning without rejecting the proposal", () => {
    const state = createDefaultState();
    const overused = {
      ...state.staff[0]!,
      id: "frequency-overused",
      name: "frequency-overused",
      staffType: "常规" as const,
      status: "正常" as const,
    };
    const underused = {
      ...state.staff[1]!,
      id: "frequency-underused",
      name: "frequency-underused",
      staffType: "常规" as const,
      status: "正常" as const,
    };
    const flight = {
      ...state.flights[0]!,
      id: "frequency-flight",
      flightNo: "CX900",
      startTime: "13:00",
      endTime: "15:00",
    };
    const rule: PositionRule = {
      ...state.positionRules[0]!,
      id: "frequency-rule",
      flightNo: flight.flightNo,
      name: "控制",
      category: "常规",
      remark: "",
      qualifiedStaffIds: [overused.id, underused.id],
      manual: false,
    };
    state.staff = [overused, underused];
    state.flights = [flight];
    state.positionRules = [rule];
    state.settings.ordinaryPriorityPositions = [
      { airlineCode: "CX", position: "控制" },
    ];
    state.settings.positionRotationEnabled = true;
    state.history = ["2026-08-01", "2026-08-02", "2026-08-03"].map(
      (date, index) => ({
        id: `frequency-history-${index}`,
        date,
        flightNo: flight.flightNo,
        position: rule.name,
        staffId: overused.id,
        staffName: overused.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: 2,
        fatiguePoints: rule.fatiguePoints,
        remark: rule.remark,
      })
    );
    const proposed = {
      ...assignment,
      id: "frequency-assignment",
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: overused.id,
      staffName: overused.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      status: "assigned" as const,
    };
    const warningSink: string[] = [];
    const ledger = createScheduleLedger([], {
      guards: createDefaultScheduleGuards(),
      guardContext: {
        phase: "partial",
        warningSink,
        positionFrequencyFacts: { state, date: "2026-08-04" },
      } as unknown as ScheduleGuardContext,
    });

    expect(() =>
      ledger.commit({ type: "append", assignments: [proposed] })
    ).not.toThrow();
    expect(warningSink).toEqual(
      expect.arrayContaining([expect.stringContaining("重点岗位频率")])
    );
  });

  it("records a workload-balance warning for an over-target final snapshot without rejecting it", () => {
    const state = createDefaultState();
    state.settings.workloadBalanceEnabled = true;
    state.settings.maxWorkHoursDifference = 0.5;
    const worker = state.staff[0]!;
    const proposal = {
      ...assignment,
      id: "workload-over-target",
      flightId: state.flights[0]!.id,
      flightNo: state.flights[0]!.flightNo,
      staffId: worker.id,
      staffName: worker.name,
      startTime: "08:00",
      endTime: "16:00",
      workHours: 8,
      status: "assigned" as const,
    };
    const warningSink: string[] = [];
    const ledger = createScheduleLedger([], {
      guards: createDefaultScheduleGuards(),
      guardContext: {
        phase: "final",
        workloadBalanceFacts: { state, date: "2026-07-25" },
        warningSink,
      } as unknown as ScheduleGuardContext,
    });

    expect(() =>
      ledger.commit({ type: "append", assignments: [proposal] })
    ).not.toThrow();
    expect(warningSink).toEqual(
      expect.arrayContaining([expect.stringContaining("最终班表负荷平衡")])
    );
  });

  it("records a warning when one worker carries both early and late same-day load", () => {
    const state = createDefaultState();
    const early = {
      ...assignment,
      id: "early",
      staffId: "worker-1",
      staffName: "worker-1",
      status: "assigned" as const,
      startTime: "08:00",
      endTime: "10:00",
    };
    const late = {
      ...assignment,
      id: "late",
      staffId: "worker-1",
      staffName: "worker-1",
      status: "assigned" as const,
      startTime: "23:30",
      endTime: "23:59",
    };
    const warningSink: string[] = [];
    const ledger = createScheduleLedger([], {
      guards: [createSameDayLateObligationScheduleGuard()],
      guardContext: {
        phase: "final",
        sameDayLateObligationFacts: { state, date: "2026-08-04" },
        warningSink,
      },
    });
    expect(() =>
      ledger.commit({ type: "replace", assignments: [early, late] })
    ).not.toThrow();
    expect(warningSink).toHaveLength(1);
  });

  it("records a warning when late-shift relief falls back", () => {
    const late = {
      ...assignment,
      id: "late-relief",
      status: "assigned" as const,
      decisionTrace: [
        schedulingDecision(
          "late-shift-position-relief",
          "fallback",
          "fallback"
        ),
      ],
    };
    const warningSink: string[] = [];
    const ledger = createScheduleLedger([], {
      guards: [createLateShiftPositionReliefScheduleGuard()],
      guardContext: {
        phase: "final",
        lateShiftPositionReliefFacts: {
          state: createDefaultState(),
          date: "2026-08-04",
        },
        warningSink,
      },
    });
    expect(() =>
      ledger.commit({ type: "append", assignments: [late] })
    ).not.toThrow();
    expect(warningSink).toHaveLength(1);
  });

  it("records a warning without rejecting an incomplete KE166 supervisor snapshot", () => {
    const state = createDefaultState();
    const flight = {
      id: "flight-ke166",
      flightNo: "KE166",
      startTime: "09:00",
      endTime: "11:00",
      bookedPassengers: 0,
      positions: ["督导"],
      remark: "",
    };
    const rule = {
      id: "rule-ke166-mobile",
      flightNo: "KE166",
      name: "督导",
      category: "机动督导" as const,
      remark: "",
      qualifiedStaffIds: ["1"],
      manual: false,
      fatiguePoints: 1,
      minPassengers: 0,
      earlyReleaseMinutes: 0,
    };
    state.flights.push(flight);
    state.positionRules.push(rule);
    const missing = {
      ...assignment,
      id: "ke166-missing",
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      status: "unfilled" as const,
    };
    const warningSink: string[] = [];
    const ledger = createScheduleLedger([], {
      guards: [createKe166SnapshotScheduleGuard()],
      guardContext: {
        phase: "final",
        ke166SnapshotFacts: { state, date: "2026-08-04" },
        warningSink,
      },
    });
    expect(() =>
      ledger.commit({ type: "append", assignments: [missing] })
    ).not.toThrow();
    expect(warningSink).toEqual([
      "KE166机动督导未安排，岗位已留空，请人工复核",
    ]);
  });

  it("keeps scarce qualification as a warning and does not reject the snapshot", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const rule = state.positionRules.find(
      (item) => item.flightNo === flight.flightNo
    )!;
    const invalid = {
      ...assignment,
      id: "scarce-invalid",
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: "not-qualified",
      status: "assigned" as const,
    };
    const warningSink: string[] = [];
    const ledger = createScheduleLedger([], {
      guards: [createScarceQualificationScheduleGuard()],
      guardContext: {
        phase: "final",
        scarceQualificationFacts: { state, date: "2026-08-04" },
        warningSink,
      },
    });
    expect(() =>
      ledger.commit({ type: "append", assignments: [invalid] })
    ).not.toThrow();
    expect(warningSink).toHaveLength(1);
    expect(warningSink[0]).toContain("复核");
    expect(warningSink[0]).not.toContain("拒绝提交");
  });

  it("rejects deletion of a selected duty-position assignment", () => {
    const locked = {
      ...assignment,
      id: "duty-locked",
      status: "unfilled" as const,
      decisionTrace: [
        schedulingDecision("duty-position", "selected", "selected"),
      ],
    };
    const ledger = createScheduleLedger([], {
      guards: [createDutyPositionScheduleGuard()],
      guardContext: {
        phase: "final",
        dutyPositionFacts: { state: createDefaultState(), date: "2026-08-04" },
      },
    });
    expect(() =>
      ledger.commit({ type: "append", assignments: [locked] })
    ).toThrow(/值班锁定|duty/i);
  });
});
