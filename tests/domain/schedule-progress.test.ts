import { describe, expect, it } from "vitest";

import {
  scheduleProgressLabel,
  scheduleProgressPercent,
  SCHEDULE_PROGRESS_STAGES,
} from "../../src/domain/kernel/schedule-progress";

describe("schedule progress contract", () => {
  it("keeps stages ordered with increasing percentages and complete last", () => {
    const percentages = SCHEDULE_PROGRESS_STAGES.map(scheduleProgressPercent);

    expect(percentages).toEqual(
      [...percentages].sort((left, right) => left - right)
    );
    expect(SCHEDULE_PROGRESS_STAGES.at(-1)).toBe("complete");
    expect(scheduleProgressPercent("complete")).toBe(100);
  });

  it("provides a visible label for every stage", () => {
    expect(
      SCHEDULE_PROGRESS_STAGES.every(
        (stage) => scheduleProgressLabel(stage).trim().length > 0
      )
    ).toBe(true);
    expect(
      SCHEDULE_PROGRESS_STAGES.every(
        (stage) => !scheduleProgressLabel(stage).startsWith("正在")
      )
    ).toBe(true);
    expect(SCHEDULE_PROGRESS_STAGES.slice(0, 3)).toEqual([
      "prepare",
      "optimize",
      "assign",
    ]);
    expect(scheduleProgressLabel("optimize")).toBe("整体计算岗位与人员");
    expect(SCHEDULE_PROGRESS_STAGES.map(scheduleProgressLabel)).not.toContain(
      "读取历史排班与轮值"
    );
  });
});
