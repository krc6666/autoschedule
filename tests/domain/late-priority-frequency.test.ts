import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { createScheduleFrequencyFacts } from "../../src/domain/statistics/schedule-frequency";
import {
  compareLatePriorityFrequency,
  latePriorityFrequencyProfileForRule,
} from "../../src/domain/statistics/late-priority-frequency";
import type { HistoryRecord, PositionRule } from "../../src/model";

const DATE = "2026-08-18";

function record(
  id: string,
  staffId: string,
  flightNo: string,
  position: string,
  remark: string,
  startTime: string,
  endTime: string
): HistoryRecord {
  return {
    id,
    date: "2026-08-16",
    flightNo,
    position,
    staffId,
    staffName: "测试人员",
    startTime,
    endTime,
    workHours: 2,
    fatiguePoints: 5,
    remark,
  };
}

function rule(name: string, remark: string): PositionRule {
  return {
    id: `${name}-${remark}`,
    flightNo: "TARGET",
    category: "常规",
    name,
    remark,
    qualifiedStaffIds: [],
    fatiguePoints: 5,
    minPassengers: 0,
    earlyReleaseMinutes: 0,
    manual: false,
  };
}

describe("late priority frequency statistics", () => {
  it("keeps supervisor, number-one, declaration and delivery as separate same-flight counts", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.settings.lateShiftEndTime = "23:00";
    state.history = [
      record(
        "fd-declare",
        person.id,
        "TARGET",
        "H04",
        "申报",
        "21:55",
        "23:55"
      ),
      record(
        "mf-delivery",
        person.id,
        "TARGET",
        "G14",
        "送资料",
        "22:30",
        "00:10"
      ),
      record("late-one", person.id, "TARGET", "H02", "一号", "21:55", "23:55"),
      record("ordinary", person.id, "TR121", "H07", "", "21:55", "23:55"),
      record(
        "at-boundary",
        person.id,
        "CX937",
        "G20",
        "控制",
        "21:00",
        "23:00"
      ),
      record(
        "early-priority",
        person.id,
        "KE166",
        "G20",
        "督导",
        "19:50",
        "22:00"
      ),
    ];
    const facts = createScheduleFrequencyFacts(state, DATE);
    const flight = { startTime: "21:55", endTime: "23:55" };

    expect(
      latePriorityFrequencyProfileForRule(
        state,
        person.id,
        flight,
        rule("H04", "申报"),
        DATE,
        facts
      )
    ).toEqual({
      applies: true,
      targetKinds: ["declaration"],
      supervisorQualified: false,
      supervisorRotationDeficit: 0,
      counts: {
        supervisor: { currentMonthCount: 0, recentWorkdayCount: 0 },
        "number-one": { currentMonthCount: 1, recentWorkdayCount: 1 },
        declaration: { currentMonthCount: 1, recentWorkdayCount: 1 },
        delivery: { currentMonthCount: 1, recentWorkdayCount: 1 },
      },
      totalCurrentMonthCount: 3,
      totalRecentWorkdayCount: 3,
    });

    expect(
      latePriorityFrequencyProfileForRule(
        state,
        person.id,
        flight,
        rule("H02", "一号"),
        DATE,
        facts
      )
    ).toEqual({
      applies: true,
      targetKinds: ["number-one"],
      supervisorQualified: false,
      supervisorRotationDeficit: 0,
      counts: {
        supervisor: { currentMonthCount: 0, recentWorkdayCount: 0 },
        "number-one": { currentMonthCount: 1, recentWorkdayCount: 1 },
        declaration: { currentMonthCount: 1, recentWorkdayCount: 1 },
        delivery: { currentMonthCount: 1, recentWorkdayCount: 1 },
      },
      totalCurrentMonthCount: 3,
      totalRecentWorkdayCount: 3,
    });
  });

  it("prefers the lower same-flight supervisor count before the combined late-priority total", () => {
    const state = createDefaultState();
    const [frequentSupervisor, unusedSupervisor] = state.staff.slice(0, 2);
    const supervisorRule = rule("督导", "");
    supervisorRule.flightNo = "TR121";
    supervisorRule.qualifiedStaffIds = [
      frequentSupervisor!.id,
      unusedSupervisor!.id,
    ];
    state.positionRules = [supervisorRule];
    state.history = [
      ...Array.from({ length: 4 }, (_, index) =>
        record(
          `supervisor-${index}`,
          frequentSupervisor!.id,
          "TR121",
          "督导",
          "",
          "21:55",
          "23:55"
        )
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        record(
          `other-priority-${index}`,
          unusedSupervisor!.id,
          "OTHER",
          "H04",
          "申报",
          "21:55",
          "23:55"
        )
      ),
    ];
    const facts = createScheduleFrequencyFacts(state, DATE);
    const flight = {
      flightNo: "TR121",
      startTime: "21:55",
      endTime: "23:55",
    };
    const frequent = latePriorityFrequencyProfileForRule(
      state,
      frequentSupervisor!.id,
      flight,
      supervisorRule,
      DATE,
      facts
    );
    const unused = latePriorityFrequencyProfileForRule(
      state,
      unusedSupervisor!.id,
      flight,
      supervisorRule,
      DATE,
      facts
    );

    expect(compareLatePriorityFrequency(frequent, unused)).toBeGreaterThan(0);
  });

  it("does not force a supervisor-qualified worker to catch up on declaration or delivery", () => {
    const state = createDefaultState();
    const [supervisor, ordinary] = state.staff.slice(0, 2);
    const supervisorRule = rule("督导", "");
    supervisorRule.flightNo = "TR121";
    supervisorRule.qualifiedStaffIds = [supervisor!.id];
    const declarationRule = rule("H04", "申报");
    declarationRule.flightNo = "TR121";
    declarationRule.qualifiedStaffIds = [supervisor!.id, ordinary!.id];
    state.positionRules = [supervisorRule, declarationRule];
    state.history = [
      record(
        "supervisor-work",
        supervisor!.id,
        "TR121",
        "督导",
        "",
        "21:55",
        "23:55"
      ),
      record(
        "ordinary-declaration",
        ordinary!.id,
        "TR121",
        "H04",
        "申报",
        "21:55",
        "23:55"
      ),
    ];
    const facts = createScheduleFrequencyFacts(state, DATE);
    const flight = {
      flightNo: "TR121",
      startTime: "21:55",
      endTime: "23:55",
    };
    const supervisorProfile = latePriorityFrequencyProfileForRule(
      state,
      supervisor!.id,
      flight,
      declarationRule,
      DATE,
      facts
    );
    const ordinaryProfile = latePriorityFrequencyProfileForRule(
      state,
      ordinary!.id,
      flight,
      declarationRule,
      DATE,
      facts
    );

    expect(
      compareLatePriorityFrequency(supervisorProfile, ordinaryProfile)
    ).toBe(0);
  });

  it("reserves the lower-frequency supervisor for supervision before declaration", () => {
    const state = createDefaultState();
    const [ordinary, underusedSupervisor, frequentSupervisor] =
      state.staff.slice(0, 3);
    const supervisorRule = rule("督导", "");
    supervisorRule.flightNo = "TR121";
    supervisorRule.qualifiedStaffIds = [
      underusedSupervisor!.id,
      frequentSupervisor!.id,
    ];
    const declarationRule = rule("H04", "申报");
    declarationRule.flightNo = "TR121";
    declarationRule.qualifiedStaffIds = [ordinary!.id, underusedSupervisor!.id];
    state.positionRules = [supervisorRule, declarationRule];
    state.history = [
      record(
        "frequent-supervisor",
        frequentSupervisor!.id,
        "TR121",
        "督导",
        "",
        "21:55",
        "23:55"
      ),
      record(
        "ordinary-declaration",
        ordinary!.id,
        "TR121",
        "H04",
        "申报",
        "21:55",
        "23:55"
      ),
    ];
    const facts = createScheduleFrequencyFacts(state, DATE);
    const flight = {
      flightNo: "TR121",
      startTime: "21:55",
      endTime: "23:55",
    };
    const ordinaryProfile = latePriorityFrequencyProfileForRule(
      state,
      ordinary!.id,
      flight,
      declarationRule,
      DATE,
      facts
    );
    const supervisorProfile = latePriorityFrequencyProfileForRule(
      state,
      underusedSupervisor!.id,
      flight,
      declarationRule,
      DATE,
      facts
    );

    expect(
      compareLatePriorityFrequency(ordinaryProfile, supervisorProfile)
    ).toBeLessThan(0);
  });
});
