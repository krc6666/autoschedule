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
import {
  createTeamLeaderGapFillAssignmentLimitScenario,
  createTeamLeaderGapFillBatchScenario,
  createTeamLeaderGapFillChainScenario,
  createTeamLeaderGapFillFatiguePreferenceScenario,
  createTeamLeaderGapFillGuideChainScenario,
  createTeamLeaderGapFillReservationScenario,
} from "../helpers/scheduling-scenario";

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

function ready(
  result: TeamLeaderGapFillPlanResult
): Extract<TeamLeaderGapFillPlanResult, { kind: "ready" }> {
  expect(result.kind).toBe("ready");
  return result as Extract<TeamLeaderGapFillPlanResult, { kind: "ready" }>;
}

describe("team leader gap fill", () => {
  it("previews a two-step local reassignment without changing the schedule", async () => {
    const { state, leader, worker } = createTeamLeaderGapFillChainScenario();
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
    const { state, leader, worker } = createTeamLeaderGapFillChainScenario();
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
    const { state, leader, workerOne, workerTwo } =
      createTeamLeaderGapFillBatchScenario();

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
      createTeamLeaderGapFillAssignmentLimitScenario({
        chainedVacancyCount: 7,
        includeDirectVacancy: true,
      });

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
      createTeamLeaderGapFillAssignmentLimitScenario({
        chainedVacancyCount: 8,
        includeDirectVacancy: false,
      });

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
      createTeamLeaderGapFillAssignmentLimitScenario({
        chainedVacancyCount: 7,
        includeDirectVacancy: true,
        includeExtraMovable: true,
      });
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
    const { state, leader } = createTeamLeaderGapFillChainScenario({
      prioritySource: true,
    });

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
    const { state, leader, worker } = createTeamLeaderGapFillChainScenario({
      prioritySource: true,
    });
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
    const { state, leader } = createTeamLeaderGapFillChainScenario();
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
    const { state, leader } = createTeamLeaderGapFillChainScenario({
      prioritySource: true,
    });
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
    const { state, leader, worker } =
      createTeamLeaderGapFillGuideChainScenario();

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
    const { state, leader, worker } =
      createTeamLeaderGapFillGuideChainScenario();
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
    const { state, leader, worker } = createTeamLeaderGapFillChainScenario();
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
    const { state, leader, worker } = createTeamLeaderGapFillChainScenario();
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
    const { state, leader, worker } = createTeamLeaderGapFillChainScenario();
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
    const { state, leader, worker } = createTeamLeaderGapFillChainScenario();
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
      createTeamLeaderGapFillReservationScenario();

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
    const { state, leader } = createTeamLeaderGapFillReservationScenario();
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
    const { state, worker } = createTeamLeaderGapFillChainScenario();
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
    const { state, leader } = createTeamLeaderGapFillChainScenario();
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
    const { state, leader } = createTeamLeaderGapFillReservationScenario();
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
    const { state, leader, tired } =
      createTeamLeaderGapFillFatiguePreferenceScenario();

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
    const { state, leader, worker } = createTeamLeaderGapFillChainScenario();
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
    const { state, leader, worker } = createTeamLeaderGapFillChainScenario();
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
    const { state, leader, worker } = createTeamLeaderGapFillChainScenario();
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
