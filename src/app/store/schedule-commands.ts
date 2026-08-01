import {
  assignStaff,
  createTemporaryAssignment,
  deleteTemporaryAssignment,
  updateAssignmentField,
} from "../schedule-actions";
import {
  clearActiveSchedule,
  installGeneratedSchedule,
} from "../../domain/kernel/schedule-lifecycle";
import { applyStaffStatusChange } from "../../domain/kernel/schedule-state";
import type { ScheduleResult, StaffStatus } from "../../model";
import type { StateCommand } from "./store-command";

export function createScheduleCommands(command: StateCommand) {
  return {
    install: (date: string, result: ScheduleResult) =>
      command((state) => installGeneratedSchedule(state, date, result)),
    clear: () => command(clearActiveSchedule),
    assignStaff: (
      assignmentId: string,
      staffId: string,
      sourceAssignmentId?: string
    ) =>
      command((state) =>
        assignStaff(state, assignmentId, staffId, sourceAssignmentId)
      ),
    updateAssignment: (
      id: string,
      field: string,
      value: string | number | boolean
    ) => command((state) => updateAssignmentField(state, id, field, value)),
    createTemporary: (
      flightId: string,
      position: string,
      staffName: string,
      layoutGroup: "primary" | "bottom",
      layoutIndex: number
    ) =>
      command((state) =>
        createTemporaryAssignment(
          state,
          flightId,
          position,
          staffName,
          layoutGroup,
          layoutIndex
        )
      ),
    deleteTemporary: (id: string) =>
      command((state) => deleteTemporaryAssignment(state, id)),
    applyStaffStatus: (id: string, status: StaffStatus) =>
      command((state) => applyStaffStatusChange(state, id, status)),
    setAdministrativeMode: (enabled: boolean) =>
      command((state) => {
        state.settings.adminSupportEnabled = enabled;
      }),
  };
}

export type ScheduleCommands = ReturnType<typeof createScheduleCommands>;
