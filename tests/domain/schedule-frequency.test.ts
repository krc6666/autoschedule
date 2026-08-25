import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { HistoryRecord } from "../../src/model";
import {
  consecutivePositionAssignments,
  createScheduleFrequencyFacts,
  samePositionFrequencyProfile,
} from "../../src/domain/statistics/schedule-frequency";

function historyRecord(
  id: string,
  date: string,
  staffId: string,
  flightNo = "TR121",
  position = "H02",
  remark = ""
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
    remark,
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
      consecutivePositionAssignments(state, "target", "TR121", "H02", "", date)
    ).toBe(2);
    expect(
      consecutivePositionAssignments(
        state,
        "target",
        "TR121",
        "H02",
        "",
        date,
        facts
      )
    ).toBe(2);
    expect(
      samePositionFrequencyProfile(state, "target", "TR121", "H02", "", date)
    ).toEqual({ currentMonthCount: 3, recentWorkdayCount: 4 });
    expect(
      samePositionFrequencyProfile(
        state,
        "target",
        "TR121",
        "H02",
        "",
        date,
        facts
      )
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
        "",
        date,
        createScheduleFrequencyFacts(state, date)
      )
    ).toBe(1);
  });

  it("shares a rotation counter across flights of the same airline", () => {
    const state = createDefaultState();
    state.history = [
      historyRecord("cx-937", "2026-08-09", "target", "CX937", "G18"),
      historyRecord("cx-931", "2026-08-08", "target", "CX931", "G18"),
      historyRecord("tr-121", "2026-08-07", "target", "TR121", "G18"),
      historyRecord(
        "cx-other-position",
        "2026-08-06",
        "target",
        "CX931",
        "G20"
      ),
    ];

    expect(
      samePositionFrequencyProfile(
        state,
        "target",
        "CX931",
        "G18",
        "",
        "2026-08-10"
      )
    ).toEqual({ currentMonthCount: 2, recentWorkdayCount: 2 });
  });

  it("does not share counters across airlines or different positions", () => {
    const state = createDefaultState();
    state.history = [
      historyRecord(
        "cx-control",
        "2026-08-09",
        "target",
        "CX937",
        "G18",
        "控制"
      ),
      historyRecord(
        "tr-control",
        "2026-08-08",
        "target",
        "TR121",
        "G18",
        "控制"
      ),
      historyRecord(
        "cx-number-one",
        "2026-08-07",
        "target",
        "CX931",
        "G20",
        "一号"
      ),
    ];

    expect(
      samePositionFrequencyProfile(
        state,
        "target",
        "CX931",
        "G18",
        "控制",
        "2026-08-10"
      )
    ).toEqual({ currentMonthCount: 1, recentWorkdayCount: 1 });
    expect(
      samePositionFrequencyProfile(
        state,
        "target",
        "TR121",
        "G18",
        "控制",
        "2026-08-10"
      )
    ).toEqual({ currentMonthCount: 1, recentWorkdayCount: 1 });
    expect(
      samePositionFrequencyProfile(
        state,
        "target",
        "CX937",
        "G20",
        "一号",
        "2026-08-10"
      )
    ).toEqual({ currentMonthCount: 1, recentWorkdayCount: 1 });
  });

  it("shares semantic position counters across different physical counters", () => {
    const state = createDefaultState();
    state.history = [
      historyRecord(
        "fd-report-1",
        "2026-08-09",
        "target",
        "FD101",
        "G08",
        "申报"
      ),
      historyRecord(
        "fd-report-2",
        "2026-08-08",
        "target",
        "FD202",
        "G17",
        "申报"
      ),
      historyRecord(
        "fd-material",
        "2026-08-07",
        "target",
        "FD303",
        "G17",
        "送资料"
      ),
    ];

    expect(
      samePositionFrequencyProfile(
        state,
        "target",
        "FD404",
        "G99",
        "申报",
        "2026-08-10"
      )
    ).toEqual({ currentMonthCount: 2, recentWorkdayCount: 2 });
    expect(
      samePositionFrequencyProfile(
        state,
        "target",
        "FD404",
        "G99",
        "送资料",
        "2026-08-10"
      )
    ).toEqual({ currentMonthCount: 1, recentWorkdayCount: 1 });
  });
});
