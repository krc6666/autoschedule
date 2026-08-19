import { describe, expect, it } from "vitest";
import {
  comparePreviousWorkdayLoad,
  createPreviousWorkdayLoadFacts,
  type PreviousWorkdayLoad,
} from "../../src/domain/shared/previous-workday-load";
import { createDefaultState } from "../../src/defaults";

function load(
  overrides: Partial<PreviousWorkdayLoad> = {}
): PreviousWorkdayLoad {
  return {
    fatiguePoints: 0,
    latestEndMinutes: 0,
    workHours: 0,
    priorityPositionCount: 0,
    ...overrides,
  };
}

describe("previous workday load ordering", () => {
  it("compares fatigue before every later fact", () => {
    expect(
      comparePreviousWorkdayLoad(
        load({
          fatiguePoints: 1,
          latestEndMinutes: 1400,
          workHours: 12,
          priorityPositionCount: 4,
        }),
        load({
          fatiguePoints: 2,
          latestEndMinutes: 600,
          workHours: 2,
          priorityPositionCount: 0,
        })
      )
    ).toBeLessThan(0);
  });

  it("compares latest end time when fatigue is equal", () => {
    expect(
      comparePreviousWorkdayLoad(
        load({
          fatiguePoints: 2,
          latestEndMinutes: 600,
          workHours: 12,
          priorityPositionCount: 4,
        }),
        load({
          fatiguePoints: 2,
          latestEndMinutes: 700,
          workHours: 2,
          priorityPositionCount: 0,
        })
      )
    ).toBeLessThan(0);
  });

  it("compares work hours when fatigue and latest end time are equal", () => {
    expect(
      comparePreviousWorkdayLoad(
        load({
          fatiguePoints: 2,
          latestEndMinutes: 700,
          workHours: 2,
          priorityPositionCount: 4,
        }),
        load({
          fatiguePoints: 2,
          latestEndMinutes: 700,
          workHours: 3,
          priorityPositionCount: 0,
        })
      )
    ).toBeLessThan(0);
  });

  it("compares priority-position count only after all earlier facts are equal", () => {
    expect(
      comparePreviousWorkdayLoad(
        load({
          fatiguePoints: 2,
          latestEndMinutes: 700,
          workHours: 3,
          priorityPositionCount: 1,
        }),
        load({
          fatiguePoints: 2,
          latestEndMinutes: 700,
          workHours: 3,
          priorityPositionCount: 2,
        })
      )
    ).toBeLessThan(0);
  });

  it("does not treat scoped late-priority hours as a complete-day rolling load", () => {
    const state = createDefaultState();
    const person = state.staff[0]!;
    state.history = [
      {
        id: "legacy-history-load",
        date: "2026-07-18",
        flightNo: "TR121",
        position: "H02",
        staffId: person.id,
        staffName: person.name,
        startTime: "21:55",
        endTime: "23:55",
        workHours: 2,
        fatiguePoints: 10,
        remark: "一号",
        historyCoverage: "late-priority-only",
      },
    ];

    const facts = createPreviousWorkdayLoadFacts(state, "2026-07-19");

    expect(facts.byStaffId.get(person.id)?.fatiguePoints).toBe(10);
    expect(facts.byStaffId.get(person.id)?.workHours).toBe(0);
  });
});
