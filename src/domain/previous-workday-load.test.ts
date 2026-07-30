import { describe, expect, it } from "vitest";
import {
  comparePreviousWorkdayLoad,
  type PreviousWorkdayLoad,
} from "./previous-workday-load";

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
});
