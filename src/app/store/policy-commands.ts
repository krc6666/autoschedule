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
  updatePolicyEntityField,
  type PolicyValue,
  type SchedulePolicyInput,
} from "../policy-actions";
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
  };
}

export type PolicyCommands = ReturnType<typeof createPolicyCommands>;
