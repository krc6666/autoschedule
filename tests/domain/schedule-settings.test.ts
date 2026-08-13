import { describe, expect, it } from "vitest";

import type { ScheduleSettings } from "../../src/model";
import {
  applyScheduleSettingsPatch,
  createDefaultScheduleSettings,
  normalizeScheduleSettings,
  SCHEDULE_SETTING_DEFINITIONS,
} from "../../src/domain/rules/schedule-settings";

describe("schedule settings module", () => {
  it("owns every scalar setting default and validation rule", () => {
    const complexKeys = new Set([
      "adminSupportEnabled",
      "positionTransitionPolicies",
      "dutyPositionPriorities",
      "nextWorkdayRecoveryTargets",
      "lateShiftRecoveryPositionRules",
      "mobileSupervisorCoverageRules",
      "crossWorkdayQualificationReservations",
      "crossFlightPriorityPolicies",
      "latePriorityFlightNumbers",
    ]);
    const scalarKeys = Object.keys(createDefaultScheduleSettings())
      .filter((key) => !complexKeys.has(key))
      .sort();
    expect(
      SCHEDULE_SETTING_DEFINITIONS.map((definition) => definition.key).sort()
    ).toEqual(scalarKeys);
    expect(
      SCHEDULE_SETTING_DEFINITIONS.find(
        (definition) => definition.key === "dutyFatiguePoints"
      )
    ).toMatchObject({ defaultValue: 12, min: 0, max: 50 });
    expect(
      SCHEDULE_SETTING_DEFINITIONS.find(
        (definition) => definition.key === "minimumRegularTransitionMinutes"
      )
    ).toMatchObject({ defaultValue: 90, min: 0, max: 1440 });
    expect(createDefaultScheduleSettings()).toMatchObject({
      minimumRegularTransitionMinutes: 90,
      nextWorkdayRecoveryMode: "prefer",
      crossWorkdayQualificationReservations: [],
    });
  });

  it("normalizes the cross-workday recovery target strength", () => {
    expect(
      normalizeScheduleSettings({ nextWorkdayRecoveryMode: "forbid" })
        .nextWorkdayRecoveryMode
    ).toBe("forbid");
    expect(
      normalizeScheduleSettings({ nextWorkdayRecoveryMode: "invalid" as never })
        .nextWorkdayRecoveryMode
    ).toBe("prefer");
  });

  it("normalizes the same values for every settings adapter", () => {
    const defaults = createDefaultScheduleSettings();
    const input = {
      dutyFatiguePoints: 100,
      highLoadRecoveryMinutes: 1500.4,
      lateShiftEndTime: "25:00",
      minimumRegularTransitionMinutes: 2000,
      crossWorkdayQualificationReservations: [
        {
          id: " reserve ",
          enabled: true,
          flightNo: " cx931 ",
          matchField: "position",
          keyword: " 控制 ",
          minimumStaffCount: 100,
        },
      ],
      positionTransitionPolicies: [
        {
          id: " transition ",
          name: " ",
          enabled: true,
          sourceFlightNo: " cx931 ",
          sourcePositions: [" G20 ", ""],
          targetFlightNo: " tr121 ",
          targetPosition: " H02 ",
          minimumGapMinutes: 2000,
          mode: "forbid",
        },
      ],
    } satisfies Partial<ScheduleSettings>;

    expect(normalizeScheduleSettings({ ...defaults, ...input })).toMatchObject({
      dutyFatiguePoints: 50,
      highLoadRecoveryMinutes: 1440,
      lateShiftEndTime: "23:00",
      minimumRegularTransitionMinutes: 1440,
      crossWorkdayQualificationReservations: [
        {
          id: "reserve",
          enabled: true,
          flightNo: "CX931",
          matchField: "position",
          keyword: "控制",
          minimumStaffCount: 50,
        },
      ],
      positionTransitionPolicies: [
        {
          id: "transition",
          name: "未命名衔接规则",
          sourceFlightNo: "CX931",
          sourcePositions: ["G20"],
          targetFlightNo: "TR121",
          targetPosition: "H02",
          minimumGapMinutes: 1440,
          mode: "forbid",
        },
      ],
    });
  });

  it("applies partial imports without resetting settings omitted by the workbook", () => {
    const current = createDefaultScheduleSettings();
    current.positionRotationEnabled = false;
    const next = applyScheduleSettingsPatch(current, { dutyFatiguePoints: 6 });
    expect(next.dutyFatiguePoints).toBe(6);
    expect(next.positionRotationEnabled).toBe(false);
    expect(next.dutyPositionPriorities).toEqual(current.dutyPositionPriorities);
  });
});
