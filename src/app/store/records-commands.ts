import {
  clearHistory,
  deleteHistory,
  replaceHistoryForDate,
} from "../history-actions";
import {
  applyDutyRosterImport,
  applyWorkbookImport,
} from "../workbook-actions";
import {
  clearDutyRosterOverride,
  clearMonthlyDutyRosterOverrides,
  updateDutyRosterSlot,
  type DutyRosterSlot,
} from "../../domain/duty-roster/roster";
import type { DutyRosterImportPreview } from "../../infrastructure/duty-roster-excel";
import type { WorkbookImport } from "../../infrastructure/excel";
import type { HistoryRecord } from "../../model";
import type { WorkbookImportMode } from "../workbook-import-controller";
import type { StateCommand } from "./store-command";

export function createRecordsCommands(command: StateCommand) {
  return {
    clearHistory: () => command(clearHistory),
    deleteHistory: (id: string) => command((state) => deleteHistory(state, id)),
    replaceHistory: (date: string, records: HistoryRecord[]) =>
      command((state) => replaceHistoryForDate(state, date, records)),
    clearDutyRosterDay: (date: string) =>
      command((state) => clearDutyRosterOverride(state, date)),
    clearDutyRosterMonth: (date: string) =>
      command((state) => clearMonthlyDutyRosterOverrides(state, date)),
    updateDutyRoster: (date: string, slot: DutyRosterSlot, staffId: string) =>
      command((state) => updateDutyRosterSlot(state, date, slot, staffId)),
    applyDutyRosterImport: (preview: DutyRosterImportPreview) =>
      command((state) => applyDutyRosterImport(state, preview)),
    applyWorkbookImport: (
      imported: WorkbookImport,
      mode: Exclude<WorkbookImportMode, "duty-roster">
    ) => command((state) => applyWorkbookImport(state, imported, mode)),
  };
}

export type RecordsCommands = ReturnType<typeof createRecordsCommands>;
