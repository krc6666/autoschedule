import {
  addDutyPriority,
  addLateShiftRecoveryPositionRule,
  addMobileSupervisorCoverageRule,
  addNextWorkdayRecoveryTarget,
  addTransitionPolicy,
  applySchedulePolicy,
  deleteDutyPriority,
  deleteLateShiftRecoveryPositionRule,
  deleteMobileSupervisorCoverageRule,
  deleteNextWorkdayRecoveryTarget,
  deleteTransitionPolicy,
  moveDutyPriority,
  moveRuleHook,
  setRuleHookEnabled,
  updatePolicyEntityField,
  type PolicyValue,
  type SchedulePolicyInput,
} from "../policy-actions";
import {
  movePlugin,
  movePluginRule,
  registerLoadedPlugin,
  removePlugin,
  setPluginEnabled,
  setPluginRuleEnabled,
} from "../plugin-actions";
import type { LoadedPlugin } from "../../infrastructure/plugin-host";
import type { StateCommand } from "./store-command";

export function createPolicyCommands(command: StateCommand) {
  return {
    apply: (input: SchedulePolicyInput) =>
      command((state) => applySchedulePolicy(state, input)),
    addDutyPriority: () => command(addDutyPriority),
    moveDutyPriority: (id: string, direction: -1 | 1) =>
      command((state) => moveDutyPriority(state, id, direction)),
    deleteDutyPriority: (id: string) =>
      command((state) => deleteDutyPriority(state, id)),
    addRecoveryTarget: () => command(addNextWorkdayRecoveryTarget),
    deleteRecoveryTarget: (id: string) =>
      command((state) => deleteNextWorkdayRecoveryTarget(state, id)),
    addLateShiftPosition: () => command(addLateShiftRecoveryPositionRule),
    deleteLateShiftPosition: (id: string) =>
      command((state) => deleteLateShiftRecoveryPositionRule(state, id)),
    addSupervisorCoverage: () => command(addMobileSupervisorCoverageRule),
    deleteSupervisorCoverage: (id: string) =>
      command((state) => deleteMobileSupervisorCoverageRule(state, id)),
    addTransition: () => command(addTransitionPolicy),
    deleteTransition: (id: string) =>
      command((state) => deleteTransitionPolicy(state, id)),
    updateEntity: (
      entity: string,
      id: string,
      field: string,
      value: PolicyValue
    ) =>
      command((state) =>
        updatePolicyEntityField(state, entity, id, field, value)
      ),
    setHookEnabled: (id: string, enabled: boolean) =>
      command((state) => setRuleHookEnabled(state, id, enabled)),
    moveHook: (id: string, direction: -1 | 1) =>
      command((state) => moveRuleHook(state, id, direction)),
    registerPlugin: (plugin: LoadedPlugin) =>
      command((state) => registerLoadedPlugin(state, plugin)),
    setPluginEnabled: (id: string, enabled: boolean) =>
      command((state) => setPluginEnabled(state, id, enabled)),
    setPluginRuleEnabled: (
      pluginId: string,
      ruleId: string,
      enabled: boolean
    ) =>
      command((state) =>
        setPluginRuleEnabled(state, pluginId, ruleId, enabled)
      ),
    movePlugin: (id: string, direction: -1 | 1) =>
      command((state) => movePlugin(state, id, direction)),
    movePluginRule: (pluginId: string, ruleId: string, direction: -1 | 1) =>
      command((state) => movePluginRule(state, pluginId, ruleId, direction)),
    removePlugin: (id: string) => command((state) => removePlugin(state, id)),
  };
}

export type PolicyCommands = ReturnType<typeof createPolicyCommands>;
