import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import {
  crossDayRecoveryRisk,
  nextWorkdayCutoffProtection,
  previousWorkdayLateProtection,
} from "./cross-day-recovery";

describe("cross-day recovery", () => {
  it("protects every configured priority position in the final late batch instead of the highest fatigue position", () => {
    const state = createDefaultState();
    const [one, supervisor, declaration, delivery, ordinary] = state.staff;
    state.history = [
      {
        id: "one",
        date: "2026-08-21",
        flightNo: "TR121",
        position: "H02",
        staffId: one!.id,
        staffName: one!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 10,
        remark: "一号",
      },
      {
        id: "supervisor",
        date: "2026-08-21",
        flightNo: "TR121",
        position: "督导",
        staffId: supervisor!.id,
        staffName: supervisor!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 6,
        remark: "",
      },
      {
        id: "declaration",
        date: "2026-08-21",
        flightNo: "TR121",
        position: "H04",
        staffId: declaration!.id,
        staffName: declaration!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 7,
        remark: "申报",
      },
      {
        id: "delivery",
        date: "2026-08-21",
        flightNo: "TR121",
        position: "H05",
        staffId: delivery!.id,
        staffName: delivery!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 8,
        remark: "送资料",
      },
      {
        id: "ordinary",
        date: "2026-08-21",
        flightNo: "TR121",
        position: "H03",
        staffId: ordinary!.id,
        staffName: ordinary!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 20,
        remark: "",
      },
    ];

    const protection = previousWorkdayLateProtection(state, "2026-08-23");

    expect([...protection.protectedStaffIds]).toEqual([
      one!.id,
      supervisor!.id,
      declaration!.id,
      delivery!.id,
    ]);
    expect(protection.protectedStaffIds.has(ordinary!.id)).toBe(false);
  });

  it("applies edits to the configurable final-late priority position list", () => {
    const state = createDefaultState();
    const [declaration, custom] = state.staff;
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "custom",
        enabled: true,
        flightNo: "TR121",
        matchField: "remark",
        keyword: "控制",
        nextWorkdayCutoffTime: "",
      },
    ];
    state.history = [
      {
        id: "declaration",
        date: "2026-08-21",
        flightNo: "TR121",
        position: "H04",
        staffId: declaration!.id,
        staffName: declaration!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 20,
        remark: "申报",
      },
      {
        id: "custom",
        date: "2026-08-21",
        flightNo: "TR121",
        position: "H03",
        staffId: custom!.id,
        staffName: custom!.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 1,
        remark: "控制",
      },
    ];

    const protection = previousWorkdayLateProtection(state, "2026-08-23");

    expect([...protection.protectedStaffIds]).toEqual([custom!.id]);
  });

  it("does not treat an unconfigured early position as a next-workday recovery target", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.history = [
      {
        id: "highest",
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

    const risk = crossDayRecoveryRisk(
      state,
      person.id,
      {
        flightNo: "KE166",
        startTime: "08:00",
        position: "H03",
        remark: "",
        fatiguePoints: 2,
      },
      "2026-08-23"
    );

    expect(risk).toEqual({
      protectedWorker: false,
      protectedMorningTarget: false,
      protectedLatePriorityTarget: false,
    });
  });

  it("uses the earliest cutoff when one worker matches multiple final-late position rules", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.settings.lateShiftRecoveryPositionRules = [
      {
        id: "supervisor",
        enabled: true,
        flightNo: "TR121",
        matchField: "position",
        keyword: "督导",
        nextWorkdayCutoffTime: "18:00",
      },
      {
        id: "number-one",
        enabled: true,
        flightNo: "TR121",
        matchField: "remark",
        keyword: "一号",
        nextWorkdayCutoffTime: "15:00",
      },
    ];
    state.history = [
      {
        id: "late-priority",
        date: "2026-08-21",
        flightNo: "TR121",
        position: "督导",
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
      nextWorkdayCutoffProtection(state, person.id, "2026-08-23")
    ).toMatchObject({
      cutoffTime: "15:00",
      cutoffMinutes: 15 * 60,
    });
  });
});
