import {
  addCrossWorkdayQualificationReservation,
  addCrossFlightPriorityPolicy,
  addDutyPriority,
  addLateShiftRecoveryPositionRule,
  addMobileSupervisorCoverageRule,
  addSameFlightStaffExclusion,
  addNextWorkdayRecoveryTarget,
  addTransitionPolicy,
  applySchedulePolicy,
  deleteDutyPriority,
  deleteCrossWorkdayQualificationReservation,
  deleteCrossFlightPriorityPolicy,
  deleteLateShiftRecoveryPositionRule,
  deleteMobileSupervisorCoverageRule,
  deleteSameFlightStaffExclusion,
  deleteNextWorkdayRecoveryTarget,
  deleteTransitionPolicy,
  moveDutyPriority,
  moveCrossWorkdayQualificationReservation,
  moveCrossFlightPriorityPolicy,
  updatePolicyEntityField,
  addOrdinaryPriorityPosition,
  deleteOrdinaryPriorityPosition,
  updateOrdinaryPriorityPosition,
  type PolicyValue,
  type SchedulePolicyInput,
} from "../policy-actions";
import type { StateCommand } from "./store-command";

export function createPolicyCommands(command: StateCommand) {
  return {
    apply: (input: SchedulePolicyInput) =>
      command((state) => applySchedulePolicy(state, input)),
    addSameFlightStaffExclusion: () => command(addSameFlightStaffExclusion),
    deleteSameFlightStaffExclusion: (id: string) =>
      command((state) => deleteSameFlightStaffExclusion(state, id)),
    addDutyPriority: () => command(addDutyPriority),
    moveDutyPriority: (id: string, direction: -1 | 1) =>
      command((state) => moveDutyPriority(state, id, direction)),
    deleteDutyPriority: (id: string) =>
      command((state) => deleteDutyPriority(state, id)),
    addRecoveryTarget: () => command(addNextWorkdayRecoveryTarget),
    addCrossWorkdayReservation: () =>
      command(addCrossWorkdayQualificationReservation),
    addCrossFlightPriority: () => command(addCrossFlightPriorityPolicy),
    deleteRecoveryTarget: (id: string) =>
      command((state) => deleteNextWorkdayRecoveryTarget(state, id)),
    deleteCrossWorkdayReservation: (id: string) =>
      command((state) => deleteCrossWorkdayQualificationReservation(state, id)),
    deleteCrossFlightPriority: (id: string) =>
      command((state) => deleteCrossFlightPriorityPolicy(state, id)),
    moveCrossWorkdayReservation: (id: string, direction: -1 | 1) =>
      command((state) =>
        moveCrossWorkdayQualificationReservation(state, id, direction)
      ),
    moveCrossFlightPriority: (id: string, direction: -1 | 1) =>
      command((state) => moveCrossFlightPriorityPolicy(state, id, direction)),
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
    addOrdinaryPriorityPosition: () => command(addOrdinaryPriorityPosition),
    deleteOrdinaryPriorityPosition: (airlineCode: string, position: string) =>
      command((state) =>
        deleteOrdinaryPriorityPosition(state, airlineCode, position)
      ),
    updateOrdinaryPriorityPosition: (
      index: number,
      field: "airlineCode" | "position",
      value: string
    ) =>
      command((state) =>
        updateOrdinaryPriorityPosition(state, index, field, value)
      ),
  };
}

export type PolicyCommands = ReturnType<typeof createPolicyCommands>;
