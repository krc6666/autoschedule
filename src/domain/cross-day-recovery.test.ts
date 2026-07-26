import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { crossDayRecoveryRisk, previousWorkdayLateProtection } from "./cross-day-recovery";

describe("cross-day recovery", () => {
  it("protects every worker tied on the highest-fatigue position in the final late batch", () => {
    const state = createDefaultState();
    const [first, second, lower] = state.staff;
    state.history = [
      { id: "highest-1", date: "2026-08-21", flightNo: "TR121", position: "H02", staffId: first!.id, staffName: first!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 10, remark: "一号" },
      { id: "highest-2", date: "2026-08-21", flightNo: "TR121", position: "督导", staffId: second!.id, staffName: second!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 10, remark: "" },
      { id: "lower", date: "2026-08-21", flightNo: "TR121", position: "H04", staffId: lower!.id, staffName: lower!.name, startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 7, remark: "申报" }
    ];

    const protection = previousWorkdayLateProtection(state, "2026-08-23");

    expect([...protection.protectedStaffIds]).toEqual([first!.id, second!.id]);
    expect(protection.highestFatiguePoints).toBe(10);
  });

  it("does not treat an unconfigured early position as a next-workday recovery target", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.history = [{
      id: "highest", date: "2026-08-21", flightNo: "TR121", position: "H02", staffId: person.id, staffName: person.name,
      startTime: "21:55", endTime: "23:55", workHours: 2, fatiguePoints: 10, remark: "一号"
    }];

    const risk = crossDayRecoveryRisk(state, person.id, {
      flightNo: "KE166",
      startTime: "08:00",
      position: "H03",
      remark: "",
      fatiguePoints: 2
    }, "2026-08-23");

    expect(risk).toEqual({ protectedWorker: false, protectedMorningTarget: false, lateFatigueExcess: 0 });
  });
});
