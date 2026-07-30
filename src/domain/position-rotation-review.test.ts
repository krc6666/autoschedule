import { describe, expect, it } from "vitest";
import { createDefaultState } from "../defaults";
import type { AppState, Assignment } from "../model";
import { reviewConsecutivePositionRotation } from "./position-rotation-review";
import { generateSchedule } from "./scheduler";

function disableUnrelatedProtections(state: AppState): void {
  state.settings.nextDutyRestProtectionEnabled = false;
  state.settings.lateShiftRecoveryEnabled = false;
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.workloadBalanceEnabled = false;
  state.settings.positionTransitionPolicies = [];
}

function assignment(
  id: string,
  positionRuleId: string,
  position: string,
  staffId: string,
  staffName: string,
  remark = ""
): Assignment {
  return {
    id,
    flightId: "flight",
    flightNo: "TEST100",
    positionRuleId,
    position,
    staffId,
    staffName,
    startTime: "08:30",
    endTime: "10:30",
    workHours: 2,
    fatiguePoints: remark ? 6 : 1,
    remark,
    manualRemark: "",
    status: "assigned",
  };
}

function latePairScenario(ordinaryFatigue = 4) {
  const state = createDefaultState();
  const [repeatedWorker, replacementWorker] = state.staff
    .filter((person) => person.status === "正常")
    .slice(0, 2);
  state.staff = [repeatedWorker!, replacementWorker!];
  state.staff.forEach((person) => {
    person.dutyQualified = false;
    person.nightShift = true;
  });
  state.settings.nextDutyRestProtectionEnabled = false;
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.workloadBalanceEnabled = false;
  state.settings.positionTransitionPolicies = [];
  state.settings.lateShiftRecoveryEnabled = true;
  state.settings.lateShiftRecoveryPositionRules = [
    {
      id: "late-declaration",
      enabled: true,
      flightNo: "NIGHT1",
      matchField: "remark",
      keyword: "申报",
      nextWorkdayCutoffTime: "20:00",
    },
  ];
  state.flights = [
    {
      id: "night-flight",
      flightNo: "NIGHT1",
      startTime: "21:55",
      endTime: "23:55",
      bookedPassengers: 100,
      positions: [],
      remark: "",
    },
  ];
  const base = state.positionRules[0]!;
  state.positionRules = [
    {
      ...base,
      id: "late-priority",
      flightNo: "NIGHT1",
      name: "G14",
      remark: "申报",
      fatiguePoints: 5,
      category: "常规",
      qualifiedStaffIds: [repeatedWorker!.id, replacementWorker!.id],
    },
    {
      ...base,
      id: "late-ordinary",
      flightNo: "NIGHT1",
      name: "H06",
      remark: "",
      fatiguePoints: ordinaryFatigue,
      category: "常规",
      qualifiedStaffIds: [repeatedWorker!.id, replacementWorker!.id],
    },
  ];
  state.history = [
    {
      id: "previous-late-priority",
      date: "2026-11-16",
      flightNo: "NIGHT1",
      position: "G14",
      staffId: repeatedWorker!.id,
      staffName: repeatedWorker!.name,
      startTime: "21:55",
      endTime: "23:55",
      workHours: 2,
      fatiguePoints: 5,
      remark: "申报",
    },
  ];
  const priority = assignment(
    "late-priority-assignment",
    "late-priority",
    "G14",
    repeatedWorker!.id,
    repeatedWorker!.name,
    "申报"
  );
  const ordinary = assignment(
    "late-ordinary-assignment",
    "late-ordinary",
    "H06",
    replacementWorker!.id,
    replacementWorker!.name
  );
  [priority, ordinary].forEach((item) => {
    item.flightId = "night-flight";
    item.flightNo = "NIGHT1";
    item.startTime = "21:55";
    item.endTime = "23:55";
  });
  priority.fatiguePoints = 5;
  ordinary.fatiguePoints = ordinaryFatigue;
  return {
    state,
    repeatedWorker: repeatedWorker!,
    replacementWorker: replacementWorker!,
    priority,
    ordinary,
    assignments: [priority, ordinary],
  };
}

describe("consecutive priority-position rotation review", () => {
  it("does not treat equal fatigue as a late-priority improvement", () => {
    const { state, repeatedWorker, priority, ordinary, assignments } =
      latePairScenario(5);

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-11-18",
      new Set()
    );

    expect(priority.staffId).toBe(repeatedWorker.id);
    expect(ordinary.staffId).not.toBe(repeatedWorker.id);
    expect(warnings.join("\n")).toContain("重点岗位连续轮岗未落实");
  });

  it("does not move a locked ordinary role for late-priority fatigue relief", () => {
    const { state, repeatedWorker, priority, ordinary, assignments } =
      latePairScenario();

    reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-11-18",
      new Set([ordinary.id])
    );

    expect(priority.staffId).toBe(repeatedWorker.id);
  });

  it("does not move the next-workday duty worker into the late priority role", () => {
    const { state, repeatedWorker, replacementWorker, priority, assignments } =
      latePairScenario();
    replacementWorker.dutyQualified = true;
    state.settings.nextDutyRestProtectionEnabled = true;
    state.dutyRosterOverrides = [
      {
        date: "2026-11-20",
        cxPreflightStaffId: null,
        dutyStaffId: replacementWorker.id,
        standbyStaffIds: [null, null],
      },
    ];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-11-18",
      new Set()
    );

    expect(priority.staffId).toBe(repeatedWorker.id);
    expect(warnings.join("\n")).toContain("下个工作班值班人员");
  });

  it("accepts a lower-fatigue ordinary late role when the repeated worker cannot leave the late shift", () => {
    const state = createDefaultState();
    const [repeatedWorker, replacementWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [repeatedWorker!, replacementWorker!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
      person.nightShift = true;
    });
    state.settings.nextDutyRestProtectionEnabled = false;
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.workloadBalanceEnabled = false;
    state.settings.positionTransitionPolicies = [];
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "late-declaration",
        enabled: true,
        flightNo: "NIGHT1",
        matchField: "remark",
        keyword: "申报",
        nextWorkdayCutoffTime: "20:00",
      },
    ];
    state.flights = [
      {
        id: "night-flight",
        flightNo: "NIGHT1",
        startTime: "21:55",
        endTime: "23:55",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "late-priority",
        flightNo: "NIGHT1",
        name: "G14",
        remark: "申报",
        fatiguePoints: 5,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, replacementWorker!.id],
      },
      {
        ...base,
        id: "late-ordinary",
        flightNo: "NIGHT1",
        name: "H06",
        remark: "",
        fatiguePoints: 4,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, replacementWorker!.id],
      },
    ];
    state.history = [
      {
        id: "previous-late-priority",
        date: "2026-11-16",
        flightNo: "NIGHT1",
        position: "G14",
        staffId: repeatedWorker!.id,
        staffName: repeatedWorker!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 5,
        remark: "申报",
      },
    ];
    const priority = assignment(
      "late-priority-assignment",
      "late-priority",
      "G14",
      repeatedWorker!.id,
      repeatedWorker!.name,
      "申报"
    );
    const ordinary = assignment(
      "late-ordinary-assignment",
      "late-ordinary",
      "H06",
      replacementWorker!.id,
      replacementWorker!.name
    );
    [priority, ordinary].forEach((item) => {
      item.flightId = "night-flight";
      item.flightNo = "NIGHT1";
      item.startTime = "21:55";
      item.endTime = "23:55";
    });
    priority.fatiguePoints = 5;
    ordinary.fatiguePoints = 4;
    const assignments = [priority, ordinary];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-11-18",
      new Set()
    );

    expect(priority.staffId).toBe(replacementWorker!.id);
    expect(ordinary.staffId).toBe(repeatedWorker!.id);
    expect(warnings).toEqual([]);
    expect(priority.decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "position-rotation",
          outcome: "selected",
          message: expect.stringContaining("疲劳"),
        }),
      ])
    );
  });

  it("uses a configured diversion release before moving the repeated worker to a lower-fatigue late role", () => {
    const state = createDefaultState();
    const [repeatedWorker, replacementWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [repeatedWorker!, replacementWorker!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
      person.nightShift = true;
    });
    state.settings.nextDutyRestProtectionEnabled = false;
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.workloadBalanceEnabled = false;
    state.settings.positionTransitionPolicies = [];
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "twb-declaration-delivery",
        enabled: true,
        flightNo: "TWB616",
        matchField: "remark",
        keyword: "申报/送资料",
        nextWorkdayCutoffTime: "18:00",
      },
    ];
    state.flights = [
      {
        id: "ak-flight",
        flightNo: "AK151",
        startTime: "21:05",
        endTime: "23:05",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
      {
        id: "tr-flight",
        flightNo: "TR121",
        startTime: "21:55",
        endTime: "23:55",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
      {
        id: "twb-flight",
        flightNo: "TWB616",
        startTime: "22:10",
        endTime: "00:10",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "ak-g09",
        flightNo: "AK151",
        name: "G09",
        remark: "",
        fatiguePoints: 3.5,
        category: "分流",
        earlyReleaseMinutes: 60,
        qualifiedStaffIds: [repeatedWorker!.id],
      },
      {
        ...base,
        id: "tr-h08",
        flightNo: "TR121",
        name: "H08",
        remark: "",
        fatiguePoints: 2.5,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, replacementWorker!.id],
      },
      {
        ...base,
        id: "twb-g14",
        flightNo: "TWB616",
        name: "G14",
        remark: "申报/送资料",
        fatiguePoints: 5,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, replacementWorker!.id],
      },
    ];
    state.history = [
      {
        id: "previous-twb-g14",
        date: "2026-11-16",
        flightNo: "TWB616",
        position: "G14",
        staffId: repeatedWorker!.id,
        staffName: repeatedWorker!.name,
        startTime: "22:10",
        endTime: "00:10",
        workHours: 2,
        fatiguePoints: 5,
        remark: "申报/送资料",
      },
    ];
    const g09 = assignment(
      "ak-g09-assignment",
      "ak-g09",
      "G09",
      repeatedWorker!.id,
      repeatedWorker!.name
    );
    Object.assign(g09, {
      flightId: "ak-flight",
      flightNo: "AK151",
      startTime: "21:05",
      endTime: "22:10",
      workHours: 1.08,
      fatiguePoints: 3.5,
    });
    const ordinary = assignment(
      "tr-h08-assignment",
      "tr-h08",
      "H08",
      replacementWorker!.id,
      replacementWorker!.name
    );
    Object.assign(ordinary, {
      flightId: "tr-flight",
      flightNo: "TR121",
      startTime: "21:55",
      endTime: "23:55",
      fatiguePoints: 2.5,
    });
    const priority = assignment(
      "twb-g14-assignment",
      "twb-g14",
      "G14",
      repeatedWorker!.id,
      repeatedWorker!.name,
      "申报/送资料"
    );
    Object.assign(priority, {
      flightId: "twb-flight",
      flightNo: "TWB616",
      startTime: "22:10",
      endTime: "00:10",
      fatiguePoints: 5,
    });
    const assignments = [g09, ordinary, priority];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-11-18",
      new Set()
    );

    expect(priority.staffId).toBe(replacementWorker!.id);
    expect(ordinary.staffId).toBe(repeatedWorker!.id);
    expect(g09).toMatchObject({ endTime: "21:55" });
    expect(g09.workHours).toBeCloseTo(0.83, 2);
    expect(warnings.join("\n")).not.toContain("重点岗位连续轮岗未落实");
  });

  it("prefers a complete late-shift exit over a shorter lower-fatigue swap", () => {
    const state = createDefaultState();
    const [repeatedWorker, replacementWorker, endpointWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 3);
    state.staff = [repeatedWorker!, replacementWorker!, endpointWorker!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
      person.nightShift = true;
    });
    disableUnrelatedProtections(state);
    state.flights = [
      {
        id: "day-flight",
        flightNo: "DAY1",
        startTime: "10:00",
        endTime: "12:00",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
      {
        id: "night-flight",
        flightNo: "NIGHT1",
        startTime: "21:55",
        endTime: "23:55",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "day-role",
        flightNo: "DAY1",
        name: "D01",
        remark: "",
        fatiguePoints: 1,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id],
      },
      {
        ...base,
        id: "late-priority",
        flightNo: "NIGHT1",
        name: "G14",
        remark: "申报",
        fatiguePoints: 5,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, replacementWorker!.id],
      },
      {
        ...base,
        id: "late-ordinary",
        flightNo: "NIGHT1",
        name: "H06",
        remark: "",
        fatiguePoints: 4,
        category: "常规",
        qualifiedStaffIds: [
          repeatedWorker!.id,
          replacementWorker!.id,
          endpointWorker!.id,
        ],
      },
    ];
    state.history = [
      {
        id: "previous-late-priority",
        date: "2026-11-16",
        flightNo: "NIGHT1",
        position: "G14",
        staffId: repeatedWorker!.id,
        staffName: repeatedWorker!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 5,
        remark: "申报",
      },
    ];
    const dayRole = assignment(
      "day-assignment",
      "day-role",
      "D01",
      repeatedWorker!.id,
      repeatedWorker!.name
    );
    dayRole.flightId = "day-flight";
    dayRole.flightNo = "DAY1";
    dayRole.startTime = "10:00";
    dayRole.endTime = "12:00";
    dayRole.fatiguePoints = 1;
    const priority = assignment(
      "late-priority-assignment",
      "late-priority",
      "G14",
      repeatedWorker!.id,
      repeatedWorker!.name,
      "申报"
    );
    const ordinary = assignment(
      "late-ordinary-assignment",
      "late-ordinary",
      "H06",
      replacementWorker!.id,
      replacementWorker!.name
    );
    [priority, ordinary].forEach((item) => {
      item.flightId = "night-flight";
      item.flightNo = "NIGHT1";
      item.startTime = "21:55";
      item.endTime = "23:55";
    });
    priority.fatiguePoints = 5;
    ordinary.fatiguePoints = 4;
    const assignments = [dayRole, priority, ordinary];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-11-18",
      new Set()
    );

    expect(priority.staffId).toBe(replacementWorker!.id);
    expect(ordinary.staffId).toBe(endpointWorker!.id);
    expect(
      assignments.filter((item) => item.staffId === repeatedWorker!.id)
    ).toEqual([dayRole]);
    expect(warnings).toEqual([]);
  });

  it("prefers the largest fatigue reduction before the fewest participants", () => {
    const state = createDefaultState();
    const [repeatedWorker, secondWorker, thirdWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 3);
    state.staff = [repeatedWorker!, secondWorker!, thirdWorker!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
      person.nightShift = true;
    });
    state.settings.nextDutyRestProtectionEnabled = false;
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.workloadBalanceEnabled = false;
    state.settings.positionTransitionPolicies = [];
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "late-declaration",
        enabled: true,
        flightNo: "NIGHT1",
        matchField: "remark",
        keyword: "申报",
        nextWorkdayCutoffTime: "20:00",
      },
    ];
    state.flights = [
      {
        id: "night-flight",
        flightNo: "NIGHT1",
        startTime: "21:55",
        endTime: "23:55",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "late-priority",
        flightNo: "NIGHT1",
        name: "G14",
        remark: "申报",
        fatiguePoints: 5,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, secondWorker!.id],
      },
      {
        ...base,
        id: "medium-role",
        flightNo: "NIGHT1",
        name: "H06",
        remark: "",
        fatiguePoints: 4,
        category: "常规",
        qualifiedStaffIds: [
          repeatedWorker!.id,
          secondWorker!.id,
          thirdWorker!.id,
        ],
      },
      {
        ...base,
        id: "light-role",
        flightNo: "NIGHT1",
        name: "H08",
        remark: "",
        fatiguePoints: 1,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, thirdWorker!.id],
      },
    ];
    state.history = [
      {
        id: "previous-late-priority",
        date: "2026-11-16",
        flightNo: "NIGHT1",
        position: "G14",
        staffId: repeatedWorker!.id,
        staffName: repeatedWorker!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 5,
        remark: "申报",
      },
    ];
    const priority = assignment(
      "late-priority-assignment",
      "late-priority",
      "G14",
      repeatedWorker!.id,
      repeatedWorker!.name,
      "申报"
    );
    const medium = assignment(
      "medium-assignment",
      "medium-role",
      "H06",
      secondWorker!.id,
      secondWorker!.name
    );
    const light = assignment(
      "light-assignment",
      "light-role",
      "H08",
      thirdWorker!.id,
      thirdWorker!.name
    );
    [priority, medium, light].forEach((item) => {
      item.flightId = "night-flight";
      item.flightNo = "NIGHT1";
      item.startTime = "21:55";
      item.endTime = "23:55";
    });
    priority.fatiguePoints = 5;
    medium.fatiguePoints = 4;
    light.fatiguePoints = 1;
    const assignments = [priority, medium, light];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-11-18",
      new Set()
    );

    expect(assignments.map((item) => item.staffId)).toEqual([
      secondWorker!.id,
      thirdWorker!.id,
      repeatedWorker!.id,
    ]);
    expect(warnings).toEqual([]);
  });

  it("uses a previous late-priority worker only as a warned last-resort replacement", () => {
    const state = createDefaultState();
    const [repeatedWorker, protectedReplacement] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [repeatedWorker!, protectedReplacement!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
      person.nightShift = true;
    });
    state.settings.nextDutyRestProtectionEnabled = false;
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.workloadBalanceEnabled = false;
    state.settings.positionTransitionPolicies = [];
    state.settings.lateShiftRecoveryEnabled = true;
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "late-declaration",
        enabled: true,
        flightNo: "",
        matchField: "remark",
        keyword: "申报",
        nextWorkdayCutoffTime: "20:00",
      },
      {
        id: "late-delivery",
        enabled: true,
        flightNo: "",
        matchField: "remark",
        keyword: "送资料",
        nextWorkdayCutoffTime: "20:00",
      },
    ];
    state.flights = [
      {
        id: "night-flight",
        flightNo: "NIGHT1",
        startTime: "21:55",
        endTime: "23:55",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "late-priority",
        flightNo: "NIGHT1",
        name: "G14",
        remark: "申报",
        fatiguePoints: 5,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, protectedReplacement!.id],
      },
      {
        ...base,
        id: "late-ordinary",
        flightNo: "NIGHT1",
        name: "H06",
        remark: "",
        fatiguePoints: 4,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, protectedReplacement!.id],
      },
    ];
    state.history = [
      {
        id: "previous-repeated-priority",
        date: "2026-11-16",
        flightNo: "NIGHT1",
        position: "G14",
        staffId: repeatedWorker!.id,
        staffName: repeatedWorker!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 5,
        remark: "申报",
      },
      {
        id: "previous-protected-role",
        date: "2026-11-16",
        flightNo: "NIGHT2",
        position: "P01",
        staffId: protectedReplacement!.id,
        staffName: protectedReplacement!.name,
        startTime: "22:10",
        endTime: "00:10",
        workHours: 2,
        fatiguePoints: 5,
        remark: "送资料",
      },
    ];
    const priority = assignment(
      "late-priority-assignment",
      "late-priority",
      "G14",
      repeatedWorker!.id,
      repeatedWorker!.name,
      "申报"
    );
    const ordinary = assignment(
      "late-ordinary-assignment",
      "late-ordinary",
      "H06",
      protectedReplacement!.id,
      protectedReplacement!.name
    );
    [priority, ordinary].forEach((item) => {
      item.flightId = "night-flight";
      item.flightNo = "NIGHT1";
      item.startTime = "21:55";
      item.endTime = "23:55";
    });
    priority.fatiguePoints = 5;
    ordinary.fatiguePoints = 4;
    const assignments = [priority, ordinary];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-11-18",
      new Set()
    );

    expect(priority.staffId).toBe(protectedReplacement!.id);
    expect(ordinary.staffId).toBe(repeatedWorker!.id);
    expect(warnings.join("\n")).toContain("恢复保护");
    expect(priority.decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "position-rotation",
          outcome: "selected",
        }),
        expect.objectContaining({
          ruleId: "late-shift-recovery",
          outcome: "fallback",
        }),
      ])
    );
  });

  it("resolves a second consecutive control assignment before comparing monthly frequency", () => {
    const state = createDefaultState();
    const [repeatedWorker, alternate] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [repeatedWorker!, alternate!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
    });
    disableUnrelatedProtections(state);
    state.flights = [
      {
        id: "flight",
        flightNo: "TEST100",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "control",
        flightNo: "TEST100",
        name: "G18",
        remark: "控制",
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, alternate!.id],
      },
      {
        ...base,
        id: "ordinary",
        flightNo: "TEST100",
        name: "G17",
        remark: "",
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, alternate!.id],
      },
    ];
    state.history = [
      {
        id: "previous-control",
        date: "2026-07-26",
        flightNo: "TEST100",
        position: "G18",
        staffId: repeatedWorker!.id,
        staffName: repeatedWorker!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 6,
        remark: "控制",
      },
      ...["2026-07-20", "2026-07-22"].map((date, index) => ({
        id: `older-control-${index}`,
        date,
        flightNo: "TEST100",
        position: "G18",
        staffId: alternate!.id,
        staffName: alternate!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 6,
        remark: "控制",
      })),
    ];
    const assignments = [
      assignment(
        "control-assignment",
        "control",
        "G18",
        repeatedWorker!.id,
        repeatedWorker!.name,
        "控制"
      ),
      assignment(
        "ordinary-assignment",
        "ordinary",
        "G17",
        alternate!.id,
        alternate!.name
      ),
    ];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-28",
      new Set()
    );

    expect(warnings).toEqual([]);
    expect(
      assignments.find((item) => item.positionRuleId === "control")?.staffId
    ).toBe(alternate!.id);
    expect(
      assignments.find((item) => item.positionRuleId === "ordinary")?.staffId
    ).toBe(repeatedWorker!.id);
    expect(warnings.join("\n")).not.toContain("重点岗位连续轮岗未落实");
  });

  it("swaps an overlapping-flight priority assignment even when the replacement has a general high-load transition", () => {
    const state = createDefaultState();
    const [repeatedWorker, replacementWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [repeatedWorker!, replacementWorker!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
    });
    const priorityRemark = "申报";
    state.settings.nextDutyRestProtectionEnabled = false;
    state.settings.lateShiftRecoveryEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.workloadBalanceEnabled = false;
    state.settings.positionTransitionPolicies = [];
    state.flights = [
      {
        id: "early",
        flightNo: "EARLY1",
        startTime: "06:00",
        endTime: "08:00",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
      {
        id: "ke",
        flightNo: "KE166",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
      {
        id: "cx",
        flightNo: "CX931",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "early-high-load",
        flightNo: "EARLY1",
        name: "E01",
        remark: "",
        fatiguePoints: 6,
        category: "常规",
        qualifiedStaffIds: [replacementWorker!.id],
      },
      {
        ...base,
        id: "ke-declaration",
        flightNo: "KE166",
        name: "H04",
        remark: priorityRemark,
        fatiguePoints: 6,
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, replacementWorker!.id],
      },
      {
        ...base,
        id: "cx-ordinary",
        flightNo: "CX931",
        name: "G15",
        fatiguePoints: 1,
        remark: "",
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, replacementWorker!.id],
      },
    ];
    state.history = [
      {
        id: "previous-ke-declaration",
        date: "2026-07-26",
        flightNo: "KE166",
        position: "H04",
        staffId: repeatedWorker!.id,
        staffName: repeatedWorker!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 6,
        remark: priorityRemark,
      },
    ];
    const early = assignment(
      "early-assignment",
      "early-high-load",
      "E01",
      replacementWorker!.id,
      replacementWorker!.name
    );
    early.flightId = "early";
    early.flightNo = "EARLY1";
    early.startTime = "06:00";
    early.endTime = "08:00";
    early.fatiguePoints = 6;
    const keDeclaration = assignment(
      "ke-declaration-assignment",
      "ke-declaration",
      "H04",
      repeatedWorker!.id,
      repeatedWorker!.name,
      priorityRemark
    );
    keDeclaration.flightId = "ke";
    keDeclaration.flightNo = "KE166";
    const cxOrdinary = assignment(
      "cx-ordinary-assignment",
      "cx-ordinary",
      "G15",
      replacementWorker!.id,
      replacementWorker!.name
    );
    cxOrdinary.flightId = "cx";
    cxOrdinary.flightNo = "CX931";
    const assignments = [early, keDeclaration, cxOrdinary];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-28",
      new Set()
    );

    expect(keDeclaration.staffId).toBe(replacementWorker!.id);
    expect(cxOrdinary.staffId).toBe(repeatedWorker!.id);
    expect(warnings).toEqual([]);
  });
  it("uses an otherwise scheduled but target-time-free qualified worker before reporting a repeated control", () => {
    const state = createDefaultState();
    const [repeatedWorker, freeAtTargetWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [repeatedWorker!, freeAtTargetWorker!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
    });
    disableUnrelatedProtections(state);
    state.flights = [
      {
        id: "early",
        flightNo: "EARLY1",
        startTime: "06:00",
        endTime: "08:00",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
      {
        id: "flight",
        flightNo: "TEST100",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
      {
        id: "late",
        flightNo: "LATE1",
        startTime: "11:00",
        endTime: "13:00",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "early-ordinary",
        flightNo: "EARLY1",
        name: "E01",
        remark: "",
        category: "常规",
        qualifiedStaffIds: [freeAtTargetWorker!.id],
      },
      {
        ...base,
        id: "control",
        flightNo: "TEST100",
        name: "G18",
        remark: "控制",
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, freeAtTargetWorker!.id],
      },
      {
        ...base,
        id: "late-ordinary",
        flightNo: "LATE1",
        name: "L01",
        remark: "",
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id],
      },
    ];
    state.history = [
      {
        id: "previous-control",
        date: "2026-07-26",
        flightNo: "TEST100",
        position: "G18",
        staffId: repeatedWorker!.id,
        staffName: repeatedWorker!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 6,
        remark: "控制",
      },
    ];
    const early = assignment(
      "early-assignment",
      "early-ordinary",
      "E01",
      freeAtTargetWorker!.id,
      freeAtTargetWorker!.name
    );
    early.flightId = "early";
    early.flightNo = "EARLY1";
    early.startTime = "06:00";
    early.endTime = "08:00";
    const control = assignment(
      "control-assignment",
      "control",
      "G18",
      repeatedWorker!.id,
      repeatedWorker!.name,
      "控制"
    );
    const late = assignment(
      "late-assignment",
      "late-ordinary",
      "L01",
      repeatedWorker!.id,
      repeatedWorker!.name
    );
    late.flightId = "late";
    late.flightNo = "LATE1";
    late.startTime = "11:00";
    late.endTime = "13:00";
    const assignments = [early, control, late];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-28",
      new Set()
    );

    expect(control.staffId).toBe(freeAtTargetWorker!.id);
    expect(late.staffId).toBe(repeatedWorker!.id);
    expect(warnings).toEqual([]);
  });

  it("swaps a KE166 mobile-supervisor group with a repeated priority position as one unit", () => {
    const state = createDefaultState();
    const [repeatedSupervisor, repeatedCounterWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [repeatedSupervisor!, repeatedCounterWorker!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
    });
    disableUnrelatedProtections(state);
    state.flights = [
      {
        id: "flight",
        flightNo: "KE166",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    const qualifiedStaffIds = [
      repeatedSupervisor!.id,
      repeatedCounterWorker!.id,
    ];
    state.positionRules = [
      {
        ...base,
        id: "supervisor",
        flightNo: "KE166",
        name: "督导",
        category: "机动督导",
        qualifiedStaffIds,
      },
      {
        ...base,
        id: "bound-counter",
        flightNo: "KE166",
        name: "H03",
        category: "常规",
        qualifiedStaffIds,
      },
      {
        ...base,
        id: "priority-counter",
        flightNo: "KE166",
        name: "H02",
        remark: "一号",
        category: "常规",
        qualifiedStaffIds,
      },
    ];
    state.history = [
      {
        id: "previous-supervisor",
        date: "2026-07-28",
        flightNo: "KE166",
        position: "督导",
        staffId: repeatedSupervisor!.id,
        staffName: repeatedSupervisor!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 5,
        remark: "",
      },
      {
        id: "previous-priority-counter",
        date: "2026-07-28",
        flightNo: "KE166",
        position: "H02",
        staffId: repeatedCounterWorker!.id,
        staffName: repeatedCounterWorker!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 6,
        remark: "一号",
      },
    ];
    const supervisor = assignment(
      "supervisor-assignment",
      "supervisor",
      "督导",
      repeatedSupervisor!.id,
      repeatedSupervisor!.name
    );
    supervisor.flightNo = "KE166";
    supervisor.fatiguePoints = 5;
    const boundCounter = assignment(
      "bound-counter-assignment",
      "bound-counter",
      "H03",
      repeatedSupervisor!.id,
      repeatedSupervisor!.name
    );
    boundCounter.flightNo = "KE166";
    boundCounter.workHours = 0;
    boundCounter.supervisorSourceAssignmentId = supervisor.id;
    const priorityCounter = assignment(
      "priority-counter-assignment",
      "priority-counter",
      "H02",
      repeatedCounterWorker!.id,
      repeatedCounterWorker!.name,
      "一号"
    );
    priorityCounter.flightNo = "KE166";
    const assignments = [supervisor, boundCounter, priorityCounter];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-30",
      new Set([boundCounter.id])
    );

    expect(warnings).toEqual([]);
    expect(supervisor.staffId).toBe(repeatedCounterWorker!.id);
    expect(boundCounter.staffId).toBe(repeatedCounterWorker!.id);
    expect(priorityCounter.staffId).toBe(repeatedSupervisor!.id);
    expect(boundCounter.supervisorSourceAssignmentId).toBe(supervisor.id);
    expect(warnings.join("\n")).not.toContain("连续轮岗未落实");
  });

  it("keeps the KE166 group intact when the replacement lacks a bound-counter qualification", () => {
    const state = createDefaultState();
    const [repeatedSupervisor, candidate] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [repeatedSupervisor!, candidate!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
    });
    disableUnrelatedProtections(state);
    state.flights = [
      {
        id: "flight",
        flightNo: "KE166",
        startTime: "08:30",
        endTime: "10:30",
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
        qualifiedStaffIds: [repeatedSupervisor!.id, candidate!.id],
      },
      {
        ...base,
        id: "bound-counter",
        flightNo: "KE166",
        name: "H03",
        category: "常规",
        qualifiedStaffIds: [repeatedSupervisor!.id],
      },
      {
        ...base,
        id: "priority-counter",
        flightNo: "KE166",
        name: "H02",
        remark: "一号",
        category: "常规",
        qualifiedStaffIds: [repeatedSupervisor!.id, candidate!.id],
      },
    ];
    state.history = [
      {
        id: "previous-supervisor",
        date: "2026-07-28",
        flightNo: "KE166",
        position: "督导",
        staffId: repeatedSupervisor!.id,
        staffName: repeatedSupervisor!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 5,
        remark: "",
      },
    ];
    const supervisor = assignment(
      "supervisor-assignment",
      "supervisor",
      "督导",
      repeatedSupervisor!.id,
      repeatedSupervisor!.name
    );
    supervisor.flightNo = "KE166";
    const boundCounter = assignment(
      "bound-counter-assignment",
      "bound-counter",
      "H03",
      repeatedSupervisor!.id,
      repeatedSupervisor!.name
    );
    boundCounter.flightNo = "KE166";
    boundCounter.workHours = 0;
    boundCounter.supervisorSourceAssignmentId = supervisor.id;
    const priorityCounter = assignment(
      "priority-counter-assignment",
      "priority-counter",
      "H02",
      candidate!.id,
      candidate!.name,
      "一号"
    );
    priorityCounter.flightNo = "KE166";
    const assignments = [supervisor, boundCounter, priorityCounter];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-30",
      new Set([boundCounter.id])
    );

    expect(supervisor.staffId).toBe(repeatedSupervisor!.id);
    expect(boundCounter.staffId).toBe(repeatedSupervisor!.id);
    expect(priorityCounter.staffId).toBe(candidate!.id);
    expect(warnings.join("\n")).toContain(
      "候选人不具备机动督导或兼任柜台的完整资质"
    );
  });

  it("rotates a repeated KE166 priority position through the mobile-supervisor group and a third role", () => {
    const state = createDefaultState();
    const [repeatedWorker, currentSupervisor, thirdWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 3);
    state.staff = [repeatedWorker!, currentSupervisor!, thirdWorker!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
    });
    disableUnrelatedProtections(state);
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
        id: "mobile-supervisor",
        flightNo: "KE166",
        name: "督导",
        category: "机动督导",
        qualifiedStaffIds: [repeatedWorker!.id, currentSupervisor!.id],
      },
      {
        ...base,
        id: "bound-counter",
        flightNo: "KE166",
        name: "H03",
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, currentSupervisor!.id],
      },
      {
        ...base,
        id: "first-counter",
        flightNo: "KE166",
        name: "H02",
        remark: "一号",
        category: "常规",
        qualifiedStaffIds: [repeatedWorker!.id, thirdWorker!.id],
      },
      {
        ...base,
        id: "ordinary-counter",
        flightNo: "KE166",
        name: "H04",
        remark: "",
        category: "常规",
        qualifiedStaffIds: [currentSupervisor!.id, thirdWorker!.id],
      },
    ];
    state.history = [
      {
        id: "previous-first-counter",
        date: "2026-08-15",
        flightNo: "KE166",
        position: "H02",
        staffId: repeatedWorker!.id,
        staffName: repeatedWorker!.name,
        startTime: "09:15",
        endTime: "11:15",
        workHours: 2,
        fatiguePoints: 6,
        remark: "一号",
      },
    ];
    const supervisor = assignment(
      "supervisor-assignment",
      "mobile-supervisor",
      "督导",
      currentSupervisor!.id,
      currentSupervisor!.name
    );
    supervisor.flightId = "ke166";
    supervisor.flightNo = "KE166";
    supervisor.startTime = "09:15";
    supervisor.endTime = "11:15";
    const boundCounter = assignment(
      "bound-counter-assignment",
      "bound-counter",
      "H03",
      currentSupervisor!.id,
      currentSupervisor!.name
    );
    boundCounter.flightId = "ke166";
    boundCounter.flightNo = "KE166";
    boundCounter.startTime = "09:15";
    boundCounter.endTime = "11:15";
    boundCounter.workHours = 0;
    boundCounter.supervisorSourceAssignmentId = supervisor.id;
    const firstCounter = assignment(
      "first-counter-assignment",
      "first-counter",
      "H02",
      repeatedWorker!.id,
      repeatedWorker!.name,
      "一号"
    );
    firstCounter.flightId = "ke166";
    firstCounter.flightNo = "KE166";
    firstCounter.startTime = "09:15";
    firstCounter.endTime = "11:15";
    const ordinaryCounter = assignment(
      "ordinary-counter-assignment",
      "ordinary-counter",
      "H04",
      thirdWorker!.id,
      thirdWorker!.name
    );
    ordinaryCounter.flightId = "ke166";
    ordinaryCounter.flightNo = "KE166";
    ordinaryCounter.startTime = "09:15";
    ordinaryCounter.endTime = "11:15";
    const assignments = [
      supervisor,
      boundCounter,
      firstCounter,
      ordinaryCounter,
    ];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-08-17",
      new Set([boundCounter.id])
    );

    expect(warnings).toEqual([]);
    expect(supervisor.staffId).toBe(repeatedWorker!.id);
    expect(boundCounter.staffId).toBe(repeatedWorker!.id);
    expect(firstCounter.staffId).toBe(thirdWorker!.id);
    expect(ordinaryCounter.staffId).toBe(currentSupervisor!.id);
    expect(boundCounter.supervisorSourceAssignmentId).toBe(supervisor.id);
    expect(
      firstCounter.decisionTrace?.some(
        (decision) =>
          decision.ruleId === "position-rotation" &&
          decision.outcome === "selected"
      )
    ).toBe(true);
  });

  it("repairs repeated KE166 roles after scarce-qualification reservation selected the initial group", () => {
    const state = createDefaultState();
    const [repeatedSupervisor, repeatedCounterWorker, extraWorker] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 3);
    state.staff = [repeatedSupervisor!, repeatedCounterWorker!, extraWorker!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
    });
    disableUnrelatedProtections(state);
    state.flights = [
      {
        id: "ke166",
        flightNo: "KE166",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    const swapQualified = [repeatedSupervisor!.id, repeatedCounterWorker!.id];
    state.positionRules = [
      {
        ...base,
        id: "supervisor",
        flightNo: "KE166",
        name: "督导",
        category: "机动督导",
        qualifiedStaffIds: swapQualified,
      },
      {
        ...base,
        id: "bound-counter",
        flightNo: "KE166",
        name: "H03",
        category: "常规",
        qualifiedStaffIds: swapQualified,
      },
      {
        ...base,
        id: "priority-counter",
        flightNo: "KE166",
        name: "H02",
        remark: "一号",
        category: "常规",
        qualifiedStaffIds: swapQualified,
      },
      {
        ...base,
        id: "extra-counter",
        flightNo: "KE166",
        name: "H04",
        category: "常规",
        qualifiedStaffIds: [repeatedCounterWorker!.id, extraWorker!.id],
      },
    ];
    state.history = [
      {
        id: "previous-supervisor",
        date: "2026-07-28",
        flightNo: "KE166",
        position: "督导",
        staffId: repeatedSupervisor!.id,
        staffName: repeatedSupervisor!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 5,
        remark: "",
      },
      {
        id: "previous-priority-counter",
        date: "2026-07-28",
        flightNo: "KE166",
        position: "H02",
        staffId: repeatedCounterWorker!.id,
        staffName: repeatedCounterWorker!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 6,
        remark: "一号",
      },
    ];

    const result = generateSchedule(state, "2026-07-30");
    const supervisor = result.assignments.find(
      (item) => item.positionRuleId === "supervisor"
    )!;
    const boundCounter = result.assignments.find(
      (item) => item.positionRuleId === "bound-counter"
    )!;
    const priorityCounter = result.assignments.find(
      (item) => item.positionRuleId === "priority-counter"
    )!;

    expect(supervisor.staffId).toBe(repeatedCounterWorker!.id);
    expect(boundCounter).toMatchObject({
      staffId: repeatedCounterWorker!.id,
      supervisorSourceAssignmentId: supervisor.id,
      workHours: 0,
    });
    expect(priorityCounter.staffId).toBe(repeatedSupervisor!.id);
    expect(result.unfilledCount).toBe(0);
    expect(result.warnings.join("\n")).not.toContain("连续轮岗未落实");
  });

  it("uses the shortest four-role cycle when no two-person or three-person priority rotation is safe", () => {
    const state = createDefaultState();
    const workers = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 4);
    state.staff = workers;
    state.staff.forEach((person) => {
      person.dutyQualified = false;
    });
    disableUnrelatedProtections(state);
    state.flights = [
      {
        id: "flight",
        flightNo: "TEST400",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = [
      {
        ...base,
        id: "priority",
        flightNo: "TEST400",
        name: "G20",
        remark: "控制",
        category: "常规",
        qualifiedStaffIds: [workers[0]!.id, workers[1]!.id],
      },
      {
        ...base,
        id: "relay-one",
        flightNo: "TEST400",
        name: "G19",
        remark: "",
        category: "常规",
        qualifiedStaffIds: [workers[1]!.id, workers[2]!.id],
      },
      {
        ...base,
        id: "relay-two",
        flightNo: "TEST400",
        name: "G18",
        remark: "",
        category: "常规",
        qualifiedStaffIds: [workers[2]!.id, workers[3]!.id],
      },
      {
        ...base,
        id: "relay-three",
        flightNo: "TEST400",
        name: "G17",
        remark: "",
        category: "常规",
        qualifiedStaffIds: [workers[3]!.id, workers[0]!.id],
      },
    ];
    state.history = [
      {
        id: "previous-priority",
        date: "2026-07-26",
        flightNo: "TEST400",
        position: "G20",
        staffId: workers[0]!.id,
        staffName: workers[0]!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 6,
        remark: "控制",
      },
    ];
    const assignments = [
      assignment(
        "priority-assignment",
        "priority",
        "G20",
        workers[0]!.id,
        workers[0]!.name,
        "控制"
      ),
      assignment(
        "relay-one-assignment",
        "relay-one",
        "G19",
        workers[1]!.id,
        workers[1]!.name
      ),
      assignment(
        "relay-two-assignment",
        "relay-two",
        "G18",
        workers[2]!.id,
        workers[2]!.name
      ),
      assignment(
        "relay-three-assignment",
        "relay-three",
        "G17",
        workers[3]!.id,
        workers[3]!.name
      ),
    ];
    assignments.forEach((item) => {
      item.flightNo = "TEST400";
    });

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-28",
      new Set()
    );

    expect(warnings).toEqual([]);
    expect(assignments.map((item) => item.staffId)).toEqual([
      workers[1]!.id,
      workers[2]!.id,
      workers[3]!.id,
      workers[0]!.id,
    ]);
    expect(assignments[0]!.decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "position-rotation",
          outcome: "selected",
        }),
      ])
    );
  });

  it("uses a five-role cycle at the configured search boundary", () => {
    const state = createDefaultState();
    const workers = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 5);
    state.staff = workers;
    state.staff.forEach((person) => {
      person.dutyQualified = false;
    });
    disableUnrelatedProtections(state);
    state.flights = [
      {
        id: "flight",
        flightNo: "TEST500",
        startTime: "08:30",
        endTime: "10:30",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    state.positionRules = workers.map((_, index) => ({
      ...base,
      id: `role-${index}`,
      flightNo: "TEST500",
      name: `G${20 - index}`,
      remark: index === 0 ? "申报" : "",
      category: "常规" as const,
      qualifiedStaffIds: [
        workers[index]!.id,
        workers[(index + 1) % workers.length]!.id,
      ],
    }));
    state.history = [
      {
        id: "previous-priority",
        date: "2026-07-26",
        flightNo: "TEST500",
        position: "G20",
        staffId: workers[0]!.id,
        staffName: workers[0]!.name,
        startTime: "08:30",
        endTime: "10:30",
        workHours: 2,
        fatiguePoints: 6,
        remark: "申报",
      },
    ];
    const assignments = workers.map((worker, index) => {
      const item = assignment(
        `assignment-${index}`,
        `role-${index}`,
        `G${20 - index}`,
        worker!.id,
        worker!.name,
        index === 0 ? "申报" : ""
      );
      item.flightNo = "TEST500";
      return item;
    });

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-28",
      new Set()
    );

    expect(warnings).toEqual([]);
    expect(assignments.map((item) => item.staffId)).toEqual([
      workers[1]!.id,
      workers[2]!.id,
      workers[3]!.id,
      workers[4]!.id,
      workers[0]!.id,
    ]);
  });

  it("keeps a qualified regular worker ahead of the team-leader fallback for KE166 rotation", () => {
    const state = createDefaultState();
    const [repeatedSupervisor, regularWorker, teamLeader] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 3);
    state.staff = [repeatedSupervisor!, regularWorker!, teamLeader!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
      person.teamLeader = person.id === teamLeader!.id;
    });
    disableUnrelatedProtections(state);
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
    const supervisorQualified = [
      repeatedSupervisor!.id,
      regularWorker!.id,
      teamLeader!.id,
    ];
    state.positionRules = [
      {
        ...base,
        id: "supervisor",
        flightNo: "KE166",
        name: "督导",
        category: "机动督导",
        qualifiedStaffIds: supervisorQualified,
      },
      {
        ...base,
        id: "bound",
        flightNo: "KE166",
        name: "H03",
        category: "常规",
        qualifiedStaffIds: supervisorQualified,
      },
      {
        ...base,
        id: "regular-role",
        flightNo: "KE166",
        name: "H04",
        category: "常规",
        qualifiedStaffIds: [regularWorker!.id, repeatedSupervisor!.id],
      },
      {
        ...base,
        id: "leader-role",
        flightNo: "KE166",
        name: "H05",
        category: "常规",
        qualifiedStaffIds: [teamLeader!.id],
      },
    ];
    state.history = [
      {
        id: "previous-supervisor",
        date: "2026-07-26",
        flightNo: "KE166",
        position: "督导",
        staffId: repeatedSupervisor!.id,
        staffName: repeatedSupervisor!.name,
        startTime: "09:15",
        endTime: "11:15",
        workHours: 2,
        fatiguePoints: 5,
        remark: "",
      },
    ];
    const supervisor = assignment(
      "supervisor-assignment",
      "supervisor",
      "督导",
      repeatedSupervisor!.id,
      repeatedSupervisor!.name
    );
    const bound = assignment(
      "bound-assignment",
      "bound",
      "H03",
      repeatedSupervisor!.id,
      repeatedSupervisor!.name
    );
    const regularRole = assignment(
      "regular-assignment",
      "regular-role",
      "H04",
      regularWorker!.id,
      regularWorker!.name
    );
    const leaderRole = assignment(
      "leader-assignment",
      "leader-role",
      "H05",
      teamLeader!.id,
      teamLeader!.name
    );
    [supervisor, bound, regularRole, leaderRole].forEach((item) => {
      item.flightId = "ke166";
      item.flightNo = "KE166";
      item.startTime = "09:15";
      item.endTime = "11:15";
    });
    bound.workHours = 0;
    bound.supervisorSourceAssignmentId = supervisor.id;
    const assignments = [supervisor, bound, regularRole, leaderRole];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-28",
      new Set([bound.id])
    );

    expect(warnings).toEqual([]);
    expect(supervisor.staffId).toBe(regularWorker!.id);
    expect(bound.staffId).toBe(regularWorker!.id);
    expect(regularRole.staffId).toBe(repeatedSupervisor!.id);
    expect(leaderRole.staffId).toBe(teamLeader!.id);
  });

  it("uses a fully qualified team leader for KE166 only after regular rotation has no safe solution", () => {
    const state = createDefaultState();
    const [repeatedSupervisor, teamLeader] = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 2);
    state.staff = [repeatedSupervisor!, teamLeader!];
    state.staff.forEach((person) => {
      person.dutyQualified = false;
      person.teamLeader = person.id === teamLeader!.id;
    });
    disableUnrelatedProtections(state);
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
    const both = [repeatedSupervisor!.id, teamLeader!.id];
    state.positionRules = [
      {
        ...base,
        id: "supervisor",
        flightNo: "KE166",
        name: "督导",
        category: "机动督导",
        qualifiedStaffIds: both,
      },
      {
        ...base,
        id: "bound",
        flightNo: "KE166",
        name: "H03",
        category: "常规",
        qualifiedStaffIds: both,
      },
      {
        ...base,
        id: "leader-role",
        flightNo: "KE166",
        name: "H04",
        category: "常规",
        qualifiedStaffIds: both,
      },
    ];
    state.history = [
      {
        id: "previous-supervisor",
        date: "2026-07-26",
        flightNo: "KE166",
        position: "督导",
        staffId: repeatedSupervisor!.id,
        staffName: repeatedSupervisor!.name,
        startTime: "09:15",
        endTime: "11:15",
        workHours: 2,
        fatiguePoints: 5,
        remark: "",
      },
    ];
    const supervisor = assignment(
      "supervisor-assignment",
      "supervisor",
      "督导",
      repeatedSupervisor!.id,
      repeatedSupervisor!.name
    );
    const bound = assignment(
      "bound-assignment",
      "bound",
      "H03",
      repeatedSupervisor!.id,
      repeatedSupervisor!.name
    );
    const leaderRole = assignment(
      "leader-assignment",
      "leader-role",
      "H04",
      teamLeader!.id,
      teamLeader!.name
    );
    [supervisor, bound, leaderRole].forEach((item) => {
      item.flightId = "ke166";
      item.flightNo = "KE166";
      item.startTime = "09:15";
      item.endTime = "11:15";
    });
    bound.workHours = 0;
    bound.supervisorSourceAssignmentId = supervisor.id;
    const assignments = [supervisor, bound, leaderRole];

    const warnings = reviewConsecutivePositionRotation(
      state,
      assignments,
      "2026-07-28",
      new Set([bound.id])
    );

    expect(warnings).toEqual([]);
    expect(supervisor.staffId).toBe(teamLeader!.id);
    expect(bound.staffId).toBe(teamLeader!.id);
    expect(leaderRole.staffId).toBe(repeatedSupervisor!.id);
  });

  it("keeps a priority position from repeating across six generated and archived workdays when safe alternatives exist", () => {
    const state = createDefaultState();
    const workers = state.staff
      .filter((person) => person.status === "正常")
      .slice(0, 4);
    state.staff = workers;
    state.staff.forEach((person) => {
      person.dutyQualified = false;
    });
    disableUnrelatedProtections(state);
    state.flights = [
      {
        id: "flight",
        flightNo: "TEST600",
        startTime: "09:00",
        endTime: "11:00",
        bookedPassengers: 100,
        positions: [],
        remark: "",
      },
    ];
    const base = state.positionRules[0]!;
    const qualifiedStaffIds = workers.map((person) => person.id);
    state.positionRules = [
      {
        ...base,
        id: "priority",
        flightNo: "TEST600",
        name: "G20",
        remark: "一号",
        category: "常规",
        qualifiedStaffIds,
      },
      ...["G19", "G18", "G17"].map((name, index) => ({
        ...base,
        id: `ordinary-${index}`,
        flightNo: "TEST600",
        name,
        remark: "",
        category: "常规" as const,
        qualifiedStaffIds,
      })),
    ];
    const dates = [
      "2026-08-11",
      "2026-08-13",
      "2026-08-15",
      "2026-08-17",
      "2026-08-19",
      "2026-08-21",
    ];
    const priorityStaffIds: string[] = [];

    dates.forEach((date) => {
      const result = generateSchedule(state, date);
      const target = result.assignments.find(
        (item) => item.positionRuleId === "priority"
      )!;
      priorityStaffIds.push(target.staffId!);
      expect(result.unfilledCount).toBe(0);
      expect(result.warnings.join("\n")).not.toContain(
        "重点岗位连续轮岗未落实"
      );
      state.history.push(
        ...result.assignments
          .filter((item) => item.status === "assigned" && item.staffId)
          .map((item) => ({
            id: `history-${date}-${item.id}`,
            date,
            flightNo: item.flightNo,
            position: item.position,
            staffId: item.staffId!,
            staffName: item.staffName,
            startTime: item.startTime,
            endTime: item.endTime,
            workHours: item.workHours,
            fatiguePoints: item.fatiguePoints,
            remark: item.remark,
          }))
      );
    });

    expect(
      priorityStaffIds.every(
        (staffId, index) =>
          index === 0 || staffId !== priorityStaffIds[index - 1]
      )
    ).toBe(true);
  });
});
