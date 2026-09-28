import { describe, expect, it, vi } from "vitest";

import {
  ApplicationCoordinator,
  type ApplicationCoordinatorDependencies,
} from "../../src/app/application-coordinator";
import type { ApplicationPreferences } from "../../src/app/application-preferences";
import {
  createAutoscheduleStore,
  type AutoscheduleStatePersistence,
} from "../../src/app/store/autoschedule-store";
import type { ScheduleRunner } from "../../src/app/schedule-run-controller";
import { createDefaultState } from "../../src/defaults";

const preferences: ApplicationPreferences = {
  loadScheduleDate: () => null,
  saveScheduleDate: () => undefined,
  loadScheduleZoom: () => null,
  saveScheduleZoom: () => undefined,
};

function persistenceSpy(): AutoscheduleStatePersistence & {
  save: ReturnType<typeof vi.fn<AutoscheduleStatePersistence["save"]>>;
  clear: ReturnType<typeof vi.fn<AutoscheduleStatePersistence["clear"]>>;
} {
  return {
    load: vi.fn(() => createDefaultState()),
    save: vi.fn((state) => ({
      state: { ...state, updatedAt: "2026-09-28T00:00:00.000Z" },
      sizeBytes: 1,
      nearCapacity: false,
    })),
    clear: vi.fn(),
  };
}

function idleRunner(): ScheduleRunner {
  return {
    calculate: vi.fn(async () => {
      throw new Error("本测试不应启动排班");
    }),
    isRunning: () => false,
    canAdoptCurrentResult: () => false,
    stopWithoutResult: () => false,
    stopWithCurrentResult: () => false,
  };
}

describe("application adapter seams", () => {
  it("lets the composition root select the schedule runner", () => {
    const persistence = persistenceSpy();
    const runner = idleRunner();
    const dependencies: ApplicationCoordinatorDependencies = {
      createScheduleRunner: vi.fn(() => runner),
    };
    const store = createAutoscheduleStore({
      initialState: createDefaultState(),
      persistence,
    });

    const coordinator = new ApplicationCoordinator(
      store,
      { preferences },
      dependencies
    );

    expect(coordinator.scheduleRunner).toBe(runner);
    expect(dependencies.createScheduleRunner).toHaveBeenCalledOnce();
  });

  it("lets the Store use an injected persistence adapter", () => {
    const persistence = persistenceSpy();
    const store = createAutoscheduleStore({
      initialState: createDefaultState(),
      persistence,
    });

    store.getState().configuration.addStaff();
    store.getState().persist();
    store.getState().reset();

    expect(persistence.save).toHaveBeenCalledOnce();
    expect(persistence.clear).toHaveBeenCalledOnce();
  });
});
