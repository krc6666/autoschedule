import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  applyTeamLeaderGapFillPreview,
  planTeamLeaderGapFill,
  type TeamLeaderGapFillPlanResult,
} from "../../src/domain/coverage/team-leader-gap-fill";
import { reassignmentDynamicSafetyReasons } from "../../src/domain/reviews/reassignment-safety-policy";
import { defaultHighsSolver } from "../../src/infrastructure/solver/highs-solver";
import type { Assignment, Flight, PositionRule, Staff } from "../../src/model";

function person(id: string, teamLeader = false): Staff {
  return {
    id,
    name: teamLeader ? "刘红" : `员工${id}`,
    staffType: "常规",
    teamLeader,
    cxPreflightQualified: false,
    dutyQualified: false,
    standbyQualified: true,
    nightShift: true,
    status: "正常",
    remark: "",
  };
}

function flight(id: string, flightNo: string): Flight {
  return {
    id,
    flightNo,
    startTime: "10:00",
    endTime: "12:00",
    bookedPassengers: 100,
    positions: [],
    remark: "",
  };
}

function rule(
  id: string,
  flightNo: string,
  name: string,
  qualifiedStaffIds: string[]
): PositionRule {
  return {
    id,
    flightNo,
    name,
    category: "常规",
    remark: "",
    qualifiedStaffIds,
    manual: false,
    fatiguePoints: 1,
    minPassengers: 0,
    earlyReleaseMinutes: 0,
  };
}

function assignment(
  targetRule: PositionRule,
  targetFlight: Flight,
  assigned: Staff | null
): Assignment {
  return {
    id: `assignment-${targetRule.id}`,
    flightId: targetFlight.id,
    flightNo: targetFlight.flightNo,
    positionRuleId: targetRule.id,
    position: targetRule.name,
    staffId: assigned?.id ?? null,
    staffName: assigned?.name ?? "",
    startTime: targetFlight.startTime,
    endTime: targetFlight.endTime,
    workHours: 2,
    fatiguePoints: targetRule.fatiguePoints,
    remark: targetRule.remark,
    manualRemark: "",
    status: assigned ? "assigned" : "unfilled",
  };
}

function chainScenario(prioritySource = false) {
  const state = createDefaultState();
  const leader = person("leader", true);
  const worker = person("worker");
  const sourceFlight = flight("ak151", "AK151");
  const vacancyFlight = flight("tr", "TR100");
  const sourceRule = rule("source", "AK151", "G01", [leader.id, worker.id]);
  const vacancyRule = rule("vacancy", "TR100", "G02", [worker.id]);
  state.staff = [leader, worker];
  state.flights = [sourceFlight, vacancyFlight];
  state.positionRules = [sourceRule, vacancyRule];
  state.settings.positionRotationEnabled = false;
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.minimumRegularTransitionMinutes = 0;
  state.settings.ordinaryPriorityPositions = prioritySource
    ? [{ airlineCode: "AK", position: "G01" }]
    : [];
  state.assignments = [
    assignment(sourceRule, sourceFlight, worker),
    assignment(vacancyRule, vacancyFlight, null),
  ];
  state.activeScheduleDate = "2026-09-22";
  return { state, leader, worker };
}

function reservationGapFillScenario() {
  const state = createDefaultState();
  const leader = person("leader", true);
  leader.name = "刘红";
  const reserveWorker = person("reserve-worker");
  reserveWorker.name = "刘燕琼";
  const guideWorker = person("guide-worker");
  guideWorker.name = "叶琳";
  const sourceFlight = flight("ak151", "AK151");
  sourceFlight.startTime = "21:05";
  sourceFlight.endTime = "23:05";
  const vacancyFlight = flight("tr121", "TR121");
  vacancyFlight.startTime = "21:55";
  vacancyFlight.endTime = "23:55";
  const sourceRule = rule("source", "AK151", "G09", [
    reserveWorker.id,
    guideWorker.id,
  ]);
  sourceRule.category = "分流";
  sourceRule.earlyReleaseMinutes = 60;
  const guideRule = rule("guide", "AK151", "引导", []);
  guideRule.category = "分流";
  const vacancyRule = rule("vacancy", "TR121", "收费/引导", [reserveWorker.id]);
  const sourceAssignment = assignment(sourceRule, sourceFlight, reserveWorker);
  sourceAssignment.endTime = "22:05";
  sourceAssignment.workHours = 1;
  const guideAssignment = assignment(guideRule, sourceFlight, guideWorker);
  guideAssignment.workHours = 0;
  guideAssignment.fatiguePoints = 0;
  const vacancyAssignment = assignment(vacancyRule, vacancyFlight, null);
  state.staff = [leader, reserveWorker, guideWorker];
  state.flights = [sourceFlight, vacancyFlight];
  state.positionRules = [sourceRule, guideRule, vacancyRule];
  state.assignments = [sourceAssignment, guideAssignment, vacancyAssignment];
  state.activeScheduleDate = "2026-09-27";
  state.settings.positionRotationEnabled = false;
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.minimumRegularTransitionMinutes = 0;
  state.settings.ordinaryPriorityPositions = [];
  state.settings.teamLeaderGapFillPositionPolicies = [
    { flightNo: "AK151", position: "G09", movable: true },
  ];
  state.settings.crossWorkdayQualificationReservations = [
    {
      id: "reserve-tr121-guide",
      enabled: true,
      flightNo: "TR121",
      matchField: "position",
      keyword: "收费/引导",
      minimumStaffCount: 1,
    },
  ];
  state.settings.lateShiftEndTime = "23:00";
  return { state, leader, reserveWorker, guideWorker };
}

function guideChainScenario() {
  const { state, leader, worker } = chainScenario();
  const sourceRule = state.positionRules.find((item) => item.id === "source")!;
  sourceRule.category = "引导";
  sourceRule.qualifiedStaffIds = [];
  const source = state.assignments.find(
    (item) => item.id === "assignment-source"
  )!;
  source.workHours = 0;
  source.fatiguePoints = 0;
  return { state, leader, worker };
}

function addPreviousLatePriorityHistory(
  state: ReturnType<typeof createDefaultState>,
  staff: Staff,
  fatiguePoints = 10
): void {
  state.history = [
    {
      id: `history-${staff.id}`,
      date: "2026-09-21",
      flightNo: "TR121",
      position: "H02",
      staffId: staff.id,
      staffName: staff.name,
      startTime: "21:55",
      endTime: "23:55",
      workHours: 2,
      fatiguePoints,
      remark: "一号",
    },
  ];
  state.settings.lateShiftRecoveryPositionRules = [
    {
      id: "test-late-recovery-one",
      enabled: true,
      flightNo: "",
      matchField: "remark",
      keyword: "一号",
      nextWorkdayCutoffTime: "09:00",
    },
  ];
}

function addEarlierHighLoadAssignment(
  state: ReturnType<typeof createDefaultState>,
  worker: Staff
): void {
  const earlierFlight = flight("earlier-load", "FD573");
  earlierFlight.startTime = "06:00";
  earlierFlight.endTime = "08:00";
  const earlierRule = rule("earlier-load", "FD573", "G09", [worker.id]);
  earlierRule.fatiguePoints = 4;
  state.flights.push(earlierFlight);
  state.positionRules.push(earlierRule);
  state.assignments.push(assignment(earlierRule, earlierFlight, worker));

  const vacancyRule = state.positionRules.find(
    (item) => item.id === "vacancy"
  )!;
  const vacancy = state.assignments.find(
    (item) => item.id === "assignment-vacancy"
  )!;
  vacancyRule.fatiguePoints = 4;
  vacancy.fatiguePoints = 4;
  state.settings.highLoadFatigueThreshold = 4;
  state.settings.highLoadRecoveryMinutes = 360;
  state.settings.rollingLoadWindowMinutes = 360;
  state.settings.rollingLoadMaxFatigue = 7;
}

function batchScenario() {
  const state = createDefaultState();
  const leader = person("leader", true);
  const workerOne = person("worker-one");
  const workerTwo = person("worker-two");
  const workerThree = person("worker-three");
  const sourceFlightOne = flight("ak151", "AK151");
  const vacancyFlightOne = flight("tr100", "TR100");
  const sourceFlightTwo = flight("ak152", "AK152");
  const vacancyFlightTwo = flight("tr200", "TR200");
  const sourceFlightThree = flight("ak153", "AK153");
  const vacancyFlightThree = flight("tr300", "TR300");
  sourceFlightTwo.startTime = "13:00";
  sourceFlightTwo.endTime = "15:00";
  vacancyFlightTwo.startTime = "13:00";
  vacancyFlightTwo.endTime = "15:00";
  sourceFlightThree.startTime = "16:00";
  sourceFlightThree.endTime = "18:00";
  vacancyFlightThree.startTime = "16:00";
  vacancyFlightThree.endTime = "18:00";
  const sourceRuleOne = rule("source-one", "AK151", "G01", [
    leader.id,
    workerOne.id,
  ]);
  const vacancyRuleOne = rule("vacancy-one", "TR100", "G02", [workerOne.id]);
  const sourceRuleTwo = rule("source-two", "AK152", "G01", [
    leader.id,
    workerTwo.id,
  ]);
  const vacancyRuleTwo = rule("vacancy-two", "TR200", "G02", [workerTwo.id]);
  const sourceRuleThree = rule("source-three", "AK153", "G01", [
    leader.id,
    workerThree.id,
  ]);
  const vacancyRuleThree = rule("vacancy-three", "TR300", "G02", [
    workerThree.id,
  ]);
  state.staff = [leader, workerOne, workerTwo, workerThree];
  state.flights = [
    sourceFlightOne,
    vacancyFlightOne,
    sourceFlightTwo,
    vacancyFlightTwo,
    sourceFlightThree,
    vacancyFlightThree,
  ];
  state.positionRules = [
    sourceRuleOne,
    vacancyRuleOne,
    sourceRuleTwo,
    vacancyRuleTwo,
    sourceRuleThree,
    vacancyRuleThree,
  ];
  state.settings.positionRotationEnabled = false;
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.minimumRegularTransitionMinutes = 0;
  state.assignments = [
    assignment(sourceRuleOne, sourceFlightOne, workerOne),
    assignment(vacancyRuleOne, vacancyFlightOne, null),
    assignment(sourceRuleTwo, sourceFlightTwo, workerTwo),
    assignment(vacancyRuleTwo, vacancyFlightTwo, null),
    assignment(sourceRuleThree, sourceFlightThree, workerThree),
    assignment(vacancyRuleThree, vacancyFlightThree, null),
  ];
  state.activeScheduleDate = "2026-09-22";
  return { state, leader, workerOne, workerTwo, workerThree };
}

function changedAssignmentLimitScenario(
  chainedVacancyCount: number,
  includeDirectVacancy: boolean,
  includeExtraMovable = false
) {
  const state = createDefaultState();
  const leader = person("leader", true);
  const workers = Array.from({ length: chainedVacancyCount }, (_, index) =>
    person(`worker-${index + 1}`)
  );
  const flights: Flight[] = [];
  const rules: PositionRule[] = [];
  const assignments: Assignment[] = [];
  const vacancyAssignmentIds: string[] = [];

  workers.forEach((worker, index) => {
    const startHour = 6 + index * 2;
    const sourceFlight = flight(`source-flight-${index}`, `AK${index + 1}`);
    const vacancyFlight = flight(`vacancy-flight-${index}`, `TR${index + 1}`);
    sourceFlight.startTime =
      vacancyFlight.startTime = `${String(startHour).padStart(2, "0")}:00`;
    sourceFlight.endTime =
      vacancyFlight.endTime = `${String(startHour + 2).padStart(2, "0")}:00`;
    const sourceRule = rule(`source-${index}`, sourceFlight.flightNo, "G01", [
      leader.id,
      worker.id,
    ]);
    const vacancyRule = rule(
      `vacancy-${index}`,
      vacancyFlight.flightNo,
      "G02",
      [worker.id]
    );
    flights.push(sourceFlight, vacancyFlight);
    rules.push(sourceRule, vacancyRule);
    assignments.push(
      assignment(sourceRule, sourceFlight, worker),
      assignment(vacancyRule, vacancyFlight, null)
    );
    vacancyAssignmentIds.push(`assignment-${vacancyRule.id}`);
  });

  let extraMovable: Assignment | null = null;
  if (includeDirectVacancy) {
    const directFlight = flight("direct-flight", "DIRECT");
    directFlight.startTime = "22:00";
    directFlight.endTime = "23:00";
    const directRule = rule("direct-vacancy", "DIRECT", "G03", [leader.id]);
    flights.push(directFlight);
    rules.push(directRule);
    assignments.push(assignment(directRule, directFlight, null));
    vacancyAssignmentIds.push("assignment-direct-vacancy");

    if (includeExtraMovable) {
      const extraWorker = person("extra-worker");
      state.staff = [leader, ...workers, extraWorker];
      const extraRule = rule("extra-movable", "DIRECT", "G04", [
        extraWorker.id,
        workers[0]!.id,
      ]);
      rules.push(extraRule);
      extraMovable = assignment(extraRule, directFlight, extraWorker);
      assignments.push(extraMovable);
    }
  }

  if (!state.staff.some((staff) => staff.id === leader.id))
    state.staff = [leader, ...workers];
  state.flights = flights;
  state.positionRules = rules;
  state.assignments = assignments;
  state.activeScheduleDate = "2026-09-22";
  state.settings.maxDailyHours = 24;
  state.settings.positionRotationEnabled = false;
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.minimumRegularTransitionMinutes = 0;
  state.settings.ordinaryPriorityPositions = [];
  return { state, leader, workers, vacancyAssignmentIds, extraMovable };
}

function ready(
  result: TeamLeaderGapFillPlanResult
): Extract<TeamLeaderGapFillPlanResult, { kind: "ready" }> {
  expect(result.kind).toBe("ready");
  return result as Extract<TeamLeaderGapFillPlanResult, { kind: "ready" }>;
}

describe("team leader gap fill", () => {
  it("previews a two-step local reassignment without changing the schedule", async () => {
    const { state, leader, worker } = chainScenario();
    const before = structuredClone(state.assignments);

    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds: ["assignment-vacancy"],
      })
    );

    expect(state.assignments).toEqual(before);
    expect(result.preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: "assignment-source",
          fromStaffId: worker.id,
          toStaffId: leader.id,
        }),
        expect.objectContaining({
          assignmentId: "assignment-vacancy",
          fromStaffId: null,
          toStaffId: worker.id,
        }),
      ])
    );
  });

  it("keeps a non-overlapping source job available for a qualification chain", async () => {
    const { state, leader, worker } = chainScenario();
    const vacancyFlight = state.flights.find((item) => item.id === "tr")!;
    vacancyFlight.startTime = "14:00";
    vacancyFlight.endTime = "16:00";
    const vacancy = state.assignments.find(
      (item) => item.id === "assignment-vacancy"
    )!;
    expect(
      state.positionRules.find((item) => item.id === vacancy.positionRuleId)
        ?.qualifiedStaffIds
    ).not.toContain(leader.id);
    vacancy.startTime = vacancyFlight.startTime;
    vacancy.endTime = vacancyFlight.endTime;

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-22",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: [vacancy.id],
    });

    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind === "ready") {
      expect(result.preview.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assignmentId: "assignment-source",
            fromStaffId: worker.id,
            toStaffId: leader.id,
          }),
          expect.objectContaining({
            assignmentId: "assignment-vacancy",
            fromStaffId: null,
            toStaffId: worker.id,
          }),
        ])
      );
    }
  });

  it("solves multiple selected vacancies as one atomic overall plan", async () => {
    const { state, leader, workerOne, workerTwo } = batchScenario();

    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds: [
          "assignment-vacancy-one",
          "assignment-vacancy-two",
        ],
      })
    );

    expect(result.preview.vacancyAssignmentIds).toEqual([
      "assignment-vacancy-one",
      "assignment-vacancy-two",
    ]);
    expect(result.preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: "assignment-source-one",
          fromStaffId: workerOne.id,
          toStaffId: leader.id,
        }),
        expect.objectContaining({
          assignmentId: "assignment-vacancy-one",
          fromStaffId: null,
          toStaffId: workerOne.id,
        }),
        expect.objectContaining({
          assignmentId: "assignment-source-two",
          fromStaffId: workerTwo.id,
          toStaffId: leader.id,
        }),
        expect.objectContaining({
          assignmentId: "assignment-vacancy-two",
          fromStaffId: null,
          toStaffId: workerTwo.id,
        }),
      ])
    );
    expect(
      new Set(result.preview.changes.map((change) => change.assignmentId)).size
    ).toBe(4);
  });

  it("allows an atomic plan that changes exactly fifteen jobs", async () => {
    const { state, leader, vacancyAssignmentIds } =
      changedAssignmentLimitScenario(7, true);

    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds,
      })
    );

    expect(
      new Set(result.preview.changes.map((change) => change.assignmentId)).size
    ).toBe(15);
  });

  it("allows a batch over the fifteen-job recommendation with a yellow warning", async () => {
    const { state, leader, vacancyAssignmentIds } =
      changedAssignmentLimitScenario(8, false);

    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds,
      })
    );

    expect(
      new Set(result.preview.changes.map((change) => change.assignmentId)).size
    ).toBe(16);
    expect(result.preview.warnings.join("；")).toContain(
      "超过建议上限15个岗位"
    );
  });

  it("confirms a preview expanded beyond the fifteen-job recommendation", async () => {
    const { state, leader, workers, vacancyAssignmentIds, extraMovable } =
      changedAssignmentLimitScenario(7, true, true);
    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds,
      })
    );
    expect(result.preview.changes).toHaveLength(15);

    const expandedPreview = {
      ...result.preview,
      changes: [
        ...result.preview.changes,
        {
          assignmentId: extraMovable!.id,
          flightNo: extraMovable!.flightNo,
          position: extraMovable!.position,
          fromStaffId: extraMovable!.staffId,
          fromStaffName: extraMovable!.staffName,
          toStaffId: workers[0]!.id,
          toStaffName: workers[0]!.name,
          workHours: extraMovable!.workHours,
        },
      ],
    };

    expect(applyTeamLeaderGapFillPreview(state, expandedPreview)).toMatchObject(
      {
        kind: "applied",
      }
    );
  });

  it("does not move an already assigned priority position", async () => {
    const { state, leader } = chainScenario(true);

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-22",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: ["assignment-vacancy"],
    });

    expect(result).toMatchObject({ kind: "unavailable" });
    expect(
      (
        result as Extract<TeamLeaderGapFillPlanResult, { kind: "unavailable" }>
      ).reasons.join("；")
    ).toMatch(/附近另有保护岗.*员工worker.*AK151\/G01/);
  });

  it("allows an explicitly released ordinary priority position to join the chain", async () => {
    const { state, leader, worker } = chainScenario(true);
    Object.assign(state.settings, {
      teamLeaderGapFillPositionPolicies: [
        { flightNo: "AK151", position: "G01", movable: true },
      ],
    });

    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds: ["assignment-vacancy"],
      })
    );

    expect(result.preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: "assignment-source",
          fromStaffId: worker.id,
          toStaffId: leader.id,
        }),
      ])
    );
  });

  it("keeps fixed KE166 protection even when its position is configured movable", async () => {
    const { state, leader } = chainScenario();
    const sourceFlight = state.flights.find((item) => item.id === "ak151")!;
    const sourceRule = state.positionRules.find(
      (item) => item.id === "source"
    )!;
    const sourceAssignment = state.assignments.find(
      (item) => item.id === "assignment-source"
    )!;
    sourceFlight.flightNo = "KE166";
    sourceRule.flightNo = "KE166";
    sourceAssignment.flightNo = "KE166";
    Object.assign(state.settings, {
      teamLeaderGapFillPositionPolicies: [
        { flightNo: "KE166", position: "G01", movable: true },
      ],
    });

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-22",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: ["assignment-vacancy"],
    });

    expect(result).toMatchObject({ kind: "unavailable" });
    if (result.kind === "unavailable")
      expect(result.reasons.join("；")).toContain("KE166岗位");
  });

  it("rejects confirmation if a previewed source position becomes protected", async () => {
    const { state, leader } = chainScenario(true);
    Object.assign(state.settings, {
      teamLeaderGapFillPositionPolicies: [
        { flightNo: "AK151", position: "G01", movable: true },
      ],
    });
    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds: ["assignment-vacancy"],
      })
    );

    Object.assign(state.settings, {
      teamLeaderGapFillPositionPolicies: [
        { flightNo: "AK151", position: "G01", movable: false },
      ],
    });

    expect(applyTeamLeaderGapFillPreview(state, result.preview)).toMatchObject({
      kind: "rejected",
    });
  });

  it("allows a guide assignment to be replaced by the team leader in gap fill", async () => {
    const { state, leader, worker } = guideChainScenario();

    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds: ["assignment-vacancy"],
      })
    );

    expect(result.preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: "assignment-source",
          fromStaffId: worker.id,
          toStaffId: leader.id,
        }),
        expect.objectContaining({
          assignmentId: "assignment-vacancy",
          fromStaffId: null,
          toStaffId: worker.id,
        }),
      ])
    );
  });

  it("allows a diversion-category guide assignment to be replaced by the team leader", async () => {
    const { state, leader, worker } = guideChainScenario();
    const sourceRule = state.positionRules.find(
      (item) => item.id === "source"
    )!;
    sourceRule.category = "分流";
    sourceRule.name = "引导";

    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds: ["assignment-vacancy"],
      })
    );

    expect(result.preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: "assignment-source",
          fromStaffId: worker.id,
          toStaffId: leader.id,
        }),
        expect.objectContaining({
          assignmentId: "assignment-vacancy",
          fromStaffId: null,
          toStaffId: worker.id,
        }),
      ])
    );
  });

  it("allows a current late-priority assignment to move in gap fill", async () => {
    const { state, leader, worker } = chainScenario();
    const sourceRule = state.positionRules.find(
      (item) => item.id === "source"
    )!;
    sourceRule.remark = "一号";

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-22",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: ["assignment-vacancy"],
    });

    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind === "ready") {
      expect(result.preview.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assignmentId: "assignment-source",
            fromStaffId: worker.id,
            toStaffId: leader.id,
          }),
          expect.objectContaining({
            assignmentId: "assignment-vacancy",
            fromStaffId: null,
            toStaffId: worker.id,
          }),
        ])
      );
    }
  });

  it("allows a recovery-protected worker in gap fill with a concrete warning", async () => {
    const { state, leader, worker } = chainScenario();
    addPreviousLatePriorityHistory(state, worker);

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-22",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: ["assignment-vacancy"],
    });

    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind === "ready") {
      expect(result.preview).toHaveProperty("warnings");
      expect(result.preview.warnings.join("；")).toMatch(
        /员工worker|2026-09-21|一号|恢复|10:00-12:00/
      );
      expect(
        applyTeamLeaderGapFillPreview(state, result.preview)
      ).toMatchObject({
        kind: "applied",
      });
    }
  });

  it("allows high-load fatigue protection to yield only in gap fill with a concrete warning", async () => {
    const { state, leader, worker } = chainScenario();
    addEarlierHighLoadAssignment(state, worker);
    state.settings.highLoadProtectionEnabled = true;
    state.settings.rollingLoadProtectionEnabled = false;

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-22",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: ["assignment-vacancy"],
    });

    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind === "ready") {
      expect(result.preview.warnings.join("；")).toMatch(
        /员工worker.*TR100\/G02.*10:00-12:00.*高负荷疲劳保护/
      );
      expect(
        applyTeamLeaderGapFillPreview(state, result.preview)
      ).toMatchObject({
        kind: "applied",
      });
    }
  });

  it("allows rolling-load protection to yield only in gap fill with a concrete warning", async () => {
    const { state, leader, worker } = chainScenario();
    addEarlierHighLoadAssignment(state, worker);
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = true;

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-22",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: ["assignment-vacancy"],
    });

    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind === "ready") {
      expect(result.preview.warnings.join("；")).toMatch(
        /员工worker.*TR100\/G02.*10:00-12:00.*滚动负荷保护/
      );
      expect(
        applyTeamLeaderGapFillPreview(state, result.preview)
      ).toMatchObject({
        kind: "applied",
      });
    }
  });

  it("allows the 9/27 three-step chain to yield cross-workday qualification reservation with a concrete warning", async () => {
    const { state, leader, reserveWorker, guideWorker } =
      reservationGapFillScenario();

    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-27",
        teamLeaderId: leader.id,
        vacancyAssignmentIds: ["assignment-vacancy"],
      })
    );

    expect(result.preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: "assignment-vacancy",
          fromStaffId: null,
          toStaffId: reserveWorker.id,
        }),
        expect.objectContaining({
          assignmentId: "assignment-source",
          fromStaffId: reserveWorker.id,
          toStaffId: guideWorker.id,
        }),
        expect.objectContaining({
          assignmentId: "assignment-guide",
          fromStaffId: guideWorker.id,
          toStaffId: leader.id,
        }),
      ])
    );
    expect(result.preview.warnings.join("；")).toMatch(
      /TR121\/收费\/引导.*至少保留1名.*刘燕琼.*刘燕琼.*23:55.*1.*0/
    );
    expect(applyTeamLeaderGapFillPreview(state, result.preview)).toMatchObject({
      kind: "applied",
    });
  });

  it("prefers a strict plan that preserves qualification reservation when one exists", async () => {
    const { state, leader } = reservationGapFillScenario();
    const alternate = person("already-consumed");
    alternate.name = "华嘉慧";
    state.staff.push(alternate);
    const vacancyRule = state.positionRules.find(
      (item) => item.id === "vacancy"
    )!;
    vacancyRule.qualifiedStaffIds.push(alternate.id);
    const lateSourceRule = rule("late-source", "TR121", "H08", [
      leader.id,
      alternate.id,
    ]);
    state.positionRules.push(lateSourceRule);
    const lateSourceFlight = state.flights.find((item) => item.id === "tr121")!;
    state.assignments.push(
      assignment(lateSourceRule, lateSourceFlight, alternate)
    );

    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-27",
        teamLeaderId: leader.id,
        vacancyAssignmentIds: ["assignment-vacancy"],
      })
    );

    expect(result.preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: "assignment-vacancy",
          toStaffId: alternate.id,
        }),
        expect.objectContaining({
          assignmentId: "assignment-late-source",
          toStaffId: leader.id,
        }),
      ])
    );
    expect(result.preview.warnings.join("；")).not.toContain("资质预留");
    expect(result.preview.warnings.join("；")).not.toContain("预留人数从");
  });

  it("keeps load protection hard when a caller does not open the gap-fill relief", () => {
    const { state, worker } = chainScenario();
    addEarlierHighLoadAssignment(state, worker);
    state.settings.highLoadProtectionEnabled = true;
    state.settings.rollingLoadProtectionEnabled = true;
    const target = {
      ...state.assignments.find((item) => item.id === "assignment-vacancy")!,
      staffId: worker.id,
      staffName: worker.name,
      status: "assigned" as const,
    };
    const earlier = state.assignments.find(
      (item) => item.id === "assignment-earlier-load"
    )!;

    expect(
      reassignmentDynamicSafetyReasons({
        state,
        assignments: [earlier, target],
        assignment: target,
        primaryAssignment: target,
        review: "coverage",
      })
    ).toEqual(
      expect.arrayContaining([
        "交换后违反高负荷疲劳保护",
        "交换后违反滚动负荷保护",
      ])
    );
  });

  it("keeps a real time conflict as a hard rejection with concrete person and time", async () => {
    const { state, leader } = chainScenario();
    const conflictFlight = flight("conflict", "CX999");
    const conflictRule = rule("conflict", "CX999", "G09", [leader.id]);
    state.flights.push(conflictFlight);
    state.positionRules.push(conflictRule);
    const conflictAssignment = assignment(conflictRule, conflictFlight, leader);
    conflictAssignment.layoutGroup = "primary";
    state.assignments.push(conflictAssignment);

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-22",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: ["assignment-vacancy"],
    });

    expect(result).toMatchObject({ kind: "unavailable" });
    if (result.kind === "unavailable") {
      expect(result.reasons[0]).toMatch(
        /刘红.*AK151\/G01.*10:00-12:00.*时间冲突/
      );
      expect(result.reasons.join("；")).toMatch(/刘红|10:00-12:00|时间冲突/);
    }
  });

  it("does not bypass a protected position when reservation relief is available", async () => {
    const { state, leader } = reservationGapFillScenario();
    state.settings.teamLeaderGapFillPositionPolicies.push({
      flightNo: "AK151",
      position: "引导",
      movable: false,
    });

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-27",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: ["assignment-vacancy"],
    });

    expect(result).toMatchObject({ kind: "unavailable" });
    if (result.kind === "unavailable") {
      expect(result.reasons.join("；")).toMatch(/AK151\/引导.*规则页.*保护/);
      expect(result.reasons.join("；")).not.toContain("黄灯");
    }
  });

  it("prefers the lighter current late assignment for the worker with the heavier previous workday", async () => {
    const state = createDefaultState();
    const leader = person("leader", true);
    const tired = person("tired");
    const rested = person("rested");
    const sourceFlight = flight("source", "AK151");
    sourceFlight.startTime = "21:05";
    sourceFlight.endTime = "23:55";
    const lighterFlight = flight("lighter", "TR100");
    lighterFlight.startTime = "21:55";
    lighterFlight.endTime = "23:15";
    const sourceRule = rule("source", "AK151", "G08", [leader.id, tired.id]);
    sourceRule.fatiguePoints = 8;
    const otherRule = rule("other", "AK151", "G09", [leader.id, rested.id]);
    otherRule.fatiguePoints = 3;
    const vacancyRule = rule("vacancy", "TR100", "H08", [tired.id, rested.id]);
    vacancyRule.fatiguePoints = 1;
    state.staff = [leader, tired, rested];
    state.flights = [sourceFlight, lighterFlight];
    state.positionRules = [sourceRule, otherRule, vacancyRule];
    state.settings.positionRotationEnabled = false;
    state.settings.highLoadProtectionEnabled = false;
    state.settings.rollingLoadProtectionEnabled = false;
    state.settings.minimumRegularTransitionMinutes = 0;
    state.assignments = [
      assignment(sourceRule, sourceFlight, tired),
      assignment(otherRule, sourceFlight, rested),
      assignment(vacancyRule, lighterFlight, null),
    ];
    state.history = [
      {
        id: "history-tired",
        date: "2026-09-21",
        flightNo: "TR121",
        position: "H02",
        staffId: tired.id,
        staffName: tired.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 10,
        remark: "一号",
      },
      {
        id: "history-rested",
        date: "2026-09-21",
        flightNo: "CX937",
        position: "G12",
        staffId: rested.id,
        staffName: rested.name,
        startTime: "09:00",
        endTime: "10:00",
        workHours: 1,
        fatiguePoints: 1,
        remark: "",
      },
    ];
    state.activeScheduleDate = "2026-09-22";

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-22",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: ["assignment-vacancy"],
    });

    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind === "ready") {
      expect(result.preview.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            assignmentId: "assignment-vacancy",
            fromStaffId: null,
            toStaffId: tired.id,
          }),
          expect.objectContaining({
            assignmentId: "assignment-source",
            fromStaffId: tired.id,
            toStaffId: leader.id,
          }),
        ])
      );
      expect(result.preview.warnings.join("；")).not.toMatch(/相对疲劳/);
    }
  });

  it("keeps the only complete plan when relative fatigue cannot improve and explains the yellow light", async () => {
    const { state, leader, worker } = chainScenario();
    const sourceFlight = state.flights.find((item) => item.id === "ak151")!;
    const vacancyFlight = state.flights.find((item) => item.id === "tr")!;
    const sourceRule = state.positionRules.find(
      (item) => item.id === "source"
    )!;
    const vacancyRule = state.positionRules.find(
      (item) => item.id === "vacancy"
    )!;
    const sourceAssignment = state.assignments.find(
      (item) => item.id === "assignment-source"
    )!;
    const vacancyAssignment = state.assignments.find(
      (item) => item.id === "assignment-vacancy"
    )!;
    sourceFlight.startTime = sourceAssignment.startTime = "21:05";
    sourceFlight.endTime = sourceAssignment.endTime = "23:05";
    vacancyFlight.startTime = vacancyAssignment.startTime = "21:55";
    vacancyFlight.endTime = vacancyAssignment.endTime = "23:55";
    sourceRule.fatiguePoints = sourceAssignment.fatiguePoints = 1;
    vacancyRule.fatiguePoints = vacancyAssignment.fatiguePoints = 8;
    addPreviousLatePriorityHistory(state, worker);
    state.settings.lateShiftRecoveryEnabled = false;

    const result = await planTeamLeaderGapFill({
      solver: defaultHighsSolver,
      state,
      date: "2026-09-22",
      teamLeaderId: leader.id,
      vacancyAssignmentIds: ["assignment-vacancy"],
    });

    expect(result).toMatchObject({ kind: "ready" });
    if (result.kind === "ready") {
      expect(result.preview.warnings.join("；")).toMatch(
        /员工worker上一工作班更需要休息.*刘红.*更重.*未找到/
      );
      expect(
        applyTeamLeaderGapFillPreview(state, result.preview)
      ).toMatchObject({
        kind: "applied",
      });
    }
  });

  it("does not compare an early source assignment as part of the current late segment", async () => {
    const { state, leader, worker } = chainScenario();
    const vacancyFlight = state.flights.find((item) => item.id === "tr")!;
    const vacancyAssignment = state.assignments.find(
      (item) => item.id === "assignment-vacancy"
    )!;
    vacancyFlight.startTime = vacancyAssignment.startTime = "21:55";
    vacancyFlight.endTime = vacancyAssignment.endTime = "23:55";
    addPreviousLatePriorityHistory(state, worker);
    state.settings.lateShiftRecoveryEnabled = false;

    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds: ["assignment-vacancy"],
      })
    );

    expect(result.preview.warnings.join("；")).not.toContain(
      "上一工作班更需要休息"
    );
  });

  it("applies the whole preview and rejects it after the schedule changes", async () => {
    const { state, leader, worker } = chainScenario();
    const result = ready(
      await planTeamLeaderGapFill({
        solver: defaultHighsSolver,
        state,
        date: "2026-09-22",
        teamLeaderId: leader.id,
        vacancyAssignmentIds: ["assignment-vacancy"],
      })
    );

    const applied = applyTeamLeaderGapFillPreview(state, result.preview);
    expect(applied).toMatchObject({ kind: "applied" });
    if (applied.kind === "applied") {
      expect(applied.assignments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "assignment-source",
            staffId: leader.id,
            teamLeaderGapFill: true,
          }),
          expect.objectContaining({
            id: "assignment-vacancy",
            staffId: worker.id,
            status: "assigned",
          }),
        ])
      );
    }
    expect(state.assignments[0]!.staffId).toBe(worker.id);

    state.assignments[0]!.manualRemark = "班表已被人工调整";
    expect(applyTeamLeaderGapFillPreview(state, result.preview)).toMatchObject({
      kind: "rejected",
    });
  });
});
