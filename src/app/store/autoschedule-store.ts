import { createStore, type StoreApi } from "zustand/vanilla";
import { immer } from "zustand/middleware/immer";

import { createDefaultState } from "../../defaults";
import {
  clearState,
  loadState,
  saveState,
  type StateSaveResult,
} from "../../infrastructure/storage";
import type { AppState } from "../../model";
import {
  createConfigurationCommands,
  type ConfigurationCommands,
} from "./configuration-commands";
import { createPolicyCommands, type PolicyCommands } from "./policy-commands";
import {
  createRecordsCommands,
  type RecordsCommands,
} from "./records-commands";
import {
  createScheduleCommands,
  type ScheduleCommands,
} from "./schedule-commands";
import type { StateCommand } from "./store-command";

export interface AutoscheduleStoreState {
  model: AppState;
  configuration: ConfigurationCommands;
  policy: PolicyCommands;
  schedule: ScheduleCommands;
  records: RecordsCommands;
  replaceModel(state: AppState): void;
  persist(): StateSaveResult;
  reset(): void;
}

export type AutoscheduleStore = StoreApi<AutoscheduleStoreState>;

export function createAutoscheduleStore(
  initial: AppState = loadState()
): AutoscheduleStore {
  return createStore<AutoscheduleStoreState>()(
    immer((set, get) => {
      const command: StateCommand = <T>(operation: (state: AppState) => T) => {
        let result!: T;
        set((store) => {
          result = operation(store.model);
        });
        return result;
      };
      return {
        model: structuredClone(initial),
        configuration: createConfigurationCommands(command),
        policy: createPolicyCommands(command),
        schedule: createScheduleCommands(command),
        records: createRecordsCommands(command),
        replaceModel: (state) => set({ model: structuredClone(state) }),
        persist: () => {
          const result = saveState(get().model);
          set({ model: result.state });
          return result;
        },
        reset: () => {
          clearState();
          set({ model: createDefaultState() });
        },
      };
    })
  );
}
