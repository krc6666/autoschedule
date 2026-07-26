import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { sortFlightCountersDescending, visiblePositionRemark } from "../utils";
import { intervalsOverlap } from "./time";
import { canAssignStaff } from "./assignment-validation";
import { generateSchedule } from "./scheduler";
import { activeFlightPositions } from "./schedule-position-rules";
import { getDutyRosterForDate } from "./duty-roster";
import { buildScheduleFeedback } from "./schedule-feedback";

describe("scheduler domain", () => {
  it("assigns only available and qualified staff without time conflicts", () => {
    const state = createDefaultState();
    const result = generateSchedule(state, "2026-07-18");
    const assigned = result.assignments.filter((item) => item.staffId);

    for (const assignment of assigned) {
      const person = state.staff.find((item) => item.id === assignment.staffId)!;
      const rule = state.positionRules.find((item) => item.id === assignment.positionRuleId)!;
      expect(person.status).toBe("正常");
      if (rule.category !== "引导") expect(rule.qualifiedStaffIds).toContain(person.id);
      const conflicts = assigned.filter((other) => other.id !== assignment.id && other.staffId === assignment.staffId && intervalsOverlap(other.startTime, other.endTime, assignment.startTime, assignment.endTime))
        .filter((other) => other.flightId !== assignment.flightId
          || (state.positionRules.find((item) => item.id === other.positionRuleId)?.category !== "引导" && rule.category !== "引导"));
      expect(conflicts).toHaveLength(0);
    }
  });

  it("marks a position unfilled when every qualified person is unavailable", () => {
    const state = createDefaultState();
    const rule = state.positionRules.find((item) => item.flightNo === "TR121" && item.name === "收费/引导")!;
    state.staff.filter((item) => rule.qualifiedStaffIds.includes(item.id)).forEach((item) => { item.status = "休假"; });
    const result = generateSchedule(state, "2026-07-18");
    const assignment = result.assignments.find((item) => item.positionRuleId === rule.id)!;
    expect(assignment.staffId).toBeNull();
    expect(result.unfilledCount).toBeGreaterThan(0);
  });

  it("prefers the candidate with lower historical fatigue", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    state.flights[0]!.positions = ["G12"];
    state.history = [{ id: "h1", date: "2026-07-17", flightNo: "F", position: "P", staffId: "2", staffName: "华嘉慧", startTime: "08:00", endTime: "12:00", workHours: 4, fatiguePoints: 30, remark: "" }];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments[0]!.staffId).not.toBe("2");
  });

  it("prefers the qualified worker with fewer same-position assignments in the last six archived workdays", () => {
    const state = createDefaultState();
    const [frequent, lessFrequent] = state.staff;
    state.staff = [frequent!, lessFrequent!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "cx", flightNo: "CX937", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", fatiguePoints: 1, remark: "一号", qualifiedStaffIds: [frequent!.id, lessFrequent!.id] }];
    state.settings.historyWindowDays = 1;
    state.history = [
      "2026-10-02", "2026-10-04", "2026-10-06", "2026-10-08"
    ].map((date, index) => ({
      id: `frequent-${index}`, date, flightNo: "CX937", position: "G20", staffId: frequent!.id, staffName: frequent!.name,
      startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: ""
    })).concat(
      ["2026-09-20", "2026-09-22", "2026-09-24", "2026-09-26"].map((date, index) => ({
        id: `older-less-frequent-${index}`, date, flightNo: "CX937", position: "G20", staffId: lessFrequent!.id, staffName: lessFrequent!.name,
        startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: ""
      })),
      [
        { id: "less-frequent", date: "2026-10-10", flightNo: "CX937", position: "G20", staffId: lessFrequent!.id, staffName: lessFrequent!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: "" },
        { id: "unrelated", date: "2026-10-12", flightNo: "CX937", position: "G18", staffId: frequent!.id, staffName: frequent!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: "" }
      ]
    );

    const assignment = generateSchedule(state, "2026-10-14").assignments[0]!;
    expect(assignment.staffId).toBe(lessFrequent!.id);
    expect(assignment.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "position-frequency", outcome: "selected" })
    ]));
  });

  it("does not reserve a low-frequency priority-position worker for an ordinary position that another worker can cover", () => {
    const state = createDefaultState();
    const [frequent, lessFrequent, ordinaryWorker] = state.staff.filter((person) => person.status === "正常").slice(0, 3);
    state.staff = [frequent!, lessFrequent!, ordinaryWorker!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "cx931", flightNo: "CX931", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "cx-g20", flightNo: "CX931", name: "G20", category: "常规", fatiguePoints: 4, remark: "一号", qualifiedStaffIds: [frequent!.id, lessFrequent!.id] },
      { ...base, id: "cx-g15", flightNo: "CX931", name: "G15", category: "常规", fatiguePoints: 1, remark: "", qualifiedStaffIds: [lessFrequent!.id, ordinaryWorker!.id] }
    ];
    state.history = ["2026-08-15", "2026-08-17", "2026-08-19", "2026-08-21"].map((date, index) => ({
      id: `frequent-priority-${index}`,
      date,
      flightNo: "CX931",
      position: "G20",
      staffId: frequent!.id,
      staffName: frequent!.name,
      startTime: "08:00",
      endTime: "10:00",
      workHours: 2,
      fatiguePoints: 4,
      remark: "一号"
    }));

    const assignments = generateSchedule(state, "2026-08-23").assignments;
    expect(assignments.find((item) => item.positionRuleId === "cx-g20")?.staffId).toBe(lessFrequent!.id);
    expect(assignments.find((item) => item.positionRuleId === "cx-g15")?.staffId).toBe(ordinaryWorker!.id);
  });

  it("does not use monthly frequency to choose an ordinary position worker", () => {
    const state = createDefaultState();
    const [first, second] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [first!, second!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "ordinary", flightNo: "CX931", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "cx-g15", flightNo: "CX931", name: "G15", category: "常规", fatiguePoints: 1, remark: "", qualifiedStaffIds: [first!.id, second!.id] }];
    state.history = [
      { id: "ordinary-1", date: "2026-08-15", flightNo: "CX931", position: "G15", staffId: first!.id, staffName: first!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: "" },
      { id: "ordinary-2", date: "2026-08-17", flightNo: "CX931", position: "G15", staffId: first!.id, staffName: first!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: "" },
      { id: "recent-1", date: "2026-08-19", flightNo: "OTHER", position: "P1", staffId: second!.id, staffName: second!.name, startTime: "11:00", endTime: "12:00", workHours: 1, fatiguePoints: 0, remark: "" },
      { id: "recent-2", date: "2026-08-21", flightNo: "OTHER", position: "P2", staffId: second!.id, staffName: second!.name, startTime: "11:00", endTime: "12:00", workHours: 1, fatiguePoints: 0, remark: "" }
    ];

    expect(generateSchedule(state, "2026-08-23").assignments[0]?.staffId).toBe(first!.id);
  });

  it("does not move a balanced priority-position worker to resolve an ordinary third consecutive assignment", () => {
    const state = createDefaultState();
    const [priorityWorker, repeatedWorker] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [priorityWorker!, repeatedWorker!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "cx931", flightNo: "CX931", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "cx-g20", flightNo: "CX931", name: "G20", category: "常规", remark: "一号", qualifiedStaffIds: [priorityWorker!.id, repeatedWorker!.id] },
      { ...base, id: "cx-g15", flightNo: "CX931", name: "G15", category: "常规", remark: "", qualifiedStaffIds: [priorityWorker!.id, repeatedWorker!.id] }
    ];
    state.history = [
      ...["2026-08-19", "2026-08-21"].map((date, index) => ({
        id: `ordinary-repeat-${index}`, date, flightNo: "CX931", position: "G15", staffId: repeatedWorker!.id, staffName: repeatedWorker!.name,
        startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: ""
      })),
      { id: "priority-history", date: "2026-08-17", flightNo: "CX931", position: "G20", staffId: repeatedWorker!.id, staffName: repeatedWorker!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 4, remark: "一号" }
    ];

    const assignments = generateSchedule(state, "2026-08-23").assignments;
    expect(assignments.find((item) => item.positionRuleId === "cx-g20")?.staffId).toBe(priorityWorker!.id);
    expect(assignments.find((item) => item.positionRuleId === "cx-g15")?.staffId).toBe(repeatedWorker!.id);
    expect(assignments.find((item) => item.positionRuleId === "cx-g15")?.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "position-rotation", outcome: "fallback" })
    ]));
  });

  it("uses the current-month total before the recent-six-workday count for long-term same-position fairness", () => {
    const state = createDefaultState();
    const [frequent, medium, leastFrequent] = state.staff.filter((person) => person.status === "正常").slice(0, 3);
    state.staff = [frequent!, medium!, leastFrequent!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "target-flight", flightNo: "TARGET100", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{
      ...base,
      id: "target-g20",
      flightNo: "TARGET100",
      name: "G20",
      category: "常规",
      fatiguePoints: 1,
      remark: "一号",
      qualifiedStaffIds: state.staff.map((person) => person.id)
    }];
    const dates = [
      "2026-10-02", "2026-10-04", "2026-10-06", "2026-10-08", "2026-10-10", "2026-10-12", "2026-10-14", "2026-10-16",
      "2026-10-18", "2026-10-20", "2026-10-22", "2026-10-24", "2026-10-26"
    ];
    state.history = dates.map((date, index) => {
      const person = index < 8 ? frequent! : index < 11 ? medium! : leastFrequent!;
      return {
        id: `monthly-g20-${index}`,
        date,
        flightNo: "TARGET100",
        position: "G20",
        staffId: person.id,
        staffName: person.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 1,
        remark: ""
      };
    });

    const assignment = generateSchedule(state, "2026-10-28").assignments[0]!;
    expect(assignment.staffId).toBe(leastFrequent!.id);
    expect(assignment.staffId).not.toBe(frequent!.id);
  });

  it("repairs task-order capture through a safe three-person reassignment path", () => {
    const state = createDefaultState();
    const [frequent, lessFrequent, releaseWorker] = state.staff.filter((person) => person.status === "正常").slice(0, 3);
    state.staff = [lessFrequent!, frequent!, releaseWorker!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "base", flightNo: "BASE100", startTime: "06:00", endTime: "07:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "source", flightNo: "SOURCE100", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "target", flightNo: "TARGET100", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "base-position", flightNo: "BASE100", name: "B01", category: "常规", fatiguePoints: 1, qualifiedStaffIds: [frequent!.id] },
      { ...base, id: "release-base-position", flightNo: "BASE100", name: "B02", category: "常规", fatiguePoints: 1, qualifiedStaffIds: [releaseWorker!.id] },
      { ...base, id: "source-position", flightNo: "SOURCE100", name: "S01", category: "常规", fatiguePoints: 1, qualifiedStaffIds: [lessFrequent!.id, releaseWorker!.id] },
      { ...base, id: "target-position", flightNo: "TARGET100", name: "G20", category: "常规", fatiguePoints: 1, remark: "一号", qualifiedStaffIds: [frequent!.id, lessFrequent!.id, releaseWorker!.id] }
    ];
    state.history = ["2026-10-02", "2026-10-04", "2026-10-06", "2026-10-08"].flatMap((date, index) => [
      {
        id: `frequent-target-${index}`,
        date,
        flightNo: "TARGET100",
        position: "G20",
        staffId: frequent!.id,
        staffName: frequent!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 1,
        remark: ""
      },
      {
        id: `release-target-${index}`,
        date,
        flightNo: "TARGET100",
        position: "G20",
        staffId: releaseWorker!.id,
        staffName: releaseWorker!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 1,
        remark: ""
      }
    ]);

    const assignments = generateSchedule(state, "2026-10-10").assignments;
    expect(assignments.find((item) => item.positionRuleId === "base-position")?.staffId).toBe(frequent!.id);
    expect(assignments.find((item) => item.positionRuleId === "target-position")?.staffId).toBe(lessFrequent!.id);
    expect(assignments.find((item) => item.positionRuleId === "source-position")?.staffId).toBe(releaseWorker!.id);
    expect(assignments.find((item) => item.positionRuleId === "target-position")?.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "position-frequency-review", outcome: "selected" })
    ]));
  });

  it("records why a high-frequency position cannot be balanced when no other worker is qualified", () => {
    const state = createDefaultState();
    const [onlyQualified, unqualified] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [onlyQualified!, unqualified!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "target", flightNo: "TARGET100", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "target-position", flightNo: "TARGET100", name: "G20", category: "常规", remark: "一号", qualifiedStaffIds: [onlyQualified!.id] }];
    state.history = ["2026-10-02", "2026-10-04", "2026-10-06"].map((date, index) => ({
      id: `only-qualified-${index}`,
      date,
      flightNo: "TARGET100",
      position: "G20",
      staffId: onlyQualified!.id,
      staffName: onlyQualified!.name,
      startTime: "08:30",
      endTime: "10:30",
      workHours: 2,
      fatiguePoints: 1,
      remark: ""
    }));

    state.assignments = generateSchedule(state, "2026-10-08").assignments;
    const target = state.assignments[0]!;
    expect(target.staffId).toBe(onlyQualified!.id);
    expect(target.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "position-frequency-review", outcome: "fallback" })
    ]));
    const feedback = buildScheduleFeedback(state, "2026-10-08").find((item) => item.key === "position-frequency-review")!;
    expect(feedback).toMatchObject({ status: "需复核" });
    expect(feedback.text).toContain("无其他具备目标岗位资质的人员");
  });

  it("prefers a rested worker for a high-load position during the recovery window", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "first-flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second-base-flight", flightNo: "F0", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "next-flight", flightNo: "F2", startTime: "11:00", endTime: "13:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = { ...state.positionRules[0]!, category: "常规" as const };
    state.positionRules = [
      { ...base, id: "first-high", flightNo: "F1", name: "一号柜台", remark: "一号", fatiguePoints: 5, qualifiedStaffIds: [first!.id] },
      { ...base, id: "second-base", flightNo: "F0", name: "普通柜台", remark: "", fatiguePoints: 1, qualifiedStaffIds: [second!.id] },
      { ...base, id: "next-high", flightNo: "F2", name: "控制柜台", remark: "", fatiguePoints: 5, qualifiedStaffIds: [first!.id, second!.id] }
    ];
    state.history = [{ id: "history", date: "2026-07-17", flightNo: "OLD", position: "P", staffId: second!.id, staffName: second!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 20, remark: "" }];
    state.settings.highLoadProtectionEnabled = true;
    state.settings.highLoadFatigueThreshold = 4;
    state.settings.highLoadRecoveryMinutes = 180;
    state.settings.remarkedPositionHighLoad = true;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.positionRotationEnabled = false;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "next-high")?.staffId).toBe(second!.id);
    state.settings.highLoadProtectionEnabled = false;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "next-high")?.staffId).toBe(first!.id);
  });

  it("fills a high-load position when every candidate is still in the protection window", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.flights = [
      { id: "first-flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second-flight", flightNo: "F2", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "next-flight", flightNo: "F3", startTime: "11:00", endTime: "13:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "first-high", flightNo: "F1", name: "一号", remark: "一号", fatiguePoints: 5, qualifiedStaffIds: [first!.id] },
      { ...base, id: "second-high", flightNo: "F2", name: "申报", remark: "申报", fatiguePoints: 5, qualifiedStaffIds: [second!.id] },
      { ...base, id: "next-high", flightNo: "F3", name: "控制", remark: "控制", fatiguePoints: 5, qualifiedStaffIds: [first!.id, second!.id] }
    ];
    state.settings.highLoadProtectionEnabled = true;
    state.settings.highLoadFatigueThreshold = 4;
    state.settings.highLoadRecoveryMinutes = 180;
    state.settings.remarkedPositionHighLoad = true;
    const result = generateSchedule(state, "2026-07-18");
    const target = result.assignments.find((item) => item.positionRuleId === "next-high")!;
    expect(target).toMatchObject({ staffId: expect.any(String), status: "assigned" });
    state.assignments = result.assignments;
    expect(canAssignStaff(state, target.id, first!.id)).toBeNull();
  });

  it("applies an editable position-to-position preparation interval", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "source-flight", flightNo: "CX931", startTime: "17:50", endTime: "19:50", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second-base-flight", flightNo: "BASE", startTime: "17:50", endTime: "19:50", bookedPassengers: 100, positions: [], remark: "" },
      { id: "target-flight", flightNo: "TR121", startTime: "21:55", endTime: "23:55", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "source-g19", flightNo: "CX931", name: "G19", category: "常规", fatiguePoints: 2, remark: "", qualifiedStaffIds: [first!.id] },
      { ...base, id: "second-base", flightNo: "BASE", name: "普通柜台", category: "常规", fatiguePoints: 1, remark: "", qualifiedStaffIds: [second!.id] },
      { ...base, id: "target-h02", flightNo: "TR121", name: "H02", category: "常规", fatiguePoints: 2, remark: "", qualifiedStaffIds: [first!.id, second!.id] }
    ];
    state.history = [{ id: "history", date: "2026-07-17", flightNo: "OLD", position: "P", staffId: second!.id, staffName: second!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 20, remark: "" }];
    state.settings.positionTransitionPolicies = [{
      id: "cx931-h02", name: "H02准备保护", enabled: true,
      sourceFlightNo: "CX931", sourcePositions: ["G19"], targetFlightNo: "TR121", targetPosition: "H02",
      minimumGapMinutes: 180, mode: "prefer"
    }];
    const protectedSchedule = generateSchedule(state, "2026-07-18");
    expect(protectedSchedule.assignments.find((item) => item.positionRuleId === "target-h02")?.staffId).toBe(second!.id);
    state.assignments = protectedSchedule.assignments;
    state.settings.positionTransitionPolicies[0]!.mode = "forbid";
    const protectedTarget = state.assignments.find((item) => item.positionRuleId === "target-h02")!;
    expect(canAssignStaff(state, protectedTarget.id, first!.id)).toContain("最小衔接间隔");
    state.settings.positionTransitionPolicies[0]!.enabled = false;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "target-h02")?.staffId).toBe(first!.id);
  });

  it("protects a worker when projected fatigue exceeds the rolling-window limit", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "first-flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second-base-flight", flightNo: "F0", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "next-flight", flightNo: "F2", startTime: "11:00", endTime: "13:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "first-load", flightNo: "F1", name: "P1", category: "常规", fatiguePoints: 5, remark: "", qualifiedStaffIds: [first!.id] },
      { ...base, id: "second-base", flightNo: "F0", name: "P0", category: "常规", fatiguePoints: 1, remark: "", qualifiedStaffIds: [second!.id] },
      { ...base, id: "next-load", flightNo: "F2", name: "P2", category: "常规", fatiguePoints: 5, remark: "", qualifiedStaffIds: [first!.id, second!.id] }
    ];
    state.history = [{ id: "history", date: "2026-07-17", flightNo: "OLD", position: "P", staffId: second!.id, staffName: second!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 20, remark: "" }];
    state.settings.highLoadProtectionEnabled = false;
    state.settings.positionTransitionPolicies = [];
    state.settings.rollingLoadProtectionEnabled = true;
    state.settings.rollingLoadWindowMinutes = 360;
    state.settings.rollingLoadMaxFatigue = 8;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "next-load")?.staffId).toBe(second!.id);
    state.settings.rollingLoadProtectionEnabled = false;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "next-load")?.staffId).toBe(first!.id);
  });

  it("uses the same-position frequency rule only while same-position fairness is enabled", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "g20", flightNo: "F1", name: "G20", category: "常规", fatiguePoints: 4, remark: "一号", qualifiedStaffIds: [first!.id, second!.id] }];
    state.history = [
      { id: "repeat", date: "2026-07-17", flightNo: "F1", position: "G20", staffId: first!.id, staffName: first!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: "" },
      { id: "other-load", date: "2026-07-17", flightNo: "OLD", position: "OTHER", staffId: second!.id, staffName: second!.name, startTime: "11:00", endTime: "13:00", workHours: 2, fatiguePoints: 20, remark: "" }
    ];
    state.settings.positionRotationEnabled = true;
    expect(generateSchedule(state, "2026-07-18").assignments[0]!.staffId).toBe(second!.id);
    state.settings.positionRotationEnabled = false;
    expect(generateSchedule(state, "2026-07-18").assignments[0]!.staffId).toBe(first!.id);
  });

  it("fills the position when every qualified candidate recently worked the same position", () => {
    const state = createDefaultState();
    const workers = state.staff.slice(0, 2);
    state.staff = workers;
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "position", flightNo: "F1", name: "G12", qualifiedStaffIds: workers.map((person) => person.id) }];
    state.history = workers.map((person, index) => ({
      id: `history-${index}`, date: "2026-07-17", flightNo: "F1", position: "G12", staffId: person.id, staffName: person.name,
      startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: ""
    }));
    state.settings.positionRotationEnabled = true;
    expect(generateSchedule(state, "2026-07-18").assignments[0]).toMatchObject({ status: "assigned", staffId: expect.any(String) });
  });

  it("fills a rolling-load protected position when no unprotected candidate exists", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.staff = [person];
    person.dutyQualified = false;
    state.flights = [
      { id: "first", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "next", flightNo: "F2", startTime: "11:00", endTime: "13:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "first", flightNo: "F1", name: "G12", fatiguePoints: 5, remark: "", qualifiedStaffIds: [person.id] },
      { ...base, id: "next", flightNo: "F2", name: "G13", fatiguePoints: 5, remark: "", qualifiedStaffIds: [person.id] }
    ];
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = true;
    state.settings.rollingLoadMaxFatigue = 8;
    expect(generateSchedule(state, "2026-07-18").assignments).toMatchObject([
      { status: "assigned", staffId: person.id },
      { status: "assigned", staffId: person.id }
    ]);
  });

  it("reduces the next late-shift load after a high-load final flight on the previous day", () => {
    const state = createDefaultState();
    const [protectedWorker, restedWorker] = state.staff;
    state.staff = [protectedWorker!, restedWorker!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "late-flight", flightNo: "TR121", startTime: "21:55", endTime: "23:55", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "late-high", flightNo: "TR121", name: "H02", category: "常规", fatiguePoints: 4, remark: "一号", qualifiedStaffIds: [protectedWorker!.id, restedWorker!.id] }
    ];
    state.history = [
      { id: "previous-late", date: "2026-07-18", flightNo: "TR121", position: "H02", staffId: protectedWorker!.id, staffName: protectedWorker!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 5, remark: "一号" },
      { id: "rested-worker-load", date: "2026-07-18", flightNo: "EARLY", position: "P", staffId: restedWorker!.id, staffName: restedWorker!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 20, remark: "" }
    ];
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.positionRotationEnabled = false;
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.lateShiftStartTime = "20:00";
    state.settings.lateShiftLatestWindowMinutes = 180;
    state.settings.nextDayLateMaxFatigue = 2;
    expect(generateSchedule(state, "2026-07-20").assignments[0]!.staffId).toBe(restedWorker!.id);
    state.settings.lateShiftRecoveryEnabled = false;
    expect(generateSchedule(state, "2026-07-20").assignments[0]!.staffId).toBe(protectedWorker!.id);
  });

  it("keeps a protected late-shift worker for the lighter lower position when staffing is limited", () => {
    const state = createDefaultState();
    const [protectedWorker, restedWorker] = state.staff;
    state.staff = [protectedWorker!, restedWorker!];
    state.flights = [{ id: "late-flight", flightNo: "TR121", startTime: "21:55", endTime: "23:55", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "upper-high", flightNo: "TR121", name: "H02", fatiguePoints: 4, remark: "一号", qualifiedStaffIds: [protectedWorker!.id, restedWorker!.id] },
      { ...base, id: "lower-light", flightNo: "TR121", name: "H01", fatiguePoints: 1, remark: "", qualifiedStaffIds: [protectedWorker!.id, restedWorker!.id] }
    ];
    state.history = [{ id: "previous-late", date: "2026-07-17", flightNo: "TR121", position: "H02", staffId: protectedWorker!.id, staffName: protectedWorker!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 5, remark: "一号" }];
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.positionRotationEnabled = false;
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.positionRuleId === "upper-high")?.staffId).toBe(restedWorker!.id);
    expect(result.assignments.find((item) => item.positionRuleId === "lower-light")?.staffId).toBe(protectedWorker!.id);
  });

  it("protects the highest-fatigue final-late worker from a configured next-workday priority position before frequency balancing", () => {
    const state = createDefaultState();
    const [protectedWorker, alternate] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [protectedWorker!, alternate!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "cx937", flightNo: "CX937", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", remark: "一号", fatiguePoints: 4, qualifiedStaffIds: [protectedWorker!.id, alternate!.id] }];
    state.history = [
      { id: "late-highest", date: "2026-08-21", flightNo: "TR121", position: "H02", staffId: protectedWorker!.id, staffName: protectedWorker!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 10, remark: "一号" },
      { id: "late-lower", date: "2026-08-21", flightNo: "TW616", position: "G12", staffId: alternate!.id, staffName: alternate!.name, startTime: "21:30", endTime: "23:30", workHours: 2, fatiguePoints: 5, remark: "一号" },
      { id: "alternate-frequency-1", date: "2026-08-17", flightNo: "CX937", position: "G20", staffId: alternate!.id, staffName: alternate!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 0, remark: "一号" },
      { id: "alternate-frequency-2", date: "2026-08-19", flightNo: "CX937", position: "G20", staffId: alternate!.id, staffName: alternate!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 0, remark: "一号" }
    ];

    const target = generateSchedule(state, "2026-08-23").assignments[0]!;
    expect(target.staffId).toBe(alternate!.id);
    expect(target.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "late-shift-recovery", outcome: "selected" })
    ]));
  });

  it("keeps the duty morning lock ahead of next-workday priority-position recovery", () => {
    const state = createDefaultState();
    const [dutyWorker, alternate] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [dutyWorker!, alternate!];
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.flights = [{ id: "cx937", flightNo: "CX937", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", remark: "一号", qualifiedStaffIds: [dutyWorker!.id, alternate!.id] }];
    state.dutyRosterOverrides = [{ date: "2026-08-23", cxPreflightStaffId: null, dutyStaffId: dutyWorker!.id, standbyStaffIds: [null, null] }];
    state.history = [{ id: "late-highest", date: "2026-08-21", flightNo: "TR121", position: "H02", staffId: dutyWorker!.id, staffName: dutyWorker!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 10, remark: "一号" }];

    state.assignments = generateSchedule(state, "2026-08-23").assignments;
    expect(state.assignments[0]?.staffId).toBe(dutyWorker!.id);
    const feedback = buildScheduleFeedback(state, "2026-08-23").find((item) => item.key === "previous-late")!;
    expect(feedback.status).toBe("需复核");
    expect(feedback.text).toContain("值班早班锁定优先");
  });

  it("keeps the only qualified worker on a protected next-workday position and explains the coverage override", () => {
    const state = createDefaultState();
    const [onlyQualified, unqualified] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [onlyQualified!, unqualified!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "ke166", flightNo: "KE166", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "ke-one", flightNo: "KE166", name: "H02", category: "常规", remark: "一号", qualifiedStaffIds: [onlyQualified!.id] }];
    state.history = [{ id: "late-highest", date: "2026-08-21", flightNo: "TR121", position: "H02", staffId: onlyQualified!.id, staffName: onlyQualified!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 10, remark: "一号" }];

    state.assignments = generateSchedule(state, "2026-08-23").assignments;
    expect(state.assignments[0]?.staffId).toBe(onlyQualified!.id);
    const feedback = buildScheduleFeedback(state, "2026-08-23").find((item) => item.key === "previous-late")!;
    expect(feedback.status).toBe("需复核");
    expect(feedback.text).toContain("唯一合格人员");
  });

  it("keeps the KE166 mobile-supervisor lock ahead of next-workday recovery and explains the override", () => {
    const state = createDefaultState();
    const [mobileSupervisor, alternate] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [mobileSupervisor!, alternate!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "ke166", flightNo: "KE166", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "ke-supervisor", flightNo: "KE166", name: "督导", category: "机动督导", remark: "", qualifiedStaffIds: [mobileSupervisor!.id] },
      { ...base, id: "ke-one", flightNo: "KE166", name: "H02", category: "常规", remark: "一号", qualifiedStaffIds: [mobileSupervisor!.id, alternate!.id] }
    ];
    state.settings.mobileSupervisorCoverageRules = [];
    state.history = [{ id: "late-highest", date: "2026-08-21", flightNo: "TR121", position: "H02", staffId: mobileSupervisor!.id, staffName: mobileSupervisor!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 10, remark: "一号" }];

    state.assignments = generateSchedule(state, "2026-08-23").assignments;

    expect(state.assignments.find((assignment) => assignment.positionRuleId === "ke-one")?.staffId).toBe(mobileSupervisor!.id);
    const feedback = buildScheduleFeedback(state, "2026-08-23").find((item) => item.key === "previous-late")!;
    expect(feedback.status).toBe("需复核");
    expect(feedback.text).toContain("KE166机动督导锁定优先");
  });

  it("fills a next-day late position when the protected worker is the only candidate", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.staff = [person];
    state.flights = [{ id: "late-flight", flightNo: "TR121", startTime: "21:55", endTime: "23:55", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "late-high", flightNo: "TR121", name: "H02", fatiguePoints: 4, remark: "一号", qualifiedStaffIds: [person.id] }];
    state.history = [{ id: "previous-late", date: "2026-07-17", flightNo: "TR121", position: "H02", staffId: person.id, staffName: person.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 5, remark: "一号" }];
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.positionRotationEnabled = false;
    state.settings.nextDayLateMaxFatigue = 2;
    const result = generateSchedule(state, "2026-07-18");
    const target = result.assignments[0]!;
    expect(target).toMatchObject({ staffId: person.id, status: "assigned" });
    state.assignments = result.assignments;
    state.activeScheduleDate = "2026-07-18";
    expect(canAssignStaff(state, target.id, person.id)).toBeNull();
  });

  it("never leaves an early position empty because the worker handled the previous late shift", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.staff = [person];
    person.dutyQualified = false;
    state.flights = [{ id: "early", flightNo: "KE166", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "early-position", flightNo: "KE166", name: "H03", qualifiedStaffIds: [person.id] }];
    state.history = [{ id: "previous-late", date: "2026-07-17", flightNo: "TR121", position: "H02", staffId: person.id, staffName: person.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 5, remark: "一号" }];
    state.settings.lateShiftRecoveryEnabled = true;
    expect(generateSchedule(state, "2026-07-18").assignments[0]).toMatchObject({ status: "assigned", staffId: person.id });
  });

  it("rejects manual changes that violate time constraints", () => {
    const state = createDefaultState();
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    const pair = state.assignments.flatMap((first) => state.assignments
      .filter((other) => other.flightId === first.flightId && other.id !== first.id && first.staffId)
      .filter((other) => {
        const rule = state.positionRules.find((item) => item.id === other.positionRuleId);
        return rule?.qualifiedStaffIds.includes(first.staffId!) ?? false;
      })
      .map((other) => ({ first, other })))[0]!;
    expect(canAssignStaff(state, pair.other.id, pair.first.staffId!)).toMatch(/时段/);
  });

  it("allows assigning a regular position when the only same-flight overlap is a guide assignment", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    const base = state.positionRules[0]!;
    state.staff = [person];
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    state.positionRules = [
      { ...base, id: "source", flightNo: "F1", name: "G01", category: "常规", qualifiedStaffIds: [person.id] },
      { ...base, id: "target", flightNo: "F1", name: "G02", category: "常规", qualifiedStaffIds: [person.id] },
      { ...base, id: "guide", flightNo: "F1", name: "柜台引导", category: "引导", qualifiedStaffIds: [] }
    ];
    state.assignments = generateSchedule(state, "2026-07-18").assignments;
    const source = state.assignments.find((item) => item.positionRuleId === "source")!;
    const target = state.assignments.find((item) => item.positionRuleId === "target")!;
    const guide = state.assignments.find((item) => item.positionRuleId === "guide")!;
    expect(guide.staffId).toBe(person.id);
    expect(canAssignStaff(state, target.id, person.id, source.id)).toBeNull();
  });

  it("keeps pre-noon regular positions visible and fills them below passenger thresholds", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    state.flights[0]!.positions = ["G12", "G13"];
    state.positionRules = state.positionRules.filter((rule) => rule.flightNo === "CX937" && ["G12", "G13"].includes(rule.name));
    state.flights[0]!.bookedPassengers = 20;
    state.positionRules.find((rule) => rule.flightNo === "CX937" && rule.name === "G13")!.minPassengers = 30;
    const belowThreshold = generateSchedule(state, "2026-07-18").assignments;
    expect(belowThreshold.map((item) => item.position)).toEqual(["G12", "G13"]);
    expect(belowThreshold.find((item) => item.position === "G13")).toMatchObject({ status: "assigned", staffId: expect.any(String) });
    state.flights[0]!.bookedPassengers = 30;
    expect(generateSchedule(state, "2026-07-18").assignments.find((item) => item.position === "G13")?.staffId).not.toBeNull();
  });

  it("puts supervisors first and otherwise follows position configuration order", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    state.flights = [flight];
    const rules = state.positionRules.filter((rule) => rule.flightNo === flight.flightNo);
    state.positionRules = [
      rules.find((rule) => rule.name === "G12")!,
      rules.find((rule) => rule.name === "督导")!,
      rules.find((rule) => rule.name === "G13")!,
      rules.find((rule) => rule.name === "超规柜台")!
    ];
    expect(activeFlightPositions(state, flight)).toEqual(["督导", "G12", "G13", "超规柜台"]);
  });

  it("sorts all G and H counters from high to low in one operation", () => {
    const state = createDefaultState();
    const flight = state.flights[0]!;
    const rules = state.positionRules.filter((rule) => rule.flightNo === flight.flightNo);
    state.positionRules = [
      rules.find((rule) => rule.name === "G12")!,
      rules.find((rule) => rule.name === "柜台引导1")!,
      rules.find((rule) => rule.name === "G20")!,
      rules.find((rule) => rule.name === "督导")!,
      rules.find((rule) => rule.name === "G13")!
    ];
    state.positionRules = sortFlightCountersDescending(state.positionRules, flight.flightNo);
    expect(activeFlightPositions(state, flight)).toEqual(["督导", "G20", "G13", "G12", "柜台引导1"]);
  });

  it("keeps administrative support in its position role instead of moving the category to the bottom", () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = true;
    state.staff = state.staff.slice(0, 3);
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "G14", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "G13", category: "行政支援", qualifiedStaffIds: [state.staff[1]!.id] },
      { ...base, id: "p3", flightNo: "F1", name: "督导", category: "行政支援", qualifiedStaffIds: [state.staff[2]!.id] }
    ];
    expect(generateSchedule(state, "2026-07-18").assignments.map((item) => item.position)).toEqual(["督导", "G14", "G13"]);
  });

  it("leaves administrative support empty when a basic position is short-staffed", () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = true;
    state.staff = [state.staff[0]!];
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "督导", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "G12", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p3", flightNo: "F1", name: "超规行李引导", category: "行政支援", qualifiedStaffIds: [] }
    ];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.position === "G12")?.status).toBe("unfilled");
    expect(result.assignments.find((item) => item.position === "超规行李引导")).toMatchObject({ status: "manual", staffId: null });
  });

  it("keeps administrative support positions empty even when basic positions are full", () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = true;
    state.staff = state.staff.slice(0, 2);
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "督导", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "超规行李引导", category: "行政支援", qualifiedStaffIds: [state.staff[1]!.id] }
    ];
    const adminSupport = generateSchedule(state, "2026-07-18").assignments.find((item) => item.position === "超规行李引导");
    expect(adminSupport).toMatchObject({ status: "manual", staffId: null });
  });

  it("omits administrative support positions while the mode is disabled", () => {
    const state = createDefaultState();
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "G14", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "行政补位", category: "行政支援", qualifiedStaffIds: [] }
    ];
    expect(generateSchedule(state, "2026-07-18").assignments.map((item) => item.position)).toEqual(["G14"]);
  });

  it("requires administrative personnel to have position qualifications in support mode", () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = true;
    const person = state.staff[0]!;
    person.staffType = "行政支援";
    state.flights = [state.flights[0]!];
    const rule = state.positionRules.find((item) => item.flightNo === state.flights[0]!.flightNo && item.name === "G12")!;
    rule.qualifiedStaffIds = [];
    state.assignments = [{
      id: "target", flightId: state.flights[0]!.id, flightNo: state.flights[0]!.flightNo, positionRuleId: rule.id,
      position: rule.name, staffId: null, staffName: "", startTime: state.flights[0]!.startTime, endTime: state.flights[0]!.endTime,
      workHours: 2, fatiguePoints: rule.fatiguePoints, remark: "", manualRemark: "", status: "unfilled"
    }];
    expect(canAssignStaff(state, "target", person.id)).toContain("岗位资质");
    rule.qualifiedStaffIds = [person.id];
    expect(canAssignStaff(state, "target", person.id)).toBeNull();
    state.settings.adminSupportEnabled = false;
    expect(canAssignStaff(state, "target", person.id)).toContain("尚未启用");
  });

  it("allows administrative support only after no qualified regular worker remains available", () => {
    const state = createDefaultState();
    state.settings.adminSupportEnabled = true;
    const regular = state.staff[0]!;
    const administrative = state.staff[1]!;
    administrative.staffType = "行政支援";
    state.staff = [regular, administrative];
    state.flights = [state.flights[0]!];
    const rule = state.positionRules.find((item) => item.flightNo === state.flights[0]!.flightNo && item.name === "G12")!;
    rule.qualifiedStaffIds = [regular.id, administrative.id];
    state.assignments = [{
      id: "target", flightId: state.flights[0]!.id, flightNo: state.flights[0]!.flightNo, positionRuleId: rule.id,
      position: rule.name, staffId: null, staffName: "", startTime: state.flights[0]!.startTime, endTime: state.flights[0]!.endTime,
      workHours: 2, fatiguePoints: rule.fatiguePoints, remark: "", manualRemark: "", status: "unfilled"
    }];
    expect(canAssignStaff(state, "target", administrative.id)).toContain("优先安排常规人员");
    regular.status = "休假";
    expect(canAssignStaff(state, "target", administrative.id)).toBeNull();
  });

  it("generates one assignment for every configured rule id without inventing positions", () => {
    const state = createDefaultState();
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: ["未配置岗位"], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "督导", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "p2", flightNo: "F1", name: "督导", qualifiedStaffIds: [state.staff[1]!.id] }
    ];
    const assignments = generateSchedule(state, "2026-07-18").assignments;
    expect(assignments.map((item) => item.positionRuleId)).toEqual(["p1", "p2"]);
    expect(assignments.map((item) => item.position)).toEqual(["督导", "督导"]);
  });

  it("replaces a same-name regular position in administrative support mode", () => {
    const state = createDefaultState();
    state.flights = [{ id: "f1", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "regular-supervisor", flightNo: "F1", name: "督导", category: "常规", qualifiedStaffIds: [state.staff[0]!.id] },
      { ...base, id: "regular-counter", flightNo: "F1", name: "G14", category: "常规", qualifiedStaffIds: [state.staff[1]!.id] },
      { ...base, id: "admin-supervisor", flightNo: "F1", name: "督导", category: "行政支援", qualifiedStaffIds: [] }
    ];
    expect(generateSchedule(state, "2026-07-18").assignments.map((item) => item.positionRuleId)).toEqual(["regular-supervisor", "regular-counter"]);
    state.settings.adminSupportEnabled = true;
    expect(generateSchedule(state, "2026-07-18").assignments).toMatchObject([
      { positionRuleId: "admin-supervisor", status: "manual", staffId: null },
      { positionRuleId: "regular-counter", status: "assigned" }
    ]);
  });

  it("reserves versatile staff for a later overlapping position with fewer qualified workers", () => {
    const state = createDefaultState();
    state.staff = state.staff.filter((person) => ["2", "3"].includes(person.id));
    state.flights = [
      { id: "flex-flight", flightNo: "FLEX", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "rare-flight", flightNo: "RARE", startTime: "09:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "flex", flightNo: "FLEX", name: "普通柜台", qualifiedStaffIds: ["2", "3"] },
      { ...base, id: "rare", flightNo: "RARE", name: "限制柜台", qualifiedStaffIds: ["2"] }
    ];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.positionRuleId === "flex")?.staffId).toBe("3");
    expect(result.assignments.find((item) => item.positionRuleId === "rare")?.staffId).toBe("2");
    expect(result.unfilledCount).toBe(0);
  });

  it("globally schedules each pre-noon position by scarcity before softer transition preferences", () => {
    const state = createDefaultState();
    const [rareWorker, flexibleWorker] = state.staff;
    state.staff = [rareWorker!, flexibleWorker!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "base-flight", flightNo: "BASE", startTime: "06:00", endTime: "07:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "flex-flight", flightNo: "FLEX", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "rare-flight", flightNo: "RARE", startTime: "09:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = { ...state.positionRules[0]!, category: "常规" as const };
    state.positionRules = [
      { ...base, id: "base", flightNo: "BASE", name: "P0", qualifiedStaffIds: [flexibleWorker!.id] },
      { ...base, id: "flex", flightNo: "FLEX", name: "普通柜台", qualifiedStaffIds: [rareWorker!.id, flexibleWorker!.id] },
      { ...base, id: "rare", flightNo: "RARE", name: "限制柜台", qualifiedStaffIds: [rareWorker!.id] }
    ];
    state.settings.positionTransitionPolicies = [{
      id: "prefer-flexible-worker-away",
      name: "普通柜台优先避开",
      enabled: true,
      sourceFlightNo: "BASE",
      sourcePositions: ["P0"],
      targetFlightNo: "FLEX",
      targetPosition: "普通柜台",
      minimumGapMinutes: 180,
      mode: "prefer"
    }];

    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.positionRuleId === "rare")?.staffId).toBe(rareWorker!.id);
    expect(result.assignments.find((item) => item.positionRuleId === "flex")?.staffId).toBe(flexibleWorker!.id);
    expect(result.unfilledCount).toBe(0);
  });

  it("fills guide rules from the bottom-most distinct regular positions", () => {
    const state = createDefaultState();
    const [topWorker, bottomWorker, diversionWorker] = state.staff;
    state.staff = [topWorker!, bottomWorker!, diversionWorker!];
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "regular-top", flightNo: "F1", name: "G03", category: "常规", qualifiedStaffIds: [topWorker!.id] },
      { ...base, id: "regular-bottom", flightNo: "F1", name: "G02", category: "常规", qualifiedStaffIds: [bottomWorker!.id] },
      { ...base, id: "diversion-lowest", flightNo: "F1", name: "G01", category: "分流", qualifiedStaffIds: [diversionWorker!.id] },
      { ...base, id: "guide-one", flightNo: "F1", name: "柜台引导1", category: "引导", qualifiedStaffIds: [] },
      { ...base, id: "guide-two", flightNo: "F1", name: "柜台引导2", category: "引导", qualifiedStaffIds: [] }
    ];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.positionRuleId === "guide-one")?.staffId).toBe(bottomWorker!.id);
    expect(result.assignments.find((item) => item.positionRuleId === "guide-two")?.staffId).toBe(topWorker!.id);
    expect(result.assignments.filter((item) => item.positionRuleId?.startsWith("guide-")).every((item) => item.workHours === 0 && item.fatiguePoints === 0)).toBe(true);
  });

  it("keeps the configured supervisor at the top without generating a fill position", () => {
    const state = createDefaultState();
    const [supervisor, counterWorker] = state.staff;
    state.staff = [supervisor!, counterWorker!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "supervisor", flightNo: "F1", name: "督导", category: "机动督导", qualifiedStaffIds: [supervisor!.id] },
      { ...base, id: "counter", flightNo: "F1", name: "G12", category: "常规", qualifiedStaffIds: [counterWorker!.id] }
    ];

    const result = generateSchedule(state, "2026-07-18");
    const supervisorAssignment = result.assignments.find((item) => item.positionRuleId === "supervisor")!;
    const counterAssignment = result.assignments.find((item) => item.positionRuleId === "counter")!;
    expect(activeFlightPositions(state, state.flights[0]!)).toEqual(["督导", "G12"]);
    expect(supervisorAssignment).toMatchObject({ staffId: supervisor!.id, status: "assigned" });
    state.assignments = result.assignments;
    expect(counterAssignment).toMatchObject({ staffId: counterWorker!.id, status: "assigned" });
  });

  it("does not change regular supervisor selection when a worker is marked as team leader", () => {
    const scheduleSupervisor = (teamLeaderId?: string) => {
      const state = createDefaultState();
      state.staff = state.staff.slice(0, 2);
      state.staff.forEach((person) => {
        person.teamLeader = person.id === teamLeaderId;
        person.dutyQualified = false;
      });
      state.flights = [
        { id: "flight", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" },
        { id: "later", flightNo: "F2", startTime: "16:00", endTime: "18:00", bookedPassengers: 100, positions: [], remark: "" }
      ];
      const base = state.positionRules[0]!;
      state.positionRules = [{
        ...base,
        id: "supervisor",
        flightNo: "F1",
        name: "督导",
        category: "常规",
        qualifiedStaffIds: state.staff.map((person) => person.id)
      }, {
        ...base,
        id: "later-counter",
        flightNo: "F2",
        name: "G01",
        category: "常规",
        qualifiedStaffIds: state.staff.map((person) => person.id)
      }];
      return generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "supervisor")!.staffId;
    };

    const baselineStaffId = scheduleSupervisor();
    expect(scheduleSupervisor(baselineStaffId!)).toBe(baselineStaffId);
  });

  it("assigns a marked team leader to a supervisor position when that worker is the only qualified candidate", () => {
    const state = createDefaultState();
    const teamLeader = state.staff[0]!;
    state.staff = [teamLeader];
    teamLeader.teamLeader = true;
    teamLeader.dutyQualified = false;
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "supervisor", flightNo: "F1", name: "督导", category: "常规", qualifiedStaffIds: [teamLeader.id] }];

    const result = generateSchedule(state, "2026-07-18");

    expect(result.assignments[0]).toMatchObject({ staffId: teamLeader.id, status: "assigned" });
  });

  it("does not deprioritize a team leader for an ordinary counter", () => {
    const state = createDefaultState();
    const [teamLeader, regular] = state.staff;
    state.staff = [teamLeader!, regular!];
    teamLeader!.teamLeader = true;
    regular!.teamLeader = false;
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "counter", flightNo: "F1", name: "G01", category: "常规", qualifiedStaffIds: [teamLeader!.id, regular!.id] }];

    const result = generateSchedule(state, "2026-07-18");

    expect(result.assignments[0]).toMatchObject({ staffId: teamLeader!.id, status: "assigned" });
  });

  it("automatically shows a KE166 regular worker in the supervisor cell without duplicating work hours", () => {
    const state = createDefaultState();
    const supervisor = state.staff[0]!;
    state.staff = [supervisor];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "ke166", flightNo: "KE166", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "ke166-supervisor", flightNo: "KE166", name: "督导", category: "机动督导", qualifiedStaffIds: [supervisor.id], fatiguePoints: 5 },
      { ...base, id: "ke166-counter", flightNo: "KE166", name: "H04", category: "常规", qualifiedStaffIds: [supervisor.id], fatiguePoints: 7 }
    ];

    const result = generateSchedule(state, "2026-07-18");
    const supervisorAssignment = result.assignments.find((item) => item.positionRuleId === "ke166-supervisor")!;
    const counterAssignment = result.assignments.find((item) => item.positionRuleId === "ke166-counter")!;

    expect(supervisorAssignment).toMatchObject({ staffId: supervisor.id, status: "assigned", workHours: 2, fatiguePoints: 5 });
    expect(counterAssignment).toMatchObject({
      staffId: supervisor.id,
      status: "assigned",
      workHours: 0,
      fatiguePoints: 7,
      supervisorSourceAssignmentId: supervisorAssignment.id
    });
    expect(result.assignments.reduce((sum, item) => sum + item.workHours, 0)).toBe(2);
    expect(result.assignments.reduce((sum, item) => sum + item.fatiguePoints, 0)).toBe(12);
  });

  it("does not change KE166 mobile supervisor reuse when a worker is marked as team leader", () => {
    const scheduleSupervisor = (teamLeaderId?: string) => {
      const state = createDefaultState();
      state.staff = state.staff.slice(0, 2);
      state.staff.forEach((person) => {
        person.teamLeader = person.id === teamLeaderId;
        person.dutyQualified = false;
      });
      state.flights = [{ id: "ke166", flightNo: "KE166", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }];
      const base = state.positionRules[0]!;
      const qualifiedStaffIds = state.staff.map((person) => person.id);
      state.positionRules = [
        { ...base, id: "supervisor", flightNo: "KE166", name: "督导", category: "机动督导", qualifiedStaffIds, fatiguePoints: 5 },
        { ...base, id: "counter", flightNo: "KE166", name: "H06", category: "常规", remark: "", qualifiedStaffIds, fatiguePoints: 2 },
        { ...base, id: "first-worker-counter", flightNo: "KE166", name: "H07", category: "常规", remark: "", qualifiedStaffIds: [state.staff[0]!.id], fatiguePoints: 2 }
      ];
      return generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "supervisor")!.staffId;
    };

    const baselineStaffId = scheduleSupervisor();
    expect(scheduleSupervisor(baselineStaffId!)).toBe(baselineStaffId);
  });

  it("keeps the KE166 mobile supervisor away from forbidden remarked positions", () => {
    const state = createDefaultState();
    const [supervisor, worker] = state.staff;
    state.staff = [supervisor!, worker!];
    state.flights = [{ id: "ke166", flightNo: "KE166", startTime: "09:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "supervisor", flightNo: "KE166", name: "督导", category: "机动督导", qualifiedStaffIds: [supervisor!.id], fatiguePoints: 5 },
      { ...base, id: "h02", flightNo: "KE166", name: "H02", category: "常规", remark: "一号", qualifiedStaffIds: [supervisor!.id, worker!.id], fatiguePoints: 7 },
      { ...base, id: "h06", flightNo: "KE166", name: "H06", category: "常规", remark: "", qualifiedStaffIds: [supervisor!.id, worker!.id], fatiguePoints: 2 }
    ];

    const assignments = generateSchedule(state, "2026-07-18").assignments;
    const top = assignments.find((item) => item.positionRuleId === "supervisor")!;
    expect(assignments.find((item) => item.positionRuleId === "h02")?.staffId).not.toBe(supervisor!.id);
    expect(assignments.find((item) => item.positionRuleId === "h06")).toMatchObject({
      staffId: supervisor!.id,
      workHours: 0,
      supervisorSourceAssignmentId: top.id
    });
  });

  it("keeps the KE166 supervisor in the top position when every regular target is forbidden", () => {
    const state = createDefaultState();
    const [supervisor, worker] = state.staff;
    state.staff = [supervisor!, worker!];
    state.flights = [{ id: "ke166", flightNo: "KE166", startTime: "09:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "supervisor", flightNo: "KE166", name: "督导", category: "机动督导", qualifiedStaffIds: [supervisor!.id], fatiguePoints: 5 },
      { ...base, id: "h02", flightNo: "KE166", name: "H02", category: "常规", remark: "一号", qualifiedStaffIds: [supervisor!.id, worker!.id], fatiguePoints: 7 }
    ];

    const assignments = generateSchedule(state, "2026-07-18").assignments;
    expect(assignments.find((item) => item.positionRuleId === "supervisor")).toMatchObject({ staffId: supervisor!.id, workHours: 2 });
    expect(assignments.find((item) => item.positionRuleId === "h02")).toMatchObject({ staffId: worker!.id, workHours: 2 });
  });

  it("moves unavoidable regular-position gaps toward the bottom of every flight", () => {
    const state = createDefaultState();
    const [first, second, third] = state.staff;
    state.staff = [first!, second!, third!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = { ...state.positionRules[0]!, category: "常规" as const };
    state.positionRules = [
      { ...base, id: "h05", flightNo: "F1", name: "H05", qualifiedStaffIds: [first!.id, second!.id, third!.id], fatiguePoints: 5 },
      { ...base, id: "h06", flightNo: "F1", name: "H06", qualifiedStaffIds: [first!.id, second!.id, third!.id], fatiguePoints: 4 },
      { ...base, id: "h07", flightNo: "F1", name: "H07", qualifiedStaffIds: [first!.id], fatiguePoints: 3 },
      { ...base, id: "h08", flightNo: "F1", name: "H08", qualifiedStaffIds: [second!.id], fatiguePoints: 2 },
      { ...base, id: "h09", flightNo: "F1", name: "H09", qualifiedStaffIds: [third!.id], fatiguePoints: 1 },
      { ...base, id: "guide", flightNo: "F1", name: "柜台引导", category: "引导", qualifiedStaffIds: [], fatiguePoints: 1 }
    ];

    const result = generateSchedule(state, "2026-07-18");
    const regular = result.assignments.filter((item) => item.positionRuleId?.startsWith("h"));
    const assignedPositions = regular.filter((item) => item.staffId).map((item) => item.position);
    const guide = result.assignments.find((item) => item.positionRuleId === "guide")!;

    expect(assignedPositions).toEqual(["H05", "H06", "H07"]);
    expect(regular.filter((item) => item.staffId)).toHaveLength(3);
    expect(regular.find((item) => item.position === "H07")).toMatchObject({ staffId: first!.id, fatiguePoints: 3 });
    expect(regular.find((item) => item.position === "H08")?.staffId).toBeNull();
    expect(regular.find((item) => item.position === "H09")?.staffId).toBeNull();
    expect(guide.staffId).toBe(first!.id);
    for (const assignment of regular.filter((item) => item.staffId)) {
      const rule = state.positionRules.find((item) => item.id === assignment.positionRuleId)!;
      expect(rule.qualifiedStaffIds).toContain(assignment.staffId);
    }
  });

  it("does not move an unqualified worker upward merely to hide a gap", () => {
    const state = createDefaultState();
    const [first, second] = state.staff;
    state.staff = [first!, second!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = { ...state.positionRules[0]!, category: "常规" as const };
    state.positionRules = [
      { ...base, id: "h05", flightNo: "F1", name: "H05", qualifiedStaffIds: [], fatiguePoints: 5 },
      { ...base, id: "h06", flightNo: "F1", name: "H06", qualifiedStaffIds: [first!.id, second!.id], fatiguePoints: 4 },
      { ...base, id: "h07", flightNo: "F1", name: "H07", qualifiedStaffIds: [first!.id], fatiguePoints: 3 },
      { ...base, id: "h08", flightNo: "F1", name: "H08", qualifiedStaffIds: [second!.id], fatiguePoints: 2 }
    ];

    const result = generateSchedule(state, "2026-07-18");
    const regular = result.assignments.filter((item) => item.positionRuleId?.startsWith("h"));

    expect(regular.filter((item) => item.staffId).map((item) => item.position)).toEqual(["H06", "H07"]);
    expect(regular.find((item) => item.position === "H05")?.staffId).toBeNull();
    expect(regular.find((item) => item.position === "H08")?.staffId).toBeNull();
    for (const assignment of regular.filter((item) => item.staffId)) {
      const rule = state.positionRules.find((item) => item.id === assignment.positionRuleId)!;
      expect(rule.qualifiedStaffIds).toContain(assignment.staffId);
    }
  });

  it("keeps the KE166 supervisor link when a qualified worker is moved upward", () => {
    const state = createDefaultState();
    const [supervisor, worker] = state.staff;
    state.staff = [supervisor!, worker!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "ke166", flightNo: "KE166", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "supervisor", flightNo: "KE166", name: "督导", category: "机动督导", qualifiedStaffIds: [supervisor!.id], fatiguePoints: 5 },
      { ...base, id: "h05", flightNo: "KE166", name: "H05", category: "常规", qualifiedStaffIds: [supervisor!.id, worker!.id], fatiguePoints: 7 },
      { ...base, id: "h06", flightNo: "KE166", name: "H06", category: "常规", qualifiedStaffIds: [supervisor!.id], fatiguePoints: 6 },
      { ...base, id: "h07", flightNo: "KE166", name: "H07", category: "常规", qualifiedStaffIds: [worker!.id], fatiguePoints: 2 }
    ];

    const result = generateSchedule(state, "2026-07-18");
    const supervisorAssignment = result.assignments.find((item) => item.positionRuleId === "supervisor")!;
    const h05 = result.assignments.find((item) => item.positionRuleId === "h05")!;
    const h06 = result.assignments.find((item) => item.positionRuleId === "h06")!;
    const h07 = result.assignments.find((item) => item.positionRuleId === "h07")!;

    expect(supervisorAssignment).toMatchObject({ staffId: supervisor!.id, workHours: 2, fatiguePoints: 5 });
    expect(h05).toMatchObject({ staffId: worker!.id, workHours: 2, fatiguePoints: 7 });
    expect(h06).toMatchObject({
      staffId: supervisor!.id,
      workHours: 0,
      fatiguePoints: 6,
      supervisorSourceAssignmentId: supervisorAssignment.id
    });
    expect(h07.staffId).toBeNull();
    expect(result.assignments.filter((item) => item.status === "assigned").reduce((sum, item) => sum + item.workHours, 0)).toBe(4);
  });

  it("does not let the duty-morning priority take KE166's only mobile supervisor away", () => {
    const state = createDefaultState();
    const [mobileSupervisor, dutyWorker, cxWorker] = state.staff;
    state.staff = [mobileSupervisor!, dutyWorker!, cxWorker!];
    const date = "2026-07-18";
    state.dutyRosterOverrides = [{
      date,
      cxPreflightStaffId: null,
      dutyStaffId: dutyWorker!.id,
      standbyStaffIds: [null, null]
    }];
    state.flights = [
      { id: "cx", flightNo: "CX937", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "ke", flightNo: "KE166", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "cx-counter", flightNo: "CX937", name: "G12", category: "常规", qualifiedStaffIds: [mobileSupervisor!.id, cxWorker!.id], fatiguePoints: 2 },
      { ...base, id: "ke-supervisor", flightNo: "KE166", name: "督导", category: "机动督导", qualifiedStaffIds: [mobileSupervisor!.id], fatiguePoints: 5 },
      { ...base, id: "ke-counter", flightNo: "KE166", name: "H04", category: "常规", qualifiedStaffIds: [mobileSupervisor!.id, dutyWorker!.id], fatiguePoints: 7 }
    ];

    const result = generateSchedule(state, date);
    const supervisor = result.assignments.find((item) => item.positionRuleId === "ke-supervisor")!;
    const keCounter = result.assignments.find((item) => item.positionRuleId === "ke-counter")!;
    const cxCounter = result.assignments.find((item) => item.positionRuleId === "cx-counter")!;

    expect(supervisor).toMatchObject({ staffId: mobileSupervisor!.id, workHours: 2, fatiguePoints: 5 });
    expect(keCounter).toMatchObject({
      staffId: mobileSupervisor!.id,
      workHours: 0,
      fatiguePoints: 7,
      supervisorSourceAssignmentId: supervisor.id
    });
    expect(cxCounter).toMatchObject({ staffId: cxWorker!.id, status: "assigned" });
  });

  it("keeps KE166 supervisor synced when administrative support mode only replaces other counters", () => {
    const state = createDefaultState();
    const supervisor = state.staff[0]!;
    const backup = state.staff[1]!;
    state.staff = [supervisor, backup];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.settings.adminSupportEnabled = true;
    state.flights = [{ id: "ke166", flightNo: "KE166", startTime: "08:30", endTime: "10:30", bookedPassengers: 200, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "ke166-supervisor", flightNo: "KE166", name: "督导", category: "机动督导", qualifiedStaffIds: [supervisor.id], fatiguePoints: 4 },
      { ...base, id: "ke166-h04", flightNo: "KE166", name: "H04", category: "常规", qualifiedStaffIds: [supervisor.id], fatiguePoints: 2 },
      { ...base, id: "ke166-h08-regular", flightNo: "KE166", name: "H08", category: "常规", qualifiedStaffIds: [backup.id], fatiguePoints: 2, minPassengers: 170 },
      { ...base, id: "ke166-h08-admin", flightNo: "KE166", name: "H08", category: "行政支援", qualifiedStaffIds: [], fatiguePoints: 2, minPassengers: 170 },
      { ...base, id: "ke166-h09-regular", flightNo: "KE166", name: "H09", category: "常规", qualifiedStaffIds: [backup.id], fatiguePoints: 2, minPassengers: 200 },
      { ...base, id: "ke166-h09-admin", flightNo: "KE166", name: "H09", category: "行政支援", qualifiedStaffIds: [], fatiguePoints: 2, minPassengers: 200 }
    ];

    const result = generateSchedule(state, "2026-07-18");
    const supervisorAssignment = result.assignments.find((item) => item.positionRuleId === "ke166-supervisor")!;
    const counterAssignment = result.assignments.find((item) => item.positionRuleId === "ke166-h04")!;

    expect(activeFlightPositions(state, state.flights[0]!)).toEqual(["督导", "H04", "H08", "H09"]);
    expect(supervisorAssignment).toMatchObject({ staffId: supervisor.id, status: "assigned", workHours: 2, fatiguePoints: 4 });
    expect(counterAssignment).toMatchObject({
      staffId: supervisor.id,
      status: "assigned",
      workHours: 0,
      fatiguePoints: 2,
      supervisorSourceAssignmentId: supervisorAssignment.id
    });
  });

  it("reserves a KE166 regular position for a supervisor-qualified worker in administrative support mode", () => {
    const state = createDefaultState();
    const supervisor = state.staff[0]!;
    const regular = state.staff[1]!;
    state.staff = [supervisor, regular];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.settings.adminSupportEnabled = true;
    state.flights = [
      { id: "other", flightNo: "OTHER", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "ke166", flightNo: "KE166", startTime: "08:30", endTime: "10:30", bookedPassengers: 200, positions: [], remark: "" }
    ];
    state.history = [{
      id: "regular-heavy-history",
      date: "2026-07-17",
      flightNo: "HISTORY",
      position: "P1",
      staffId: regular.id,
      staffName: regular.name,
      startTime: "08:00",
      endTime: "20:00",
      workHours: 12,
      fatiguePoints: 8,
      remark: ""
    }];
    const base = state.positionRules[0]!;
    const bothStaffIds = [supervisor.id, regular.id];
    state.positionRules = [
      { ...base, id: "other-counter", flightNo: "OTHER", name: "G01", category: "常规", qualifiedStaffIds: bothStaffIds, fatiguePoints: 1 },
      { ...base, id: "ke166-supervisor", flightNo: "KE166", name: "督导", category: "机动督导", qualifiedStaffIds: [supervisor.id], fatiguePoints: 4 },
      { ...base, id: "ke166-h04", flightNo: "KE166", name: "H04", category: "常规", qualifiedStaffIds: bothStaffIds, fatiguePoints: 2 },
      { ...base, id: "ke166-h08-regular", flightNo: "KE166", name: "H08", category: "常规", qualifiedStaffIds: bothStaffIds, fatiguePoints: 2, minPassengers: 170 },
      { ...base, id: "ke166-h08-admin", flightNo: "KE166", name: "H08", category: "行政支援", qualifiedStaffIds: [], fatiguePoints: 2, minPassengers: 170 }
    ];

    const result = generateSchedule(state, "2026-07-18");
    const supervisorAssignment = result.assignments.find((item) => item.positionRuleId === "ke166-supervisor")!;
    const ke166Regular = result.assignments.find((item) => item.positionRuleId === "ke166-h04")!;
    const otherRegular = result.assignments.find((item) => item.positionRuleId === "other-counter")!;

    expect(supervisorAssignment).toMatchObject({ staffId: supervisor.id, status: "assigned", fatiguePoints: 4 });
    expect(ke166Regular).toMatchObject({ staffId: supervisor.id, workHours: 0, supervisorSourceAssignmentId: supervisorAssignment.id });
    expect(otherRegular).toMatchObject({ staffId: regular.id, status: "assigned", workHours: 2 });
  });

  it("does not copy one flight's configured guide positions into every other flight", () => {
    const state = createDefaultState();
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.find((item) => item.flightNo === "CX937" && item.position === "柜台引导1")?.staffId).toEqual(expect.any(String));
    expect(result.assignments.find((item) => item.flightNo === "FD573" && item.position === "柜台引导1")).toBeUndefined();
    expect(result.assignments.find((item) => item.flightNo === "TR121" && item.position === "收费/引导")).toBeDefined();
  });

  it("generates only configured positions and never adds generic support to afternoon flights", () => {
    const state = createDefaultState();
    const flight = state.flights.find((item) => item.flightNo === "FD573")!;
    flight.positions.push("未配置岗位");
    state.flights = [flight];
    state.staff.forEach((person) => { person.status = "休假"; });
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.some((item) => item.position === "未配置岗位")).toBe(false);
    expect(result.assignments.some((item) => item.position === "临时支援")).toBe(false);
    expect(result.assignments.filter((item) => !item.positionRuleId).every((item) => ["柜台引导1", "柜台引导2", "超规柜台", "超规行李引导"].includes(item.position))).toBe(true);
  });

  it("does not invent a generic support position for a short-staffed morning flight", () => {
    const state = createDefaultState();
    const flight = state.flights.find((item) => item.flightNo === "FD573")!;
    flight.startTime = "08:00";
    flight.endTime = "10:00";
    state.flights = [flight];
    state.staff.forEach((person) => { person.status = "休假"; });
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.filter((item) => item.position === "临时支援")).toHaveLength(0);
  });

  it("allows a guide to reuse its selected same-flight regular worker", () => {
    const state = createDefaultState();
    state.flights = [state.flights[0]!];
    const result = generateSchedule(state, "2026-07-18");
    const guide = result.assignments.find((item) => item.position === "柜台引导1")!;
    const source = result.assignments.find((item) => item.flightId === guide.flightId && item.staffId === guide.staffId && item.id !== guide.id)!;
    expect(guide.workHours).toBe(0);
    expect(state.positionRules.find((item) => item.id === source.positionRuleId)?.category).toBe("常规");
    state.assignments = result.assignments;
    guide.staffId = null;
    guide.staffName = "";
    guide.status = "unfilled";
    expect(canAssignStaff(state, guide.id, source.staffId!, source.id)).toBeNull();
  });

  it("hides 一号 while preserving the rest of a configured position remark", () => {
    expect(visiblePositionRemark("一号申报")).toBe("申报");
    expect(visiblePositionRemark("一号")).toBe("");
  });

  it("prioritizes regular workers who do not yet have working hours", () => {
    const state = createDefaultState();
    const workers = state.staff.slice(0, 3);
    state.staff = workers;
    state.flights = [
      { id: "f1", flightNo: "F1", startTime: "08:00", endTime: "09:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "f2", flightNo: "F2", startTime: "09:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "f3", flightNo: "F3", startTime: "10:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = state.flights.map((flight, index) => ({
      ...base, id: `p${index + 1}`, flightNo: flight.flightNo, name: `P${index + 1}`, category: "常规",
      fatiguePoints: 0, remark: "", qualifiedStaffIds: workers.map((person) => person.id)
    }));
    const assignments = generateSchedule(state, "2026-07-18").assignments;
    expect(new Set(assignments.map((item) => item.staffId))).toEqual(new Set(workers.map((person) => person.id)));
  });

  it("gives every available regular worker actual hours in the configured default schedule", () => {
    const state = createDefaultState();
    const assignments = generateSchedule(state, "2026-07-18").assignments;
    const workedIds = new Set(assignments.filter((item) => item.workHours > 0).map((item) => item.staffId));
    const requiredIds = state.staff
      .filter((person) => person.staffType === "常规" && person.status === "正常")
      .map((person) => person.id);
    expect(requiredIds.filter((staffId) => !workedIds.has(staffId))).toEqual([]);
  });

  it("reserves the duty-qualified person for the first counter on the latest flight", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    state.flights = [
      { id: "early", flightNo: "EARLY", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "late", flightNo: "LATE", startTime: "21:00", endTime: "23:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    const qualifiedStaffIds = state.staff.map((person) => person.id);
    state.positionRules = [
      { ...base, id: "early-position", flightNo: "EARLY", name: "普通柜台", remark: "", fatiguePoints: 1, qualifiedStaffIds },
      { ...base, id: "late-supervisor", flightNo: "LATE", name: "督导", remark: "", fatiguePoints: 4, qualifiedStaffIds },
      { ...base, id: "late-first", flightNo: "LATE", name: "H02", remark: "一号", fatiguePoints: 5, qualifiedStaffIds }
    ];
    const dutyStaffId = getDutyRosterForDate(state, "2026-07-20").dutyStaffId;
    const assignments = generateSchedule(state, "2026-07-20").assignments;
    expect(assignments.find((item) => item.positionRuleId === "late-first")?.staffId).toBe(dutyStaffId);
  });

  it("keeps the duty person off earlier high-load work so they cover the latest noted position", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    const dutyStaffId = getDutyRosterForDate(state, "2026-07-20").dutyStaffId!;
    const other = state.staff.find((person) => person.id !== dutyStaffId)!;
    state.flights = [
      { id: "early", flightNo: "EARLY", startTime: "17:00", endTime: "19:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "late", flightNo: "LATE", startTime: "21:00", endTime: "23:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "early-control", flightNo: "EARLY", name: "G18", remark: "控制", fatiguePoints: 5, qualifiedStaffIds: [dutyStaffId, other.id] },
      { ...base, id: "late-first", flightNo: "LATE", name: "H02", remark: "一号", fatiguePoints: 5, qualifiedStaffIds: [dutyStaffId, other.id] }
    ];
    state.history = [{
      id: "other-history", date: "2026-07-18", flightNo: "EARLY", position: "G18", staffId: other.id, staffName: other.name,
      startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 50, remark: ""
    }];

    const assignments = generateSchedule(state, "2026-07-20").assignments;
    expect(assignments.find((item) => item.positionRuleId === "early-control")?.staffId).toBe(other.id);
    expect(assignments.find((item) => item.positionRuleId === "late-first")?.staffId).toBe(dutyStaffId);
  });

  it("falls back to a noted position on the second-latest flight when the latest has no eligible target", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    const dutyStaffId = getDutyRosterForDate(state, "2026-07-20").dutyStaffId!;
    const other = state.staff.find((person) => person.id !== dutyStaffId)!;
    state.flights = [
      { id: "early", flightNo: "EARLY", startTime: "17:00", endTime: "19:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second-latest", flightNo: "SECOND", startTime: "20:00", endTime: "22:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "latest", flightNo: "LATEST", startTime: "22:30", endTime: "00:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "early-position", flightNo: "EARLY", name: "P1", remark: "", fatiguePoints: 1, qualifiedStaffIds: [dutyStaffId, other.id] },
      { ...base, id: "second-declare", flightNo: "SECOND", name: "G17", remark: "申报", fatiguePoints: 4, qualifiedStaffIds: [dutyStaffId, other.id] },
      { ...base, id: "latest-first", flightNo: "LATEST", name: "H02", remark: "一号", fatiguePoints: 5, qualifiedStaffIds: [other.id] }
    ];

    const assignments = generateSchedule(state, "2026-07-20").assignments;
    expect(assignments.find((item) => item.positionRuleId === "second-declare")?.staffId).toBe(dutyStaffId);
    expect(assignments.find((item) => item.positionRuleId === "latest-first")?.staffId).toBe(other.id);
  });

  it("assigns the duty person to both a flight by 08:30 and the protected late position", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    const dutyStaffId = getDutyRosterForDate(state, "2026-07-20").dutyStaffId!;
    const qualifiedStaffIds = state.staff.map((person) => person.id);
    state.flights = [
      { id: "morning", flightNo: "MORNING", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" },
      { id: "middle", flightNo: "MIDDLE", startTime: "15:00", endTime: "17:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "late", flightNo: "LATE", startTime: "21:00", endTime: "23:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "morning-position", flightNo: "MORNING", name: "G12", remark: "", fatiguePoints: 1, qualifiedStaffIds },
      { ...base, id: "middle-position", flightNo: "MIDDLE", name: "G13", remark: "", fatiguePoints: 1, qualifiedStaffIds },
      { ...base, id: "late-first", flightNo: "LATE", name: "H02", remark: "一号", fatiguePoints: 5, qualifiedStaffIds }
    ];

    const dutyAssignments = generateSchedule(state, "2026-07-20").assignments.filter((item) => item.staffId === dutyStaffId);
    expect(dutyAssignments.some((item) => item.flightNo === "MORNING")).toBe(true);
    expect(dutyAssignments.some((item) => item.positionRuleId === "late-first")).toBe(true);
    expect(dutyAssignments.some((item) => item.flightNo === "MIDDLE")).toBe(false);
  });

  it("keeps every feasible position filled even when fatigue balance cannot meet both targets", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 2);
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.settings.workloadBalanceEnabled = true;
    state.settings.maxWorkHoursDifference = 2;
    state.settings.maxTodayFatigueDifference = 4;
    state.flights = [
      { id: "long", flightNo: "LONG", startTime: "08:00", endTime: "14:00", bookedPassengers: 100, positions: [], remark: "" },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `short-${index}`, flightNo: `SHORT${index}`, startTime: `${14 + index}:00`, endTime: `${15 + index}:00`, bookedPassengers: 100, positions: [], remark: ""
      }))
    ];
    const base = state.positionRules[0]!;
    const qualifiedStaffIds = state.staff.map((person) => person.id);
    state.positionRules = state.flights.map((flight, index) => ({
      ...base, id: `balance-${index}`, flightNo: flight.flightNo, name: `P${index}`, category: "常规", remark: "",
      fatiguePoints: index === 0 ? 0 : 1, qualifiedStaffIds
    }));

    const assignments = generateSchedule(state, "2026-07-20").assignments;
    const loads = state.staff.map((person) => ({
      hours: assignments.filter((item) => item.staffId === person.id).reduce((sum, item) => sum + item.workHours, 0),
      fatigue: assignments.filter((item) => item.staffId === person.id).reduce((sum, item) => sum + item.fatiguePoints, 0)
    }));
    expect(assignments.every((item) => item.status === "assigned")).toBe(true);
    expect(Math.max(...loads.map((item) => item.hours)) - Math.min(...loads.map((item) => item.hours))).toBeLessThanOrEqual(2);
    expect(Math.max(...loads.map((item) => item.fatigue)) - Math.min(...loads.map((item) => item.fatigue))).toBe(5);
  });

  it("uses an archived day to rotate the lower-load worker into the next duty day", () => {
    const state = createDefaultState();
    state.settings.dutyFatiguePoints = 0;
    state.staff = state.staff.filter((person) => ["2", "3"].includes(person.id));
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [state.flights[0]!];
    state.flights[0]!.positions = ["G12"];
    state.positionRules = state.positionRules.filter((rule) => rule.flightNo === "CX937" && rule.name === "G12");
    const firstDay = generateSchedule(state, "2026-07-18").assignments[0]!;
    expect(firstDay.staffId).toBe("2");
    state.history = [{
      id: "archived", date: "2026-07-18", flightNo: firstDay.flightNo, position: firstDay.position,
      staffId: firstDay.staffId!, staffName: firstDay.staffName, startTime: firstDay.startTime, endTime: firstDay.endTime,
      workHours: firstDay.workHours, fatiguePoints: firstDay.fatiguePoints, remark: ""
    }];
    expect(generateSchedule(state, "2026-07-20").assignments[0]!.staffId).toBe("3");
  });

  it("allows an afternoon diversion position to release early for the next flight", () => {
    const state = createDefaultState();
    state.staff = [state.staff.find((person) => person.id === "2")!];
    state.flights = [
      { id: "f1", flightNo: "F1", startTime: "15:00", endTime: "17:00", bookedPassengers: 0, positions: ["P1"], remark: "" },
      { id: "f2", flightNo: "F2", startTime: "16:30", endTime: "18:30", bookedPassengers: 0, positions: ["P2"], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "P1", category: "分流", qualifiedStaffIds: ["2"], earlyReleaseMinutes: 60 },
      { ...base, id: "p2", flightNo: "F2", name: "P2", category: "常规", qualifiedStaffIds: ["2"], earlyReleaseMinutes: 0 }
    ];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.map((item) => item.staffId)).toEqual(["2", "2"]);
    expect(result.assignments[0]).toMatchObject({ endTime: "16:30", workHours: 1.5 });
  });

  it("does not apply diversion release to morning flights", () => {
    const state = createDefaultState();
    state.staff = [state.staff.find((person) => person.id === "2")!];
    state.flights = [
      { id: "f1", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 0, positions: ["P1"], remark: "" },
      { id: "f2", flightNo: "F2", startTime: "09:30", endTime: "11:30", bookedPassengers: 0, positions: ["P2"], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "p1", flightNo: "F1", name: "P1", category: "分流", qualifiedStaffIds: ["2"], earlyReleaseMinutes: 60 },
      { ...base, id: "p2", flightNo: "F2", name: "P2", category: "常规", qualifiedStaffIds: ["2"], earlyReleaseMinutes: 0 }
    ];
    const result = generateSchedule(state, "2026-07-18");
    expect(result.assignments.filter((item) => item.positionRuleId).map((item) => item.staffId)).toEqual([null, "2"]);
    expect(result.assignments.find((item) => item.position === "临时支援")).toBeUndefined();
    expect(result.assignments[0]!.endTime).toBe("10:00");
  });

  it("auto-fills every regular position before noon even below its passenger threshold or marked manual", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    person.dutyQualified = false;
    state.staff = [person];
    state.flights = [{ id: "morning", flightNo: "MORNING", startTime: "11:59", endTime: "13:00", bookedPassengers: 0, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{
      ...base,
      id: "morning-manual-threshold",
      flightNo: "MORNING",
      name: "G01",
      category: "常规",
      manual: true,
      minPassengers: 300,
      qualifiedStaffIds: [person.id]
    }];

    expect(generateSchedule(state, "2026-07-18").assignments[0]).toMatchObject({
      positionRuleId: "morning-manual-threshold",
      status: "assigned",
      staffId: person.id
    });
  });

  it("keeps the passenger threshold and manual behavior for flights starting at noon", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    person.dutyQualified = false;
    state.staff = [person];
    state.flights = [{ id: "noon", flightNo: "NOON", startTime: "12:00", endTime: "14:00", bookedPassengers: 0, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{
      ...base,
      id: "noon-manual-threshold",
      flightNo: "NOON",
      name: "G01",
      category: "常规",
      manual: true,
      minPassengers: 300,
      qualifiedStaffIds: [person.id]
    }];

    expect(generateSchedule(state, "2026-07-18").assignments[0]).toMatchObject({
      positionRuleId: "noon-manual-threshold",
      status: "manual",
      staffId: null
    });
  });

  it("breaks a strict transition rule before noon and records the override", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    person.dutyQualified = false;
    state.staff = [person];
    state.flights = [
      { id: "source", flightNo: "SOURCE", startTime: "06:00", endTime: "07:30", bookedPassengers: 100, positions: [], remark: "" },
      { id: "target", flightNo: "TARGET", startTime: "09:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "source-position", flightNo: "SOURCE", name: "G01", category: "常规", qualifiedStaffIds: [person.id] },
      { ...base, id: "target-position", flightNo: "TARGET", name: "H01", category: "常规", qualifiedStaffIds: [person.id] }
    ];
    state.settings.positionTransitionPolicies = [{
      id: "strict-morning-transition",
      name: "早间严格衔接",
      enabled: true,
      sourceFlightNo: "SOURCE",
      sourcePositions: ["G01"],
      targetFlightNo: "TARGET",
      targetPosition: "H01",
      minimumGapMinutes: 180,
      mode: "forbid"
    }];

    const target = generateSchedule(state, "2026-07-18").assignments.find((item) => item.positionRuleId === "target-position")!;
    expect(target).toMatchObject({ status: "assigned", staffId: person.id });
    expect(target.systemNotes).toContain("已突破严格限制仍安排：早间严格衔接");
  });

  it("reallocates an overlapping worker between pre-noon flights and marks the source vacancy", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    person.dutyQualified = false;
    state.staff = [person];
    state.flights = [
      { id: "source", flightNo: "SOURCE", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "target", flightNo: "TARGET", startTime: "09:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "source-position", flightNo: "SOURCE", name: "G01", category: "常规", qualifiedStaffIds: [person.id] },
      { ...base, id: "target-position", flightNo: "TARGET", name: "H01", category: "常规", qualifiedStaffIds: [person.id] }
    ];

    const result = generateSchedule(state, "2026-07-18");
    const source = result.assignments.find((item) => item.positionRuleId === "source-position")!;
    const target = result.assignments.find((item) => item.positionRuleId === "target-position")!;
    expect(target).toMatchObject({ status: "assigned", staffId: person.id });
    expect(source).toMatchObject({ status: "unfilled", staffId: null });
    expect(source.systemNotes).toContain("因抽调至 TARGET/H01 而空缺");
  });

  it("records a concrete staffing-shortage reason for an unfilled regular position before noon", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    person.dutyQualified = false;
    state.staff = [person];
    state.flights = [{ id: "morning", flightNo: "MORNING", startTime: "09:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "first", flightNo: "MORNING", name: "G01", category: "常规", qualifiedStaffIds: [person.id] },
      { ...base, id: "second", flightNo: "MORNING", name: "G02", category: "常规", qualifiedStaffIds: [person.id] }
    ];

    const unfilled = generateSchedule(state, "2026-07-18").assignments.find((item) => item.status === "unfilled")!;
    expect(unfilled.systemNotes?.join("；")).toContain("因合格人数不足而无法填满");
    expect(unfilled.systemNotes?.join("；")).toContain("时段冲突");
  });

  it("assigns the duty worker by the editable flight and position priority order", () => {
    const state = createDefaultState();
    const [duty, other] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [duty!, other!];
    state.flights = [
      { id: "tw", flightNo: "TW616", startTime: "19:00", endTime: "21:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "tr", flightNo: "TR121", startTime: "21:30", endTime: "23:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "tw-one", flightNo: "TW616", name: "G01", remark: "一号", category: "常规", qualifiedStaffIds: [duty!.id, other!.id] },
      { ...base, id: "tr-one", flightNo: "TR121", name: "H02", remark: "一号", category: "常规", qualifiedStaffIds: [duty!.id, other!.id] }
    ];
    state.dutyRosterOverrides = [{ date: "2026-07-18", cxPreflightStaffId: null, dutyStaffId: duty!.id, standbyStaffIds: [null, null] }];

    let assignments = generateSchedule(state, "2026-07-18").assignments;
    expect(assignments.find((item) => item.positionRuleId === "tr-one")?.staffId).toBe(duty!.id);

    state.settings.dutyPositionPriorities.reverse();
    assignments = generateSchedule(state, "2026-07-18").assignments;
    expect(assignments.find((item) => item.positionRuleId === "tw-one")?.staffId).toBe(duty!.id);
  });

  it("keeps the configured duty lock ahead of a strict transition preference", () => {
    const state = createDefaultState();
    const [duty, other, third] = state.staff.filter((person) => person.status === "正常").slice(0, 3);
    state.staff = [duty!, other!, third!];
    state.flights = [
      { id: "morning", flightNo: "MORNING", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "tw", flightNo: "TW616", startTime: "19:00", endTime: "21:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "tr", flightNo: "TR121", startTime: "21:30", endTime: "23:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    const qualifiedStaffIds = state.staff.map((person) => person.id);
    state.positionRules = [
      { ...base, id: "morning-source", flightNo: "MORNING", name: "G01", remark: "", category: "常规", qualifiedStaffIds },
      { ...base, id: "tw-one", flightNo: "TW616", name: "G01", remark: "一号", category: "常规", qualifiedStaffIds },
      { ...base, id: "tr-one", flightNo: "TR121", name: "H02", remark: "一号", category: "常规", qualifiedStaffIds }
    ];
    state.dutyRosterOverrides = [{ date: "2026-07-18", cxPreflightStaffId: null, dutyStaffId: duty!.id, standbyStaffIds: [other!.id, third!.id] }];
    state.settings.positionTransitionPolicies = [{
      id: "block-tr",
      name: "值班人员不能接TR",
      enabled: true,
      sourceFlightNo: "MORNING",
      sourcePositions: ["G01"],
      targetFlightNo: "TR121",
      targetPosition: "H02",
      minimumGapMinutes: 1440,
      mode: "forbid"
    }];

    const assignments = generateSchedule(state, "2026-07-18").assignments;
    expect(assignments.find((item) => item.positionRuleId === "morning-source")?.staffId).toBe(duty!.id);
    const target = assignments.find((item) => item.positionRuleId === "tr-one")!;
    expect(target.staffId).toBe(duty!.id);
    expect(target.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "duty-position", outcome: "selected" }),
      expect.objectContaining({ ruleId: "position-transition", outcome: "fallback" })
    ]));
    expect(assignments.find((item) => item.positionRuleId === "tw-one")?.staffId).not.toBe(duty!.id);
  });

  it("keeps the duty position lock ahead of same-position rotation", () => {
    const state = createDefaultState();
    const [duty, other] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [duty!, other!];
    state.flights = [{ id: "tr", flightNo: "TR121", startTime: "21:30", endTime: "23:30", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [{ ...base, id: "tr-h02", flightNo: "TR121", name: "H02", remark: "一号", category: "常规", qualifiedStaffIds: [duty!.id, other!.id] }];
    state.dutyRosterOverrides = [{ date: "2026-07-20", cxPreflightStaffId: null, dutyStaffId: duty!.id, standbyStaffIds: [null, null] }];
    state.history = [{
      id: "repeat", date: "2026-07-18", flightNo: "TR121", position: "H02", staffId: duty!.id, staffName: duty!.name,
      startTime: "21:30", endTime: "23:30", workHours: 2, fatiguePoints: 10, remark: "一号"
    }];
    expect(generateSchedule(state, "2026-07-20").assignments[0]).toMatchObject({ staffId: duty!.id, position: "H02" });
  });

  it("keeps KE166 ordinary positions available while selecting the lower-frequency priority-position worker", () => {
    const state = createDefaultState();
    const [alternate, frequent] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [alternate!, frequent!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "ke166", flightNo: "KE166", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "cx937", flightNo: "CX937", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "ke-g18", flightNo: "KE166", name: "G18", category: "常规", fatiguePoints: 1, qualifiedStaffIds: [alternate!.id, frequent!.id] },
      { ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", fatiguePoints: 1, remark: "一号", qualifiedStaffIds: [alternate!.id, frequent!.id] }
    ];
    state.settings.historyWindowDays = 1;
    state.history = ["2026-10-02", "2026-10-04", "2026-10-06", "2026-10-08"].map((date, index) => ({
      id: `frequent-g20-${index}`, date, flightNo: "CX937", position: "G20", staffId: frequent!.id, staffName: frequent!.name,
      startTime: "08:30", endTime: "10:30", workHours: 2, fatiguePoints: 1, remark: ""
    })).concat([
      { id: "other-1", date: "2026-10-10", flightNo: "MU100", position: "G18", staffId: alternate!.id, staffName: alternate!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: "" },
      { id: "other-2", date: "2026-10-12", flightNo: "MU200", position: "G18", staffId: alternate!.id, staffName: alternate!.name, startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: "" }
    ]);

    const assignments = generateSchedule(state, "2026-10-14").assignments;
    expect(assignments.find((item) => item.positionRuleId === "cx-g20")?.staffId).toBe(alternate!.id);
    expect(assignments.find((item) => item.positionRuleId === "ke-g18")?.staffId).toBe(frequent!.id);
    expect(assignments.find((item) => item.positionRuleId === "cx-g20")?.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "position-frequency", outcome: "selected" })
    ]));
    state.assignments = assignments;
    expect(buildScheduleFeedback(state, "2026-10-14").find((item) => item.key === "position-frequency-review")).toMatchObject({
      status: "已执行"
    });
  });

  it("continues to every overlapping flight when KE166 cannot form a safe high-frequency exchange", () => {
    const state = createDefaultState();
    const [keWorker, alternate, frequent] = state.staff.filter((person) => person.status === "正常").slice(0, 3);
    state.staff = [keWorker!, alternate!, frequent!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "ke166", flightNo: "KE166", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "mu100", flightNo: "MU100", startTime: "08:10", endTime: "10:10", bookedPassengers: 100, positions: [], remark: "" },
      { id: "cx937", flightNo: "CX937", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "ke-g18", flightNo: "KE166", name: "G18", category: "常规", fatiguePoints: 1, qualifiedStaffIds: [keWorker!.id] },
      { ...base, id: "mu-h02", flightNo: "MU100", name: "H02", category: "常规", fatiguePoints: 1, qualifiedStaffIds: [alternate!.id, frequent!.id] },
      { ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", fatiguePoints: 1, remark: "一号", qualifiedStaffIds: [keWorker!.id, alternate!.id, frequent!.id] }
    ];
    state.settings.historyWindowDays = 1;
    state.history = ["2026-10-02", "2026-10-04", "2026-10-06", "2026-10-08"].map((date, index) => ({
      id: `frequent-g20-${index}`, date, flightNo: "CX937", position: "G20", staffId: frequent!.id, staffName: frequent!.name,
      startTime: "08:30", endTime: "10:30", workHours: 2, fatiguePoints: 1, remark: ""
    })).concat([
      { id: "other-1", date: "2026-10-10", flightNo: "MU100", position: "H02", staffId: alternate!.id, staffName: alternate!.name, startTime: "08:10", endTime: "10:10", workHours: 2, fatiguePoints: 1, remark: "" },
      { id: "other-2", date: "2026-10-12", flightNo: "MU200", position: "H02", staffId: alternate!.id, staffName: alternate!.name, startTime: "08:10", endTime: "10:10", workHours: 2, fatiguePoints: 1, remark: "" }
    ]);

    const assignments = generateSchedule(state, "2026-10-14").assignments;
    expect(assignments.find((item) => item.positionRuleId === "ke-g18")?.staffId).toBe(keWorker!.id);
    expect(assignments.find((item) => item.positionRuleId === "mu-h02")?.staffId).toBe(frequent!.id);
    expect(assignments.find((item) => item.positionRuleId === "cx-g20")?.staffId).toBe(alternate!.id);
  });

  it("uses priority-position frequency before a repeated priority position needs post-schedule rotation", () => {
    const state = createDefaultState();
    const [alternate, repeated] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [alternate!, repeated!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "g18", flightNo: "MU100", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "g16", flightNo: "MU200", startTime: "08:15", endTime: "10:15", bookedPassengers: 100, positions: [], remark: "" },
      { id: "g20", flightNo: "CX937", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "cx-g18", flightNo: "CX937", name: "G18", category: "常规", qualifiedStaffIds: [alternate!.id, repeated!.id] },
      { ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", remark: "一号", qualifiedStaffIds: [alternate!.id, repeated!.id] }
    ];
    state.history = [{
      id: "previous-g20", date: "2026-10-22", flightNo: "CX937", position: "G20", staffId: repeated!.id, staffName: repeated!.name,
      startTime: "08:30", endTime: "10:30", workHours: 2, fatiguePoints: 1, remark: ""
    }];

    const assignments = generateSchedule(state, "2026-10-24").assignments;
    expect(assignments.find((item) => item.position === "G20")?.staffId).toBe(alternate!.id);
    expect(assignments.find((item) => item.position === "G18")?.staffId).toBe(repeated!.id);
    expect(assignments.find((item) => item.position === "G20")?.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "position-frequency", outcome: "selected" })
    ]));
  });

  it("uses a three-person cycle when no direct swap can resolve a third consecutive assignment", () => {
    const state = createDefaultState();
    const [first, second, third] = state.staff.filter((person) => person.status === "正常").slice(0, 3);
    const repeated = third!;
    const nextForRepeated = second!;
    const nextForSecond = first!;
    state.staff = [nextForRepeated, repeated, nextForSecond];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "g18", flightNo: "MU100", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "g16", flightNo: "MU200", startTime: "08:15", endTime: "10:15", bookedPassengers: 100, positions: [], remark: "" },
      { id: "g20", flightNo: "CX937", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "cx-g18", flightNo: "MU100", name: "G18", category: "常规", qualifiedStaffIds: [nextForRepeated.id, nextForSecond.id] },
      { ...base, id: "cx-g16", flightNo: "MU200", name: "G16", category: "常规", qualifiedStaffIds: [repeated.id, nextForSecond.id] },
      { ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", qualifiedStaffIds: [repeated.id, nextForRepeated.id] }
    ];
    state.history = ["2026-10-20", "2026-10-22"].map((date, index) => ({
      id: `repeated-g20-${index}`, date, flightNo: "CX937", position: "G20", staffId: repeated.id, staffName: repeated.name,
      startTime: "08:30", endTime: "10:30", workHours: 2, fatiguePoints: 1, remark: ""
    })).concat(["2026-10-02", "2026-10-04"].map((date, index) => ({
      id: `older-g18-${index}`, date, flightNo: "MU100", position: "G18", staffId: nextForSecond.id, staffName: nextForSecond.name,
      startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1, remark: ""
    })));

    const assignments = generateSchedule(state, "2026-10-24").assignments;
    expect(assignments.find((item) => item.position === "G20")?.staffId).toBe(nextForRepeated.id);
    expect(assignments.find((item) => item.position === "G18")?.staffId).toBe(nextForSecond.id);
    expect(assignments.find((item) => item.position === "G16")?.staffId).toBe(repeated.id);
    expect(assignments.find((item) => item.position === "G20")?.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "position-rotation", outcome: "selected" })
    ]));
  });

  it("uses an overlapping-flight direct swap after same-flight candidates are unavailable", () => {
    const state = createDefaultState();
    const [alternate, repeated] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [alternate!, repeated!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "other", flightNo: "MU100", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "cx", flightNo: "CX937", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "other-g18", flightNo: "MU100", name: "G18", category: "常规", qualifiedStaffIds: [alternate!.id, repeated!.id] },
      { ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", remark: "一号", qualifiedStaffIds: [alternate!.id, repeated!.id] }
    ];
    state.history = [{
      id: "previous-g20", date: "2026-10-22", flightNo: "CX937", position: "G20", staffId: repeated!.id, staffName: repeated!.name,
      startTime: "08:30", endTime: "10:30", workHours: 2, fatiguePoints: 1, remark: ""
    }];

    const assignments = generateSchedule(state, "2026-10-24").assignments;
    expect(assignments.find((item) => item.positionRuleId === "cx-g20")?.staffId).toBe(alternate!.id);
    expect(assignments.find((item) => item.positionRuleId === "other-g18")?.staffId).toBe(repeated!.id);
  });

  it("keeps an unavoidable third consecutive assignment and records the rotation review reason", () => {
    const state = createDefaultState();
    const [alternate, repeated] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [alternate!, repeated!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "cx", flightNo: "CX937", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "cx-g18", flightNo: "CX937", name: "G18", category: "常规", qualifiedStaffIds: [alternate!.id] },
      { ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", qualifiedStaffIds: [repeated!.id, alternate!.id] }
    ];
    state.history = ["2026-10-20", "2026-10-22"].map((date, index) => ({
      id: `repeated-g20-${index}`, date, flightNo: "CX937", position: "G20", staffId: repeated!.id, staffName: repeated!.name,
      startTime: "08:30", endTime: "10:30", workHours: 2, fatiguePoints: 1, remark: ""
    }));

    const result = generateSchedule(state, "2026-10-24");
    state.assignments = result.assignments;
    const repeatedAssignment = state.assignments.find((item) => item.position === "G20")!;
    expect(repeatedAssignment.staffId).toBe(repeated!.id);
    expect(repeatedAssignment.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "position-rotation", outcome: "fallback" })
    ]));
    const feedback = buildScheduleFeedback(state, "2026-10-24").find((item) => item.key === "position-rotation")!;
    expect(feedback).toMatchObject({ status: "需复核" });
    expect(feedback.text).toContain("连续轮岗未落实");
    expect(feedback.text).toContain("双向岗位资质");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("连续轮岗未落实")
    ]));
  });

  it("blocks a strict transition after noon while prefer mode remains a fallback preference", () => {
    const buildState = (mode: "prefer" | "forbid") => {
      const state = createDefaultState();
      const person = state.staff.find((item) => item.status === "正常")!;
      person.dutyQualified = false;
      state.staff = [person];
      state.flights = [
        { id: "source", flightNo: "SOURCE", startTime: "13:00", endTime: "14:00", bookedPassengers: 100, positions: [], remark: "" },
        { id: "target", flightNo: "TARGET", startTime: "15:00", endTime: "16:00", bookedPassengers: 100, positions: [], remark: "" }
      ];
      const base = state.positionRules[0]!;
      state.positionRules = [
        { ...base, id: "source-position", flightNo: "SOURCE", name: "G01", category: "常规", qualifiedStaffIds: [person.id] },
        { ...base, id: "target-position", flightNo: "TARGET", name: "H01", category: "常规", qualifiedStaffIds: [person.id] }
      ];
      state.settings.positionTransitionPolicies = [{
        id: "afternoon-transition",
        name: "下午严格衔接",
        enabled: true,
        sourceFlightNo: "SOURCE",
        sourcePositions: ["G01"],
        targetFlightNo: "TARGET",
        targetPosition: "H01",
        minimumGapMinutes: 180,
        mode
      }];
      return state;
    };

    const strictResult = generateSchedule(buildState("forbid"), "2026-07-18");
    expect(strictResult.assignments.find((item) => item.positionRuleId === "target-position")).toMatchObject({
      status: "unfilled",
      staffId: null,
      systemNotes: [expect.stringContaining("下午严格衔接")]
    });

    const preferredResult = generateSchedule(buildState("prefer"), "2026-07-18");
    expect(preferredResult.assignments.find((item) => item.positionRuleId === "target-position")).toMatchObject({
      status: "assigned",
      staffId: expect.any(String)
    });
  });

  it("does not exchange through a manually marked position", () => {
    const state = createDefaultState();
    const [alternate, repeated] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [alternate!, repeated!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [{ id: "cx", flightNo: "CX937", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "manual-g18", flightNo: "CX937", name: "G18", category: "常规", manual: true, qualifiedStaffIds: [alternate!.id, repeated!.id] },
      { ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", qualifiedStaffIds: [alternate!.id, repeated!.id] }
    ];
    state.history = ["2026-10-20", "2026-10-22"].map((date, index) => ({
      id: `repeated-g20-${index}`, date, flightNo: "CX937", position: "G20", staffId: repeated!.id, staffName: repeated!.name,
      startTime: "08:30", endTime: "10:30", workHours: 2, fatiguePoints: 1, remark: ""
    }));

    const assignments = generateSchedule(state, "2026-10-24").assignments;
    expect(assignments.find((item) => item.position === "G20")?.staffId).toBe(repeated!.id);
    expect(assignments.find((item) => item.position === "G20")?.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "position-rotation", outcome: "fallback" })
    ]));
  });

  it("does not move duty and KE166 mobile-supervisor locks during rotation review", () => {
    const state = createDefaultState();
    const [supervisor, repeated] = state.staff.filter((person) => person.status === "正常").slice(0, 2);
    state.staff = [supervisor!, repeated!];
    state.staff.forEach((person) => { person.dutyQualified = false; });
    state.flights = [
      { id: "ke166", flightNo: "KE166", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "cx", flightNo: "CX937", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "ke-supervisor", flightNo: "KE166", name: "督导", category: "机动督导", qualifiedStaffIds: [supervisor!.id] },
      { ...base, id: "ke-counter", flightNo: "KE166", name: "H04", category: "常规", qualifiedStaffIds: [supervisor!.id, repeated!.id] },
      { ...base, id: "cx-g20", flightNo: "CX937", name: "G20", category: "常规", remark: "一号", qualifiedStaffIds: [supervisor!.id, repeated!.id] }
    ];
    state.history = ["2026-10-20", "2026-10-22"].map((date, index) => ({
      id: `repeated-g20-${index}`, date, flightNo: "CX937", position: "G20", staffId: repeated!.id, staffName: repeated!.name,
      startTime: "08:30", endTime: "10:30", workHours: 2, fatiguePoints: 1, remark: ""
    }));

    const assignments = generateSchedule(state, "2026-10-24").assignments;
    expect(assignments.find((item) => item.positionRuleId === "ke-supervisor")?.staffId).toBe(supervisor!.id);
    expect(assignments.find((item) => item.positionRuleId === "ke-counter")?.supervisorSourceAssignmentId).toBeTruthy();
    expect(assignments.find((item) => item.positionRuleId === "cx-g20")?.staffId).toBe(repeated!.id);
    expect(assignments.find((item) => item.positionRuleId === "cx-g20")?.decisionTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "position-frequency-review",
        outcome: "fallback",
        message: expect.stringContaining("值班或KE166特殊锁定")
      }),
      expect.objectContaining({ ruleId: "position-rotation", outcome: "fallback" })
    ]));
  });
});
