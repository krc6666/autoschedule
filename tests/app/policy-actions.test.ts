import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import {
  addDutyPriority,
  addLateShiftRecoveryPositionRule,
  addMobileSupervisorCoverageRule,
  addNextWorkdayRecoveryTarget,
  addTransitionPolicy,
  applySchedulePolicy,
  deleteDutyPriority,
  deleteMobileSupervisorCoverageRule,
  deleteNextWorkdayRecoveryTarget,
  deleteLateShiftRecoveryPositionRule,
  deleteTransitionPolicy,
  moveDutyPriority,
  updateDutyPriority,
  updateNextWorkdayRecoveryTarget,
  updateLateShiftRecoveryPositionRule,
  updatePolicyEntityField,
  type SchedulePolicyInput,
} from "../../src/app/policy-actions";

const input: SchedulePolicyInput = {
  highLoadProtectionEnabled: true,
  highLoadFatigueThreshold: Number.NaN,
  highLoadRecoveryMinutes: 2000,
  remarkedPositionHighLoad: true,
  rollingLoadProtectionEnabled: true,
  rollingLoadWindowMinutes: 360,
  rollingLoadMaxFatigue: 8,
  positionRotationEnabled: true,
  lateShiftRecoveryEnabled: true,
  lateShiftEndTime: "",
  teamLeaderConcurrentSupervisionMaxOverlapMinutes: 1000,
  workloadBalanceEnabled: true,
  maxWorkHoursDifference: 2,
  maxTodayFatigueDifference: 4,
  dutyFatiguePoints: 60,
  earlyDepartureCutoffTime: "",
  afternoonRestStartTime: "",
  afternoonRestEndTime: "",
};

function addActiveSchedule(state: ReturnType<typeof createDefaultState>): void {
  state.assignments = [
    {
      id: "assignment",
      flightId: "flight",
      flightNo: "TR121",
      positionRuleId: null,
      position: "临时岗位",
      staffId: null,
      staffName: "",
      startTime: "20:00",
      endTime: "21:00",
      workHours: 0,
      fatiguePoints: 0,
      remark: "",
      manualRemark: "",
      status: "manual",
    },
  ];
}

describe("policy actions", () => {
  it("normalizes settings explicitly and marks an existing schedule stale without regenerating it", () => {
    const state = createDefaultState();
    state.settings.dutyPositionPriorities[0]!.flightNo = " tr121 ";
    state.assignments = [
      {
        id: "assignment",
        flightId: "flight",
        flightNo: "TR121",
        positionRuleId: null,
        position: "临时岗位",
        staffId: null,
        staffName: "",
        startTime: "20:00",
        endTime: "21:00",
        workHours: 0,
        fatiguePoints: 0,
        remark: "",
        manualRemark: "",
        status: "manual",
      },
    ];

    expect(applySchedulePolicy(state, input)).toBe(true);
    expect(state.schedulePolicyStale).toBe(true);
    expect(state.assignments).toHaveLength(1);
    expect(state.settings).toMatchObject({
      highLoadFatigueThreshold: 4,
      highLoadRecoveryMinutes: 1440,
      lateShiftEndTime: "23:00",
      teamLeaderConcurrentSupervisionMaxOverlapMinutes: 720,
      dutyFatiguePoints: 50,
      earlyDepartureCutoffTime: "12:00",
      afternoonRestStartTime: "12:00",
      afternoonRestEndTime: "18:00",
    });
    expect(state.settings.dutyPositionPriorities[0]?.flightNo).toBe("TR121");
    expect(state.settings).not.toHaveProperty("highLoadTransitionMode");
    expect(state.settings).not.toHaveProperty("rollingLoadMode");
    expect(state.settings).not.toHaveProperty("lateShiftRecoveryMode");
  });

  it("maintains duty priorities through explicit actions", () => {
    const state = createDefaultState();
    const added = addDutyPriority(state);
    expect(updateDutyPriority(state, added.id, "flightNo", " cx937 ")).toBe(
      true
    );
    expect(added.flightNo).toBe("CX937");
    expect(moveDutyPriority(state, added.id, -1)).toBe(true);
    expect(state.settings.dutyPositionPriorities.at(-2)?.id).toBe(added.id);
  });

  it("maintains editable next-workday recovery targets through explicit actions", () => {
    const state = createDefaultState();
    const added = addNextWorkdayRecoveryTarget(state);
    expect(
      updateNextWorkdayRecoveryTarget(state, added.id, "flightNo", " ke166 ")
    ).toBe(true);
    expect(
      updateNextWorkdayRecoveryTarget(
        state,
        added.id,
        "positionKeyword",
        " 控制 "
      )
    ).toBe(true);
    expect(
      updateNextWorkdayRecoveryTarget(state, added.id, "enabled", false)
    ).toBe(true);
    expect(added).toMatchObject({
      flightNo: "KE166",
      positionKeyword: "控制",
      enabled: false,
    });
    expect(deleteNextWorkdayRecoveryTarget(state, added.id)).toBe(true);
    expect(
      state.settings.nextWorkdayRecoveryTargets.some(
        (item) => item.id === added.id
      )
    ).toBe(false);
  });

  it("maintains editable final-late priority position rules through explicit actions", () => {
    const state = createDefaultState();
    const added = addLateShiftRecoveryPositionRule(state);
    expect(
      updateLateShiftRecoveryPositionRule(
        state,
        added.id,
        "flightNo",
        " tr121 "
      )
    ).toBe(true);
    expect(
      updateLateShiftRecoveryPositionRule(
        state,
        added.id,
        "matchField",
        "remark"
      )
    ).toBe(true);
    expect(
      updateLateShiftRecoveryPositionRule(state, added.id, "keyword", " 控制 ")
    ).toBe(true);
    expect(
      updateLateShiftRecoveryPositionRule(
        state,
        added.id,
        "nextWorkdayCutoffTime",
        "12:30"
      )
    ).toBe(true);
    expect(
      updateLateShiftRecoveryPositionRule(state, added.id, "enabled", false)
    ).toBe(true);
    expect(added).toMatchObject({
      flightNo: "TR121",
      matchField: "remark",
      keyword: "控制",
      nextWorkdayCutoffTime: "12:30",
      enabled: false,
    });
    expect(deleteLateShiftRecoveryPositionRule(state, added.id)).toBe(true);
    expect(
      state.settings.lateShiftRecoveryPositionRules.some(
        (item) => item.id === added.id
      )
    ).toBe(false);
  });

  it("routes every structured policy entity through one field update entry", () => {
    const state = createDefaultState();
    addTransitionPolicy(state);
    addMobileSupervisorCoverageRule(state);
    const transition = state.settings.positionTransitionPolicies.at(-1)!;
    const coverage = state.settings.mobileSupervisorCoverageRules.at(-1)!;

    expect(
      updatePolicyEntityField(
        state,
        "transition-policy",
        transition.id,
        "sourceFlightNo",
        " tr121 "
      )
    ).toBe("saved");
    expect(
      updatePolicyEntityField(
        state,
        "supervisor-coverage",
        coverage.id,
        "mode",
        "allow"
      )
    ).toBe("saved");
    expect(
      updatePolicyEntityField(state, "staff", "missing", "name", "测试")
    ).toBe("not-policy");
    expect(transition.sourceFlightNo).toBe("TR121");
    expect(coverage.mode).toBe("allow");
  });

  it.each<[string, (state: ReturnType<typeof createDefaultState>) => unknown]>([
    ["add duty priority", (state) => addDutyPriority(state)],
    [
      "move duty priority",
      (state) =>
        moveDutyPriority(
          state,
          state.settings.dutyPositionPriorities[1]!.id,
          -1
        ),
    ],
    [
      "delete duty priority",
      (state) =>
        deleteDutyPriority(state, state.settings.dutyPositionPriorities[0]!.id),
    ],
    [
      "update duty priority",
      (state) =>
        updateDutyPriority(
          state,
          state.settings.dutyPositionPriorities[0]!.id,
          "flightNo",
          "CX937"
        ),
    ],
    ["add recovery target", (state) => addNextWorkdayRecoveryTarget(state)],
    [
      "delete recovery target",
      (state) =>
        deleteNextWorkdayRecoveryTarget(
          state,
          state.settings.nextWorkdayRecoveryTargets[0]!.id
        ),
    ],
    [
      "update recovery target",
      (state) =>
        updateNextWorkdayRecoveryTarget(
          state,
          state.settings.nextWorkdayRecoveryTargets[0]!.id,
          "enabled",
          false
        ),
    ],
    ["add final-late rule", (state) => addLateShiftRecoveryPositionRule(state)],
    [
      "delete final-late rule",
      (state) =>
        deleteLateShiftRecoveryPositionRule(
          state,
          state.settings.lateShiftRecoveryPositionRules[0]!.id
        ),
    ],
    [
      "update final-late rule",
      (state) =>
        updateLateShiftRecoveryPositionRule(
          state,
          state.settings.lateShiftRecoveryPositionRules[0]!.id,
          "enabled",
          false
        ),
    ],
    ["add transition policy", (state) => addTransitionPolicy(state)],
    [
      "delete transition policy",
      (state) =>
        deleteTransitionPolicy(
          state,
          state.settings.positionTransitionPolicies[0]!.id
        ),
    ],
    [
      "update transition policy",
      (state) =>
        updatePolicyEntityField(
          state,
          "transition-policy",
          state.settings.positionTransitionPolicies[0]!.id,
          "enabled",
          false
        ),
    ],
    [
      "add supervisor coverage rule",
      (state) => addMobileSupervisorCoverageRule(state),
    ],
    [
      "delete supervisor coverage rule",
      (state) =>
        deleteMobileSupervisorCoverageRule(
          state,
          state.settings.mobileSupervisorCoverageRules[0]!.id
        ),
    ],
    [
      "update supervisor coverage rule",
      (state) =>
        updatePolicyEntityField(
          state,
          "supervisor-coverage",
          state.settings.mobileSupervisorCoverageRules[0]!.id,
          "enabled",
          false
        ),
    ],
  ])("marks an active schedule stale after %s", (_name, mutate) => {
    const state = createDefaultState();
    addActiveSchedule(state);

    mutate(state);

    expect(state.schedulePolicyStale).toBe(true);
    expect(state.assignments).toHaveLength(1);
  });
});
