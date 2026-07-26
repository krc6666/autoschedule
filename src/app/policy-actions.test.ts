import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import {
  addDutyPriority,
  addNextWorkdayRecoveryTarget,
  applySchedulePolicy,
  deleteNextWorkdayRecoveryTarget,
  moveDutyPriority,
  updateDutyPriority,
  updateNextWorkdayRecoveryTarget,
  type SchedulePolicyInput
} from "./policy-actions";

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
  lateShiftStartTime: "",
  lateShiftLatestWindowMinutes: 180,
  nextDayLateMaxFatigue: 2,
  workloadBalanceEnabled: true,
  maxWorkHoursDifference: 2,
  maxTodayFatigueDifference: 4,
  dutyFatiguePoints: 60,
  earlyDepartureCutoffTime: "",
  afternoonRestStartTime: "",
  afternoonRestEndTime: ""
};

describe("policy actions", () => {
  it("normalizes settings explicitly and reports whether regeneration is needed", () => {
    const state = createDefaultState();
    state.settings.dutyPositionPriorities[0]!.flightNo = " tr121 ";
    state.assignments = [{
      id: "assignment", flightId: "flight", flightNo: "TR121", positionRuleId: null, position: "临时岗位",
      staffId: null, staffName: "", startTime: "20:00", endTime: "21:00", workHours: 0, fatiguePoints: 0,
      remark: "", manualRemark: "", status: "manual"
    }];

    expect(applySchedulePolicy(state, input)).toBe(true);
    expect(state.settings).toMatchObject({
      highLoadFatigueThreshold: 4,
      highLoadRecoveryMinutes: 1440,
      lateShiftStartTime: "20:00",
      dutyFatiguePoints: 50,
      earlyDepartureCutoffTime: "12:00",
      afternoonRestStartTime: "12:00",
      afternoonRestEndTime: "18:00"
    });
    expect(state.settings.dutyPositionPriorities[0]?.flightNo).toBe("TR121");
    expect(state.settings).not.toHaveProperty("highLoadTransitionMode");
    expect(state.settings).not.toHaveProperty("rollingLoadMode");
    expect(state.settings).not.toHaveProperty("lateShiftRecoveryMode");
  });

  it("maintains duty priorities through explicit actions", () => {
    const state = createDefaultState();
    const added = addDutyPriority(state);
    expect(updateDutyPriority(state, added.id, "flightNo", " cx937 ")).toBe(true);
    expect(added.flightNo).toBe("CX937");
    expect(moveDutyPriority(state, added.id, -1)).toBe(true);
    expect(state.settings.dutyPositionPriorities.at(-2)?.id).toBe(added.id);
  });

  it("maintains editable next-workday recovery targets through explicit actions", () => {
    const state = createDefaultState();
    const added = addNextWorkdayRecoveryTarget(state);
    expect(updateNextWorkdayRecoveryTarget(state, added.id, "flightNo", " ke166 ")).toBe(true);
    expect(updateNextWorkdayRecoveryTarget(state, added.id, "positionKeyword", " 控制 ")).toBe(true);
    expect(updateNextWorkdayRecoveryTarget(state, added.id, "enabled", false)).toBe(true);
    expect(added).toMatchObject({ flightNo: "KE166", positionKeyword: "控制", enabled: false });
    expect(deleteNextWorkdayRecoveryTarget(state, added.id)).toBe(true);
    expect(state.settings.nextWorkdayRecoveryTargets.some((item) => item.id === added.id)).toBe(false);
  });
});
