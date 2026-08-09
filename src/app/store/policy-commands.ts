import {
  addCrossWorkdayQualificationReservation,
  addDutyPriority,
  addLateShiftRecoveryPositionRule,
  addMobileSupervisorCoverageRule,
  addNextWorkdayRecoveryTarget,
  addTransitionPolicy,
  applySchedulePolicy,
  deleteDutyPriority,
  deleteCrossWorkdayQualificationReservation,
  deleteLateShiftRecoveryPositionRule,
  deleteMobileSupervisorCoverageRule,
  deleteNextWorkdayRecoveryTarget,
  deleteTransitionPolicy,
  moveDutyPriority,
  moveCrossWorkdayQualificationReservation,
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
    addCrossWorkdayReservation: () =>
      command(addCrossWorkdayQualificationReservation),
    deleteRecoveryTarget: (id: string) =>
      command((state) => deleteNextWorkdayRecoveryTarget(state, id)),
    deleteCrossWorkdayReservation: (id: string) =>
      command((state) => deleteCrossWorkdayQualificationReservation(state, id)),
    moveCrossWorkdayReservation: (id: string, direction: -1 | 1) =>
      command((state) =>
        moveCrossWorkdayQualificationReservation(state, id, direction)
      ),
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
