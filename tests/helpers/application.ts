import type {
  ApplicationCoordinatorOptions,
  ApplicationCoordinatorDependencies,
} from "../../src/app/application-coordinator";
import { ApplicationCoordinator } from "../../src/app/application-coordinator";
import {
  createAutoscheduleStore,
  type AutoscheduleStatePersistence,
  type AutoscheduleStore,
} from "../../src/app/store/autoschedule-store";
import type { ScheduleRunner } from "../../src/app/schedule-run-controller";
import { createDefaultState } from "../../src/defaults";
import type { AppState } from "../../src/model";

export function createMemoryStatePersistence(): AutoscheduleStatePersistence {
  let saved = createDefaultState();
  return {
    load: () => structuredClone(saved),
    save: (state) => {
      saved = {
        ...structuredClone(state),
        updatedAt: new Date().toISOString(),
      };
      return {
        state: structuredClone(saved),
        sizeBytes: JSON.stringify(saved).length,
        nearCapacity: false,
      };
    },
    clear: () => {
      saved = createDefaultState();
    },
  };
}

export function createTestAutoscheduleStore(
  initialState: AppState = createDefaultState(),
  persistence: AutoscheduleStatePersistence = createMemoryStatePersistence()
): AutoscheduleStore {
  return createAutoscheduleStore({ initialState, persistence });
}

export function createTestScheduleRunner(
  overrides: Partial<ScheduleRunner> = {}
): ScheduleRunner {
  return {
    calculate: async () => {
      throw new Error("测试未配置排班 runner");
    },
    isRunning: () => false,
    canAdoptCurrentResult: () => false,
    stopWithoutResult: () => false,
    stopWithCurrentResult: () => false,
    ...overrides,
  };
}

class ConfigurableTestScheduleRunner implements ScheduleRunner {
  private delegate: ScheduleRunner;

  constructor(runner: ScheduleRunner) {
    this.delegate = runner;
  }

  use(runner: ScheduleRunner): void {
    this.delegate = runner;
  }

  calculate(...args: Parameters<ScheduleRunner["calculate"]>) {
    return this.delegate.calculate(...args);
  }

  isRunning(): boolean {
    return this.delegate.isRunning();
  }

  canAdoptCurrentResult(): boolean {
    return this.delegate.canAdoptCurrentResult();
  }

  stopWithoutResult(): boolean {
    return this.delegate.stopWithoutResult();
  }

  stopWithCurrentResult(): boolean {
    return this.delegate.stopWithCurrentResult();
  }
}

const testRunners = new WeakMap<
  ApplicationCoordinator,
  ConfigurableTestScheduleRunner
>();

export function createTestApplicationCoordinator(
  store: AutoscheduleStore,
  options: ApplicationCoordinatorOptions,
  runner: ScheduleRunner = createTestScheduleRunner()
): ApplicationCoordinator {
  const configurableRunner = new ConfigurableTestScheduleRunner(runner);
  const dependencies: ApplicationCoordinatorDependencies = {
    createScheduleRunner: () => configurableRunner,
  };
  const coordinator = new ApplicationCoordinator(store, options, dependencies);
  testRunners.set(coordinator, configurableRunner);
  return coordinator;
}

export function setTestScheduleRunner(
  coordinator: ApplicationCoordinator,
  overrides: Partial<ScheduleRunner>
): void {
  const runner = testRunners.get(coordinator);
  if (!runner)
    throw new Error("coordinator 不是由测试 application helper 创建");
  runner.use(createTestScheduleRunner(overrides));
}
