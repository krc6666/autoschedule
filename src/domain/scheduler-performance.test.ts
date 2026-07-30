import { describe, expect, it } from "vitest";

import {
  currentScheduleHistory,
  replaceHistoryForDate,
} from "../app/history-actions";
import { createDefaultState } from "../defaults";
import type {
  AppState,
  Assignment,
  HistoryRecord,
  PositionRule,
  Staff,
} from "../model";
import { reviewConsecutivePositionRotation } from "./position-rotation-review";
import { generateSchedule, type ScheduleProgressStage } from "./scheduler";
import { SCHEDULE_PROGRESS_STAGES } from "./schedule-progress";

function clockTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function createDenseScheduleState(): AppState {
  const state = createDefaultState();
  const baseStaff = state.staff[0]!;
  state.staff = Array.from({ length: 32 }, (_, index) => ({
    ...baseStaff,
    id: `stress-staff-${index + 1}`,
    name: `压力人员${index + 1}`,
    status: "正常" as const,
    staffType: "常规" as const,
    teamLeader: false,
    cxPreflightQualified: false,
    dutyQualified: false,
    nightShift: true,
  }));
  const qualifiedStaffIds = state.staff.map((person) => person.id);
  const baseRule = state.positionRules[0]!;
  state.flights = Array.from({ length: 24 }, (_, index) => {
    const start = 6 * 60 + index * 15;
    return {
      id: `stress-flight-${index + 1}`,
      flightNo: `ST${String(index + 1).padStart(3, "0")}`,
      startTime: clockTime(start),
      endTime: clockTime(start + 90),
      bookedPassengers: 200,
      positions: ["G01", "G02", "G03", "G04"],
      remark: "",
    };
  });
  state.positionRules = state.flights.flatMap((flight) =>
    flight.positions.map((position, index) => ({
      ...baseRule,
      id: `${flight.id}-position-${index + 1}`,
      flightNo: flight.flightNo,
      name: position,
      category: "常规" as const,
      remark: index === 0 ? "一号" : "",
      qualifiedStaffIds,
      manual: false,
      fatiguePoints: index === 0 ? 4 : 2,
      minPassengers: 0,
      earlyReleaseMinutes: 0,
    }))
  );
  state.history = [];
  state.dutyRosterOverrides = [];
  state.settings.positionTransitionPolicies = [];
  state.settings.maxDailyHours = 12;
  return state;
}

function operationalMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
}

function createDeepRotationDeadEnd(): {
  state: AppState;
  assignments: Assignment[];
  originalStaffIds: string[];
} {
  const state = createDefaultState();
  const baseStaff = state.staff[0]!;
  const staff: Staff[] = Array.from({ length: 15 }, (_, index) => ({
    ...baseStaff,
    id: `rotation-staff-${index}`,
    name: `轮岗人员${index}`,
    status: "正常",
    staffType: "常规",
    teamLeader: false,
    cxPreflightQualified: false,
    dutyQualified: false,
    nightShift: true,
  }));
  state.staff = staff;
  state.settings.maxDailyHours = 2;
  state.settings.nextDutyRestProtectionEnabled = false;
  state.settings.lateShiftRecoveryEnabled = false;
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.workloadBalanceEnabled = false;
  state.settings.positionTransitionPolicies = [];
  const qualifiedStaffIds = staff.map((person) => person.id);
  const baseRule = state.positionRules[0]!;
  const primaryRule: PositionRule = {
    ...baseRule,
    id: "rotation-primary",
    flightNo: "ROT100",
    name: "G20",
    remark: "申报",
    category: "常规",
    qualifiedStaffIds,
    fatiguePoints: 6,
    manual: false,
  };
  const relayRules = staff.slice(1).map<PositionRule>((_, index) => ({
    ...baseRule,
    id: `rotation-relay-${index + 1}`,
    flightNo: `RELAY${index + 1}`,
    name: `G${19 - index}`,
    remark: "",
    category: "常规",
    qualifiedStaffIds,
    fatiguePoints: 1,
    manual: false,
  }));
  const lockedRules = staff.map<PositionRule>((_, index) => ({
    ...baseRule,
    id: `rotation-locked-${index}`,
    flightNo: `EARLY${index}`,
    name: "固定任务",
    remark: "",
    category: "常规",
    qualifiedStaffIds: [staff[index]!.id],
    fatiguePoints: 1,
    manual: true,
  }));
  state.positionRules = [primaryRule, ...relayRules, ...lockedRules];
  state.flights = [
    {
      id: "rotation-primary-flight",
      flightNo: "ROT100",
      startTime: "08:00",
      endTime: "09:30",
      bookedPassengers: 100,
      positions: [primaryRule.name],
      remark: "",
    },
    ...relayRules.map((rule, index) => ({
      id: `rotation-relay-flight-${index + 1}`,
      flightNo: rule.flightNo,
      startTime: "09:00",
      endTime: "09:30",
      bookedPassengers: 100,
      positions: [rule.name],
      remark: "",
    })),
    ...lockedRules.map((rule, index) => ({
      id: `rotation-locked-flight-${index}`,
      flightNo: rule.flightNo,
      startTime: index === 0 ? "07:00" : "06:00",
      endTime: index === 0 ? "07:30" : "07:30",
      bookedPassengers: 100,
      positions: [rule.name],
      remark: "",
    })),
  ];
  const assignments: Assignment[] = [
    {
      id: "rotation-primary-assignment",
      flightId: "rotation-primary-flight",
      flightNo: "ROT100",
      positionRuleId: primaryRule.id,
      position: primaryRule.name,
      staffId: staff[0]!.id,
      staffName: staff[0]!.name,
      startTime: "08:00",
      endTime: "09:30",
      workHours: 1.5,
      fatiguePoints: primaryRule.fatiguePoints,
      remark: primaryRule.remark,
      manualRemark: "",
      status: "assigned",
    },
    ...relayRules.map<Assignment>((rule, index) => ({
      id: `rotation-relay-assignment-${index + 1}`,
      flightId: `rotation-relay-flight-${index + 1}`,
      flightNo: rule.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: staff[index + 1]!.id,
      staffName: staff[index + 1]!.name,
      startTime: "09:00",
      endTime: "09:30",
      workHours: 0.5,
      fatiguePoints: rule.fatiguePoints,
      remark: rule.remark,
      manualRemark: "",
      status: "assigned",
    })),
    ...lockedRules.map<Assignment>((rule, index) => ({
      id: `rotation-locked-assignment-${index}`,
      flightId: `rotation-locked-flight-${index}`,
      flightNo: rule.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: staff[index]!.id,
      staffName: staff[index]!.name,
      startTime: index === 0 ? "07:00" : "06:00",
      endTime: index === 0 ? "07:30" : "07:30",
      workHours: index === 0 ? 0.5 : 1.5,
      fatiguePoints: rule.fatiguePoints,
      remark: rule.remark,
      manualRemark: "",
      status: "assigned",
    })),
  ];
  const previousPrimary: HistoryRecord = {
    id: "rotation-previous-primary",
    date: "2026-07-28",
    flightNo: "ROT100",
    position: primaryRule.name,
    staffId: staff[0]!.id,
    staffName: staff[0]!.name,
    startTime: "08:00",
    endTime: "09:30",
    workHours: 1.5,
    fatiguePoints: primaryRule.fatiguePoints,
    remark: primaryRule.remark,
  };
  state.history = [
    previousPrimary,
    ...Array.from<unknown, HistoryRecord>({ length: 558 }, (_, index) => ({
      id: `rotation-history-${index}`,
      date: "2026-07-26",
      flightNo: `ARCHIVE${index % 20}`,
      position: `P${index % 30}`,
      staffId: staff[index % staff.length]!.id,
      staffName: staff[index % staff.length]!.name,
      startTime: "10:00",
      endTime: "11:00",
      workHours: 1,
      fatiguePoints: 1,
      remark: "",
    })),
  ];
  return {
    state,
    assignments,
    originalStaffIds: assignments.map((item) => item.staffId ?? ""),
  };
}

describe("scheduler performance safeguards", () => {
  it("reuses one run's protection facts and reports stable scheduling phases", () => {
    const state = createDefaultState();
    const phases: ScheduleProgressStage[] = [];
    const first = generateSchedule(state, "2026-07-01", {
      onProgress: (stage) => phases.push(stage),
    });
    state.assignments = first.assignments;
    state.activeScheduleDate = "2026-07-01";
    replaceHistoryForDate(
      state,
      "2026-07-01",
      currentScheduleHistory(state, "2026-07-01")
    );

    const started = performance.now();
    const second = generateSchedule(state, "2026-07-03");
    const elapsed = performance.now() - started;

    expect(second.assignments).toHaveLength(first.assignments.length);
    expect(phases).toEqual(SCHEDULE_PROGRESS_STAGES);
    expect(elapsed).toBeLessThan(2500);
  }, 15000);

  it("finishes a dense 96-position schedule without overlaps or dropped positions", () => {
    const state = createDenseScheduleState();
    const phaseTimings: Array<{
      stage: ScheduleProgressStage;
      elapsed: number;
    }> = [];

    const started = performance.now();
    const result = generateSchedule(state, "2026-07-30", {
      onProgress: (stage) =>
        phaseTimings.push({
          stage,
          elapsed: Math.round(performance.now() - started),
        }),
    });
    const elapsed = performance.now() - started;

    expect(result.assignments).toHaveLength(96);
    expect(result.unfilledCount).toBe(0);
    expect(
      new Set(result.assignments.map((assignment) => assignment.id)).size
    ).toBe(96);
    for (const person of state.staff) {
      const ownAssignments = result.assignments
        .filter(
          (assignment) =>
            assignment.staffId === person.id && assignment.workHours > 0
        )
        .sort(
          (left, right) =>
            operationalMinutes(left.startTime) -
            operationalMinutes(right.startTime)
        );
      for (let index = 1; index < ownAssignments.length; index += 1) {
        expect(
          operationalMinutes(ownAssignments[index - 1]!.endTime)
        ).toBeLessThanOrEqual(
          operationalMinutes(ownAssignments[index]!.startTime)
        );
      }
    }
    expect(elapsed, JSON.stringify(phaseTimings)).toBeLessThan(2500);
  }, 15000);

  it("finishes a five-person rotation dead end without combinatorial delay", () => {
    const { state, assignments, originalStaffIds } =
      createDeepRotationDeadEnd();

    const started = performance.now();
    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-30",
      new Set()
    );
    const elapsed = performance.now() - started;

    expect(assignments.map((item) => item.staffId)).toEqual(originalStaffIds);
    expect(warnings.join("\n")).toContain("重点岗位连续轮岗未落实");
    expect(elapsed).toBeLessThan(2500);
  }, 15000);

  it("finishes a final-late fatigue-relief dead end without enumerating every five-person permutation", () => {
    const { state, assignments, originalStaffIds } =
      createDeepRotationDeadEnd();
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "late-declaration",
        enabled: true,
        flightNo: "ROT100",
        matchField: "remark",
        keyword: "申报",
        nextWorkdayCutoffTime: "20:00",
      },
    ];
    const movableRules = state.positionRules.filter((rule) => !rule.manual);
    state.settings.positionTransitionPolicies = movableRules.map(
      (rule, index) => ({
        id: `strict-late-transition-${index}`,
        name: `严格晚班衔接${index}`,
        enabled: true,
        sourceFlightNo: "",
        sourcePositions: ["固定任务"],
        targetFlightNo: rule.flightNo,
        targetPosition: rule.name,
        minimumGapMinutes: 1440,
        mode: "forbid" as const,
      })
    );
    state.flights.forEach((flight) => {
      if (!flight.id.startsWith("rotation-locked")) {
        flight.startTime = "21:00";
        flight.endTime = "22:30";
      }
    });
    assignments.forEach((assignment) => {
      if (!assignment.id.startsWith("rotation-locked")) {
        assignment.startTime = "21:00";
        assignment.endTime = "22:30";
      }
    });
    state.history[0]!.startTime = "21:00";
    state.history[0]!.endTime = "22:30";

    const started = performance.now();
    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-30",
      new Set()
    );
    const elapsed = performance.now() - started;

    expect(assignments.map((item) => item.staffId)).toEqual(originalStaffIds);
    expect(warnings.join("\n")).toContain("重点岗位连续轮岗未落实");
    expect(elapsed).toBeLessThan(2500);
  }, 15000);
});
