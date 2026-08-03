import { describe, expect, it } from "vitest";

import type { ScheduleProgressStep } from "../../src/domain/kernel/schedule-progress";
import { projectScheduleProgressTasks } from "../../src/ui/projections/schedule-progress-tasks";

const steps: readonly ScheduleProgressStep[] = [
  { stage: "prepare", percent: 5, label: "准备航班和岗位" },
  { stage: "optimize", percent: 15, label: "整体计算岗位与人员" },
  { stage: "assign", percent: 30, label: "整理班表和特殊岗位" },
  { stage: "complete", percent: 100, label: "排班完成" },
];

describe("schedule progress task projection", () => {
  it("marks earlier work complete, the real current step active, and later work pending", () => {
    const tasks = projectScheduleProgressTasks(steps, "optimize", "running");

    expect(tasks.map((task) => task.status)).toEqual([
      "completed",
      "active",
      "pending",
      "pending",
    ]);
    expect(tasks.filter((task) => task.status === "active")).toHaveLength(1);
  });

  it("marks every planned step complete only after a successful result", () => {
    expect(
      projectScheduleProgressTasks(steps, "complete", "completed").map(
        (task) => task.status
      )
    ).toEqual(["completed", "completed", "completed", "completed"]);
  });

  it("keeps the actual failed step visible without completing later work", () => {
    expect(
      projectScheduleProgressTasks(steps, "assign", "failed").map(
        (task) => task.status
      )
    ).toEqual(["completed", "completed", "failed", "pending"]);
  });
});
