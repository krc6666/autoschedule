import { Bench } from "tinybench";
import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { AppState, ScheduleResult } from "../../src/model";
import { operationalAssignmentInterval } from "../../src/domain/assignments/minimum-flight-transition";
import { intervalsOverlap } from "../../src/domain/shared/time";
import { generateSchedule } from "../helpers/generate-schedule";
import { createScheduleScaleState } from "./fixtures/schedule-scale";

interface BenchmarkObservation {
  p50: number;
  p99: number;
  samples: number;
}

function verifySchedule(
  state: AppState,
  result: ScheduleResult,
  expectedPositionCount: number
): void {
  expect(result.assignments).toHaveLength(expectedPositionCount);
  expect(result.unfilledCount).toBe(0);
  expect(new Set(result.assignments.map((item) => item.id)).size).toBe(
    expectedPositionCount
  );
  for (const person of state.staff) {
    const assignments = result.assignments.filter(
      (item) =>
        item.staffId === person.id &&
        item.status === "assigned" &&
        item.workHours > 0
    );
    for (let left = 0; left < assignments.length; left += 1) {
      for (let right = left + 1; right < assignments.length; right += 1) {
        expect(
          intervalsOverlap(
            assignments[left]!.startTime,
            assignments[left]!.endTime,
            assignments[right]!.startTime,
            assignments[right]!.endTime
          )
        ).toBe(false);
      }
    }
    const intervals = assignments
      .map((assignment) => operationalAssignmentInterval(state, assignment))
      .sort((left, right) => left.start - right.start);
    for (let index = 1; index < intervals.length; index += 1) {
      expect(
        intervals[index]!.start - intervals[index - 1]!.end
      ).toBeGreaterThanOrEqual(state.settings.minimumRegularTransitionMinutes);
    }
  }
}

async function benchmark(
  name: string,
  run: () => Promise<void>
): Promise<BenchmarkObservation> {
  const bench = new Bench({
    iterations: 2,
    time: 0,
    warmup: true,
    warmupIterations: 1,
    warmupTime: 0,
    retainSamples: true,
    throws: true,
  });
  bench.add(name, run, { async: true });
  await bench.run();
  const result = bench.getTask(name)!.result;
  expect(result.state).toBe("completed");
  if (result.state !== "completed")
    throw new Error(`${name} 基准未完成：${result.state}`);
  return {
    p50: result.latency.p50,
    p99: result.latency.p99,
    samples: result.latency.samplesCount,
  };
}

describe("scheduling kernel production benchmarks", () => {
  it("records median and P99 latency for the default schedule", async () => {
    const observation = await benchmark("default schedule", async () => {
      const state = createDefaultState();
      const result = await generateSchedule(state, "2026-08-01");
      expect(result.assignments).toHaveLength(state.positionRules.length);
      expect(new Set(result.assignments.map((item) => item.id)).size).toBe(
        result.assignments.length
      );
    });

    expect(observation.samples).toBeGreaterThanOrEqual(2);
    expect(observation.p50).toBeLessThan(30_000);
    expect(observation.p99).toBeLessThan(30_000);
  }, 100_000);

  it.each([
    { positions: 16, p50Limit: 30_000, p99Limit: 30_000 },
    { positions: 32, p50Limit: 30_000, p99Limit: 30_000 },
  ])(
    "keeps a $positions-position schedule complete and bounded",
    async ({ positions, p50Limit, p99Limit }) => {
      const observation = await benchmark(
        `${positions} positions`,
        async () => {
          const state = createScheduleScaleState(positions);
          const result = await generateSchedule(state, "2026-08-01");
          verifySchedule(state, result, positions);
        }
      );

      expect(observation.samples).toBeGreaterThanOrEqual(2);
      expect(observation.p50).toBeLessThan(p50Limit);
      expect(observation.p99).toBeLessThan(p99Limit);
    },
    100_000
  );
});
