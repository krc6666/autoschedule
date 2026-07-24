import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { getDutyRosterForDate } from "./duty-roster";
import { generateSchedule } from "./scheduler";
import { buildScheduleFeedback } from "./schedule-feedback";

describe("schedule feedback", () => {
  it("returns concise evidence-based items including duty arrangements and a missing history baseline", () => {
    const state = createDefaultState();
    state.assignments = generateSchedule(state, "2026-07-20").assignments;
    const feedback = buildScheduleFeedback(state, "2026-07-20");
    expect(feedback).toHaveLength(8);
    expect(feedback.map((item) => item.label)).toEqual(["人员覆盖", "负荷均衡", "航班衔接", "12点前岗位完整性", "连续高负荷", "上一工作日晚班", "分队长督导补缺", "值班与轮值"]);
    expect(feedback.slice(0, 3).every((item) => item.group === "flight-staff")).toBe(true);
    expect(feedback.slice(3).every((item) => item.group === "rule-execution")).toBe(true);
    expect(feedback.every((item) => ["已执行", "需复核", "无基准"].includes(item.status))).toBe(true);
    expect(feedback.every((item) => item.evidence === item.text && item.evidence.length > 0)).toBe(true);
    expect(feedback.find((item) => item.key === "previous-late")).toMatchObject({ status: "无基准", group: "rule-execution" });
    expect(feedback.find((item) => item.key === "previous-late")?.text).toContain("暂无最近工作日归档");
    expect(feedback.find((item) => item.key === "duty-roster")?.text).toContain("值班");
    expect(feedback.find((item) => item.key === "duty-roster")?.text).toContain(`+${state.settings.dutyFatiguePoints} 点疲劳`);
    expect(feedback.find((item) => item.key === "duty-roster")?.text).toContain("08:30前早班");
    expect(feedback.find((item) => item.key === "fatigue")?.text).toContain("工时差");
    expect(feedback.find((item) => item.key === "fatigue")?.text).toContain("当日疲劳差");
    expect(feedback.find((item) => item.key === "coverage")?.text).toContain("相邻航班起飞间隔");
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
    expect(feedback.find((item) => item.key === "high-load")?.text).toContain("已超保护仍安排");
    expect(feedback.find((item) => item.key === "previous-late")?.text).toContain("超过 2 点");
    expect(feedback.find((item) => item.key === "previous-late")?.text).toContain("已超保护仍安排");
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

  it("marks a previous late-shift worker used on an early flight as a protection override", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.staff = [person];
    state.flights = [{ id: "early", flightNo: "KE166", startTime: "08:30", endTime: "10:30", bookedPassengers: 100, positions: [], remark: "" }];
    state.assignments = [{
      id: "early-position", flightId: "early", flightNo: "KE166", positionRuleId: null, position: "H03",
      staffId: person.id, staffName: person.name, startTime: "08:30", endTime: "10:30", workHours: 2,
      fatiguePoints: 2, remark: "", manualRemark: "", status: "assigned"
    }];
    state.history = [{
      id: "previous-late", date: "2026-07-17", flightNo: "TR121", position: "H02", staffId: person.id, staffName: person.name,
      startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 5, remark: "一号"
    }];
    const feedback = buildScheduleFeedback(state, "2026-07-18").find((item) => item.key === "previous-late")!;
    expect(feedback.text).toContain("KE166/H03");
    expect(feedback.text).toContain("早班岗位完整性优先");
    expect(feedback.text).toContain("已超保护仍安排");
  });

  it("explains whether the duty person received a preferred latest-flight position", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    state.flights = [
      { id: "early", flightNo: "EARLY", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "middle", flightNo: "MIDDLE", startTime: "15:00", endTime: "17:00", bookedPassengers: 100, positions: [], remark: "" },
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
    expect(feedback.text).toContain("最晚航班");
    expect(feedback.text).toContain("符合值班晚撤规则");
    const dutyAssignment = state.assignments.find((item) => item.staffId && feedback.text.includes(item.staffName) && item.positionRuleId === "late-first")!;
    dutyAssignment.startTime = "08:00";
    dutyAssignment.endTime = "10:00";
    dutyAssignment.flightNo = "EARLY";
    const abnormal = buildScheduleFeedback(state, "2026-07-20").find((item) => item.key === "duty-roster")!;
    expect(abnormal.level).toBe("attention");
    expect(abnormal.text).toContain("未满足值班晚撤规则");
  });

  it("reports when a team leader is used as the mobile supervisor fallback", () => {
    const state = createDefaultState();
    const teamLeader = state.staff[0]!;
    state.staff = [teamLeader];
    teamLeader.teamLeader = true;
    teamLeader.dutyQualified = false;
    state.flights = [{ id: "flight", flightNo: "F1", startTime: "13:00", endTime: "15:00", bookedPassengers: 100, positions: [], remark: "" }];
    state.positionRules = [{ ...state.positionRules[0]!, id: "supervisor", flightNo: "F1", name: "督导", category: "常规", qualifiedStaffIds: [teamLeader.id] }];
    state.assignments = generateSchedule(state, "2026-07-18").assignments;

    const feedback = buildScheduleFeedback(state, "2026-07-18").find((item) => item.key === "team-leader-supervisor")!;

    expect(feedback.status).toBe("已执行");
    expect(feedback.text).toContain(`已启用分队长补缺：${teamLeader.name}承担F1/督导`);
  });

  it("reports the configured duty position priority that actually received the duty worker", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    state.flights = [
      { id: "early", flightNo: "EARLY", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "tr", flightNo: "TR121", startTime: "21:00", endTime: "23:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    const qualifiedStaffIds = state.staff.map((person) => person.id);
    state.positionRules = [
      ...Array.from({ length: 5 }, (_, index) => ({ ...base, id: `early-${index}`, flightNo: "EARLY", name: `G0${index + 1}`, remark: "", qualifiedStaffIds })),
      { ...base, id: "tr-first", flightNo: "TR121", name: "H02", remark: "一号", qualifiedStaffIds }
    ];
    state.assignments = generateSchedule(state, "2026-07-20").assignments;

    const feedback = buildScheduleFeedback(state, "2026-07-20").find((item) => item.key === "duty-roster")!;
    expect(feedback.text).toContain("配置优先级第 1 项 TR121/H02");
    expect(feedback.text).toContain("符合值班岗位优先顺序");
  });

  it("explains the second-latest fallback when the latest flight has no executable duty target", () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 6);
    state.staff.forEach((person) => { person.dutyQualified = true; });
    state.staff[5]!.cxPreflightQualified = true;
    state.flights = [
      { id: "early", flightNo: "EARLY", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "second", flightNo: "SECOND", startTime: "20:00", endTime: "22:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "latest", flightNo: "LATEST", startTime: "22:30", endTime: "00:30", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const roster = getDutyRosterForDate(state, "2026-07-20");
    const duty = state.staff.find((person) => person.id === roster.dutyStaffId)!;
    state.assignments = [{
      id: "duty-second", flightId: "second", flightNo: "SECOND", positionRuleId: null, position: "G17",
      staffId: duty.id, staffName: duty.name, startTime: "20:00", endTime: "22:00", workHours: 2,
      fatiguePoints: 4, remark: "申报", manualRemark: "", status: "assigned"
    }];

    const feedback = buildScheduleFeedback(state, "2026-07-20").find((item) => item.key === "duty-roster")!;
    expect(feedback.text).toContain("倒数第二晚航班 SECOND/G17");
    expect(feedback.text).toContain("值班晚撤规则第二档位");
    expect(feedback.text).toContain("符合值班晚撤规则");
  });

  it("reports strict pre-noon overrides, reallocation vacancies, and objective staffing shortages", () => {
    const state = createDefaultState();
    state.flights = [
      { id: "source", flightNo: "SOURCE", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" },
      { id: "target", flightNo: "TARGET", startTime: "09:00", endTime: "11:00", bookedPassengers: 100, positions: [], remark: "" }
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      { ...base, id: "source-position", flightNo: "SOURCE", name: "G01", category: "常规" },
      { ...base, id: "target-position", flightNo: "TARGET", name: "H01", category: "常规" },
      { ...base, id: "short-position", flightNo: "TARGET", name: "H02", category: "常规" }
    ];
    const person = state.staff[0]!;
    state.staff = [person];
    state.assignments = [
      {
        id: "source-assignment", flightId: "source", flightNo: "SOURCE", positionRuleId: "source-position", position: "G01",
        staffId: null, staffName: "", startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 1,
        remark: "", manualRemark: "", status: "unfilled", systemNotes: ["因抽调至 TARGET/H01 而空缺"]
      },
      {
        id: "target-assignment", flightId: "target", flightNo: "TARGET", positionRuleId: "target-position", position: "H01",
        staffId: person.id, staffName: person.name, startTime: "09:00", endTime: "11:00", workHours: 2, fatiguePoints: 1,
        remark: "", manualRemark: "", status: "assigned", systemNotes: ["已突破严格限制仍安排：早间严格衔接"]
      },
      {
        id: "short-assignment", flightId: "target", flightNo: "TARGET", positionRuleId: "short-position", position: "H02",
        staffId: null, staffName: "", startTime: "09:00", endTime: "11:00", workHours: 2, fatiguePoints: 1,
        remark: "", manualRemark: "", status: "unfilled", systemNotes: ["因合格人数不足而无法填满（缺少 1 人：时段冲突 1 人）"]
      }
    ];

    const feedback = buildScheduleFeedback(state, "2026-07-18");
    const morning = feedback.find((item) => item.key === "morning-priority")!;
    expect(morning.text).toContain("因抽调至 TARGET/H01 而空缺");
    expect(morning.text).toContain("因合格人数不足而无法填满");
    expect(morning.text).toContain("已突破严格限制仍安排");
  });
});
