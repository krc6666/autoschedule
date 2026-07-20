import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { generateSchedule } from "./scheduler";
import { buildScheduleFeedback } from "./schedule-feedback";

describe("schedule feedback", () => {
  it("returns concise evidence-based items including duty arrangements and a missing history baseline", () => {
    const state = createDefaultState();
    state.assignments = generateSchedule(state, "2026-07-20").assignments;
    const feedback = buildScheduleFeedback(state, "2026-07-20");
    expect(feedback).toHaveLength(6);
    expect(feedback.map((item) => item.label)).toEqual(["人员覆盖", "疲劳分布", "航班衔接", "连续高负荷", "上一工作日晚班", "轮值安排"]);
    expect(feedback.find((item) => item.key === "previous-late")?.text).toContain("暂无最近工作日归档");
    expect(feedback.find((item) => item.key === "duty-roster")?.text).toContain("值班");
    expect(feedback.find((item) => item.key === "duty-roster")?.text).toContain(`+${state.settings.dutyFatiguePoints} 点疲劳`);
  });

  it("identifies tight transitions, repeated high load, uncovered staff, and late-shift overload", () => {
    const state = createDefaultState();
    const [worker, uncovered] = state.staff;
    state.staff = [worker!, uncovered!];
    state.flights = [
      { id: "f1", flightNo: "F1", startTime: "20:00", endTime: "21:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "f2", flightNo: "TR121", startTime: "21:15", endTime: "23:15", bookedPassengers: 100, positions: [], remark: "" }
    ];
    state.assignments = [
      { id: "a1", flightId: "f1", flightNo: "F1", positionRuleId: null, position: "P1", staffId: worker!.id, staffName: worker!.name, startTime: "20:00", endTime: "21:00", workHours: 1, fatiguePoints: 5, remark: "控制", manualRemark: "", status: "assigned" },
      { id: "a2", flightId: "f2", flightNo: "TR121", positionRuleId: null, position: "H02", staffId: worker!.id, staffName: worker!.name, startTime: "21:15", endTime: "23:15", workHours: 2, fatiguePoints: 5, remark: "一号", manualRemark: "", status: "assigned" }
    ];
    state.history = [{ id: "h1", date: "2026-07-18", flightNo: "TR121", position: "H02", staffId: worker!.id, staffName: worker!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 5, remark: "一号" }];
    const feedback = buildScheduleFeedback(state, "2026-07-20");
    expect(feedback.find((item) => item.key === "coverage")).toMatchObject({ level: "attention" });
    expect(feedback.find((item) => item.key === "coverage")?.text).toContain(uncovered!.name);
    expect(feedback.find((item) => item.key === "connections")?.text).toContain("15 分钟");
    expect(feedback.find((item) => item.key === "high-load")?.text).toContain(worker!.name);
    expect(feedback.find((item) => item.key === "previous-late")?.text).toContain("超过 2 点");
  });

  it("reports an enabled position-transition rule when its minimum gap is not met", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.staff = [person];
    state.flights = [
      { id: "source", flightNo: "CX931", startTime: "17:00", endTime: "19:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "target", flightNo: "TR121", startTime: "20:00", endTime: "22:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    state.assignments = [
      { id: "source-a", flightId: "source", flightNo: "CX931", positionRuleId: null, position: "G19", staffId: person.id, staffName: person.name, startTime: "17:00", endTime: "19:00", workHours: 2, fatiguePoints: 2, remark: "", manualRemark: "", status: "assigned" },
      { id: "target-a", flightId: "target", flightNo: "TR121", positionRuleId: null, position: "H02", staffId: person.id, staffName: person.name, startTime: "20:00", endTime: "22:00", workHours: 2, fatiguePoints: 2, remark: "", manualRemark: "", status: "assigned" }
    ];
    const connections = buildScheduleFeedback(state, "2026-07-20").find((item) => item.key === "connections")!;
    expect(connections.level).toBe("attention");
    expect(connections.text).toContain("未达到已配置的岗位衔接要求");
  });

  it("explains whether the duty person received a preferred latest-flight position", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    state.flights = [
      { id: "early", flightNo: "EARLY", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "late", flightNo: "LATE", startTime: "21:00", endTime: "23:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    const qualifiedStaffIds = state.staff.map((person) => person.id);
    state.positionRules = [
      ...Array.from({ length: 5 }, (_, index) => ({ ...base, id: `early-position-${index}`, flightNo: "EARLY", name: `普通柜台${index + 1}`, remark: "", qualifiedStaffIds })),
      { ...base, id: "late-first", flightNo: "LATE", name: "H02", remark: "一号", qualifiedStaffIds }
    ];
    state.assignments = generateSchedule(state, "2026-07-20").assignments;
    const feedback = buildScheduleFeedback(state, "2026-07-20").find((item) => item.key === "duty-roster")!;
    expect(feedback.level).toBe("ok");
    expect(feedback.text).toContain("LATE/H02");
    expect(feedback.text).toContain("符合晚撤岗位优先");
    const dutyAssignment = state.assignments.find((item) => item.staffId && feedback.text.includes(item.staffName) && item.positionRuleId === "late-first")!;
    dutyAssignment.startTime = "08:00";
    dutyAssignment.endTime = "10:00";
    dutyAssignment.flightNo = "EARLY";
    const abnormal = buildScheduleFeedback(state, "2026-07-20").find((item) => item.key === "duty-roster")!;
    expect(abnormal.level).toBe("attention");
    expect(abnormal.text).toContain("未进入当日最晚航班");
  });
});
