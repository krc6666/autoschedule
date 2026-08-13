// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { ScheduleProgressStep } from "../../src/domain/kernel/schedule-progress";
import { projectScheduleProgressTasks } from "../../src/ui/projections/schedule-progress-tasks";
import "../../src/ui/components/schedule-progress-panel";
import { mountElement } from "./lit-test-helpers";

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

describe("schedule progress stop controls", () => {
  it("always allows discarding work and only enables adopting a safe result", async () => {
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-progress-panel", {
      progress: {
        outcome: "running",
        visible: true,
        stage: "optimize",
        percent: 15,
        steps,
        canAdoptCurrentResult: false,
      },
    });

    expect(
      element.querySelector<HTMLButtonElement>(
        'button[aria-label="停止排班，不采用结果"]'
      )?.disabled
    ).toBe(false);
    expect(
      element.querySelector<HTMLButtonElement>(
        'button[aria-label="停止排班并采用当前方案"]'
      )?.disabled
    ).toBe(true);

    (element as unknown as { progress: Record<string, unknown> }).progress = {
      outcome: "running",
      visible: true,
      stage: "optimize",
      percent: 15,
      steps,
      canAdoptCurrentResult: true,
    };
    await element.updateComplete;
    expect(
      element.querySelector<HTMLButtonElement>(
        'button[aria-label="停止排班并采用当前方案"]'
      )?.disabled
    ).toBe(false);
  });
});
