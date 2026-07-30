import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { HistoryRecord } from "../model";
import {
  consecutivePositionAssignments,
  createScheduleFrequencyFacts,
  samePositionFrequencyProfile,
} from "./schedule-frequency";

function historyRecord(
  id: string,
  date: string,
  staffId: string,
  flightNo = "TR121",
  position = "H02"
): HistoryRecord {
  return {
    id,
    date,
    flightNo,
    position,
    staffId,
    staffName: staffId,
    startTime: "21:55",
    endTime: "23:55",
    workHours: 2,
    fatiguePoints: 10,
    remark: "一号",
  };
}

describe("schedule frequency facts", () => {
  it("preserves consecutive and frequency results when history is indexed", () => {
    const state = createDefaultState();
    state.history = [
      historyRecord("target-09", "2026-08-09", "target", " tr121 ", " h02 "),
      historyRecord("target-08", "2026-08-08", "target"),
      historyRecord("other-07", "2026-08-07", "other"),
      historyRecord("target-06", "2026-08-06", "target"),
      historyRecord("other-05", "2026-08-05", "other"),
      historyRecord("target-july", "2026-07-31", "target"),
      historyRecord("too-old", "2026-07-30", "target"),
      historyRecord("other-position", "2026-08-09", "target", "TR121", "H03"),
      historyRecord("current-date", "2026-08-10", "target"),
      historyRecord("future", "2026-08-11", "target"),
    ];

    const date = "2026-08-10";
    const facts = createScheduleFrequencyFacts(state, date);

    expect(
      consecutivePositionAssignments(state, "target", "TR121", "H02", date)
    ).toBe(2);
    expect(
      consecutivePositionAssignments(
        state,
        "target",
        "TR121",
        "H02",
        date,
        facts
      )
    ).toBe(2);
    expect(
      samePositionFrequencyProfile(state, "target", "TR121", "H02", date)
    ).toEqual({ currentMonthCount: 3, recentWorkdayCount: 4 });
    expect(
      samePositionFrequencyProfile(state, "target", "TR121", "H02", date, facts)
    ).toEqual({ currentMonthCount: 3, recentWorkdayCount: 4 });
  });

  it("stops consecutive counting at the first archived workday gap", () => {
    const state = createDefaultState();
    state.history = [
      historyRecord("target-09", "2026-08-09", "target"),
      historyRecord("other-08", "2026-08-08", "other"),
      historyRecord("target-07", "2026-08-07", "target"),
    ];
    const date = "2026-08-10";

    expect(
      consecutivePositionAssignments(
        state,
        "target",
        "TR121",
        "H02",
        date,
        createScheduleFrequencyFacts(state, date)
      )
    ).toBe(1);
  });
});
