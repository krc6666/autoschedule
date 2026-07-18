import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { HistoryRecord } from "../model";
import { consecutiveWorkDays, historyFatigue, recentHistory } from "./fatigue";

function record(date: string, staffId = "2", fatiguePoints = 3): HistoryRecord {
  return { id: date, date, flightNo: "F1", position: "P1", staffId, staffName: "A", startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints, remark: "" };
}

describe("fatigue domain", () => {
  it("uses only earlier records inside the history window", () => {
    const records = [record("2026-07-10"), record("2026-07-17"), record("2026-07-18"), record("2026-07-19")];
    expect(recentHistory(records, "2026-07-18", 7).map((item) => item.date)).toEqual(["2026-07-17"]);
  });

  it("counts consecutive prior work days and applies the configured penalty", () => {
    const state = createDefaultState();
    const records = [record("2026-07-15", "2", 2), record("2026-07-16", "2", 2), record("2026-07-17", "2", 2)];
    expect(consecutiveWorkDays(records, "2", "2026-07-18")).toBe(3);
    expect(historyFatigue(records, "2", "2026-07-18", state.settings)).toBe(16);
  });
});
