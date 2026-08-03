import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { buildScheduleFeedback } from "../../src/domain/feedback/schedule-feedback";
import { schedulingDecision } from "../../src/domain/rules/schedule-rule-contract";
import type { AppState, Assignment } from "../../src/model";
import {
  assignStaff,
  manualAssignmentConfirmation,
  updateAssignmentField,
} from "../../src/app/schedule-actions";

function supervisorSchedule(): AppState {
  const state = createDefaultState();
  const person = state.staff[0]!;
  person.name = "张奇";
  state.staff = [person];
  state.flights = [
    {
      id: "ke166",
      flightNo: "KE166",
      startTime: "09:15",
      endTime: "11:15",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    },
  ];
  const base = state.positionRules[0]!;
  state.positionRules = [
    {
      ...base,
      id: "supervisor",
      flightNo: "KE166",
      name: "督导",
      category: "机动督导",
      qualifiedStaffIds: [person.id],
      fatiguePoints: 5,
    },
    {
      ...base,
      id: "h04",
      flightNo: "KE166",
      name: "H04",
      category: "常规",
      qualifiedStaffIds: [],
      fatiguePoints: 7,
    },
  ];
  const assignment = (
    id: string,
    ruleId: string,
    position: string,
    staffId: string | null,
    status: Assignment["status"]
  ): Assignment => ({
    id,
    flightId: "ke166",
    flightNo: "KE166",
    positionRuleId: ruleId,
    position,
    staffId,
    staffName: staffId ? person.name : "",
    startTime: "09:15",
    endTime: "11:15",
    workHours: 2,
    fatiguePoints: 2,
    remark: "",
    manualRemark: "",
    status,
  });
  state.assignments = [
    assignment(
      "supervisor-assignment",
      "supervisor",
      "督导",
      person.id,
      "assigned"
    ),
    assignment("h04-assignment", "h04", "H04", null, "unfilled"),
  ];
  return state;
}

describe("督导机动补位编辑", () => {
  it("拖动顶部督导到空柜台时保留顶部并跳过目标资质限制", () => {
    const state = supervisorSchedule();
    const result = assignStaff(
      state,
      "h04-assignment",
      state.staff[0]!.id,
      "supervisor-assignment"
    );

    expect(result).toMatchObject({
      changed: true,
      message: "督导已机动补位至目标岗位",
    });
    expect(
      state.assignments.find((item) => item.id === "supervisor-assignment")
    ).toMatchObject({ staffName: "张奇", workHours: 2 });
    expect(
      state.assignments.find((item) => item.id === "h04-assignment")
    ).toMatchObject({
      staffName: "张奇",
      workHours: 0,
      fatiguePoints: 7,
      supervisorSourceAssignmentId: "supervisor-assignment",
    });
    expect(
      buildScheduleFeedback(state, "2026-07-22").find(
        (item) => item.key === "coverage"
      )?.text
    ).toContain("督导机动补位：张奇兼任KE166/H04");
  });

  it("拒绝把督导拖入已有人员的柜台", () => {
    const state = supervisorSchedule();
    const target = state.assignments.find(
      (item) => item.id === "h04-assignment"
    )!;
    target.staffId = state.staff[0]!.id;
    target.staffName = state.staff[0]!.name;
    target.status = "assigned";

    expect(
      assignStaff(
        state,
        "h04-assignment",
        state.staff[0]!.id,
        "supervisor-assignment"
      )
    ).toMatchObject({
      changed: false,
      error: "目标岗位已有人员，请先清空 H04",
    });
  });

  it("人工拖拽不能绕过机动督导兼任范围", () => {
    const state = supervisorSchedule();
    state.assignments.find((item) => item.id === "h04-assignment")!.remark =
      "申报";

    expect(
      assignStaff(
        state,
        "h04-assignment",
        state.staff[0]!.id,
        "supervisor-assignment"
      )
    ).toMatchObject({
      changed: false,
      error: expect.stringContaining("机动督导不能兼任 KE166/H04"),
    });
  });
});

describe("人工调整后的规则证据", () => {
  it("换人后清除目标岗位的旧自动决策，反馈不再展示过期理由", () => {
    const state = createDefaultState();
    const [original, replacement] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    const flight = state.flights[0]!;
    const baseRule = state.positionRules.find(
      (item) => item.flightNo === flight.flightNo
    )!;
    const rule = {
      ...baseRule,
      id: "editable-rule",
      qualifiedStaffIds: [original!.id, replacement!.id],
    };
    state.positionRules = [rule];
    state.assignments = [
      {
        id: "assignment",
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: rule.id,
        position: rule.name,
        staffId: original!.id,
        staffName: original!.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: 2,
        fatiguePoints: rule.fatiguePoints,
        remark: rule.remark,
        manualRemark: "",
        status: "assigned",
        decisionTrace: [
          schedulingDecision(
            "position-frequency-review",
            "selected",
            "这是已经过期的自动排班理由"
          ),
        ],
      },
    ];

    expect(assignStaff(state, "assignment", replacement!.id)).toMatchObject({
      changed: true,
    });
    expect(state.assignments[0]!.decisionTrace).toBeUndefined();
    expect(
      buildScheduleFeedback(state, "2026-07-18")
        .map((item) => item.text)
        .join("\n")
    ).not.toContain("这是已经过期的自动排班理由");
  });

  it("重点岗位换人后立即移除琥珀异常，换回连续人员时重新生成当前原因", () => {
    const state = createDefaultState();
    const [repeated, replacement] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [repeated!, replacement!];
    state.activeScheduleDate = "2026-08-03";
    const flight = state.flights[0]!;
    const base = state.positionRules.find(
      (item) => item.flightNo === flight.flightNo
    )!;
    const rule = {
      ...base,
      id: "priority",
      name: "G20",
      remark: "一号",
      qualifiedStaffIds: [repeated!.id, replacement!.id],
    };
    state.positionRules = [rule];
    state.history = [
      {
        id: "previous",
        date: "2026-08-01",
        flightNo: flight.flightNo,
        position: "G20",
        staffId: repeated!.id,
        staffName: repeated!.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: 2,
        fatiguePoints: 4,
        remark: "一号",
      },
    ];
    state.assignments = [
      {
        id: "assignment",
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: rule.id,
        position: "G20",
        staffId: repeated!.id,
        staffName: repeated!.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: 2,
        fatiguePoints: 4,
        remark: "一号",
        manualRemark: "",
        status: "assigned",
        decisionTrace: [
          schedulingDecision("position-rotation", "fallback", "旧异常"),
        ],
      },
    ];

    expect(assignStaff(state, "assignment", replacement!.id).changed).toBe(
      true
    );
    expect(
      state.assignments[0]!.decisionTrace?.some(
        (decision) => decision.ruleId === "position-rotation"
      )
    ).not.toBe(true);

    expect(assignStaff(state, "assignment", repeated!.id).changed).toBe(true);
    expect(state.assignments[0]!.decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "position-rotation",
          outcome: "fallback",
          message: expect.stringContaining("当前为人工安排"),
        }),
      ])
    );
  });

  it("人工调整其他岗位后仍重建KE166机动督导整组的连续异常", () => {
    const state = supervisorSchedule();
    const supervisor = state.assignments.find(
      (item) => item.id === "supervisor-assignment"
    )!;
    const boundCounter = state.assignments.find(
      (item) => item.id === "h04-assignment"
    )!;
    state.activeScheduleDate = "2026-08-03";
    state.history = [
      {
        id: "previous-ke166-supervisor",
        date: "2026-08-01",
        flightNo: "KE166",
        position: "督导",
        staffId: supervisor.staffId!,
        staffName: supervisor.staffName,
        startTime: "09:15",
        endTime: "11:15",
        workHours: 2,
        fatiguePoints: 5,
        remark: "",
      },
    ];
    boundCounter.staffId = supervisor.staffId;
    boundCounter.staffName = supervisor.staffName;
    boundCounter.status = "assigned";
    boundCounter.workHours = 0;
    boundCounter.supervisorSourceAssignmentId = supervisor.id;
    supervisor.decisionTrace = [
      schedulingDecision("position-rotation", "fallback", "旧KE166异常"),
    ];
    boundCounter.decisionTrace = [
      schedulingDecision("position-rotation", "fallback", "旧KE166异常"),
    ];
    state.assignments.push({
      id: "temporary",
      flightId: "ke166",
      flightNo: "KE166",
      positionRuleId: null,
      position: "临时岗位",
      staffId: null,
      staffName: "",
      startTime: "09:15",
      endTime: "11:15",
      workHours: 0,
      fatiguePoints: 0,
      remark: "",
      manualRemark: "",
      status: "manual",
    });

    expect(
      updateAssignmentField(state, "temporary", "staffName", "临时支援").changed
    ).toBe(true);
    for (const assignment of [supervisor, boundCounter]) {
      expect(assignment.decisionTrace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: "position-rotation",
            outcome: "fallback",
            message: expect.stringContaining("当前为人工安排"),
          }),
        ])
      );
      expect(
        assignment.decisionTrace?.map((decision) => decision.message)
      ).not.toContain("旧KE166异常");
    }
  });
});

describe("人工改派前的规则确认", () => {
  it("由排班编辑模块返回次班截止保护提示，界面无需理解恢复规则", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    const flight = state.flights[0]!;
    const baseRule = state.positionRules.find(
      (item) => item.flightNo === flight.flightNo
    )!;
    state.positionRules = [
      {
        ...baseRule,
        id: "regular-position",
        category: "常规",
        qualifiedStaffIds: [person.id],
      },
    ];
    state.assignments = [
      {
        id: "assignment",
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: "regular-position",
        position: baseRule.name,
        staffId: null,
        staffName: "",
        startTime: "15:00",
        endTime: "17:00",
        workHours: 2,
        fatiguePoints: baseRule.fatiguePoints,
        remark: baseRule.remark,
        manualRemark: "",
        status: "unfilled",
      },
    ];
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "late-number-one",
        enabled: true,
        flightNo: "TR121",
        matchField: "remark",
        keyword: "一号",
        nextWorkdayCutoffTime: "12:00",
      },
    ];
    state.history = [
      {
        id: "previous-late",
        date: "2026-08-21",
        flightNo: "TR121",
        position: "H02",
        staffId: person.id,
        staffName: person.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 10,
        remark: "一号",
      },
    ];

    expect(
      manualAssignmentConfirmation(state, "assignment", person.id, "2026-08-23")
    ).toBe(
      `${person.name}属于上一班末班重点岗位人员，本次安排会突破次班截止保护。确认仍安排到${flight.flightNo}/${baseRule.name}？`
    );
    expect(
      manualAssignmentConfirmation(state, "assignment", person.id, "2026-08-21")
    ).toBeNull();
  });
});

describe("引导人员人工调整", () => {
  function guideSchedule(): AppState {
    const state = createDefaultState();
    const [upper, lower, outsider] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 3);
    state.staff = [upper!, lower!, outsider!];
    state.flights = [
      {
        id: "flight",
        flightNo: "F1",
        startTime: "08:00",
        endTime: "10:00",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "upper",
        flightNo: "F1",
        name: "G02",
        category: "常规",
        qualifiedStaffIds: [upper!.id],
      },
      {
        ...base,
        id: "lower",
        flightNo: "F1",
        name: "G01",
        category: "常规",
        qualifiedStaffIds: [lower!.id],
      },
      {
        ...base,
        id: "guide",
        flightNo: "F1",
        name: "柜台引导",
        category: "引导",
        qualifiedStaffIds: [],
        fatiguePoints: 5,
      },
    ];
    state.assignments = [
      {
        id: "upper-assignment",
        flightId: "flight",
        flightNo: "F1",
        positionRuleId: "upper",
        position: "G02",
        staffId: upper!.id,
        staffName: upper!.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
      {
        id: "lower-assignment",
        flightId: "flight",
        flightNo: "F1",
        positionRuleId: "lower",
        position: "G01",
        staffId: lower!.id,
        staffName: lower!.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
      {
        id: "guide-assignment",
        flightId: "flight",
        flightNo: "F1",
        positionRuleId: "guide",
        position: "柜台引导",
        staffId: lower!.id,
        staffName: lower!.name,
        startTime: "08:00",
        endTime: "10:00",
        workHours: 0,
        fatiguePoints: 0,
        remark: "",
        manualRemark: "",
        status: "assigned",
      },
    ];
    return state;
  }

  it("允许改为同航班已上岗的其他正常常规人员，并保持零工时零疲劳", () => {
    const state = guideSchedule();
    const guide = state.assignments.find(
      (assignment) => assignment.id === "guide-assignment"
    )!;
    const upper = state.staff[0]!;

    expect(
      updateAssignmentField(state, guide.id, "staffName", upper.name)
    ).toMatchObject({ changed: true });
    expect(guide).toMatchObject({
      staffId: upper.id,
      staffName: upper.name,
      status: "manual",
      workHours: 0,
      fatiguePoints: 0,
    });
  });

  it("拒绝未参加该航班和不存在的引导人员", () => {
    const state = guideSchedule();
    const guide = state.assignments.find(
      (assignment) => assignment.id === "guide-assignment"
    )!;
    const outsider = state.staff[2]!;

    expect(
      updateAssignmentField(state, guide.id, "staffName", outsider.name).error
    ).toContain("未在该航班承担常规岗位");
    expect(
      updateAssignmentField(state, guide.id, "staffName", "不存在人员").error
    ).toContain("只能复用同一航班");
  });
});
