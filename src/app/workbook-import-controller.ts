import type { DutyRosterImportPreview } from "../infrastructure/duty-roster-excel";
import type { AppState } from "../model";
import type { LegacyScheduleImportPreview } from "../infrastructure/legacy-schedule-excel";
import {
  applyWorkbookImport,
  validateDutyRosterImport,
} from "./workbook-actions";

export type WorkbookImportMode =
  "all" | "config" | "history" | "duty-roster" | "late-priority-counts";

export type PreparedWorkbookImport =
  | { kind: "duty-roster"; preview: DutyRosterImportPreview }
  | {
      kind: "legacy-schedule";
      preview: LegacyScheduleImportPreview;
    }
  | { kind: "workbook"; recognized: string; warnings: string[] };

export async function prepareWorkbookImport(
  state: AppState,
  file: File,
  mode: WorkbookImportMode,
  dutyRosterReferenceDate: string
): Promise<PreparedWorkbookImport> {
  if (mode === "late-priority-counts")
    throw new Error("末班重点岗位次数使用专用导入入口");
  if (mode === "duty-roster") {
    const { importDutyRosterWorkbook } =
      await import("../infrastructure/duty-roster-excel");
    const parsed = await importDutyRosterWorkbook(
      file,
      state.staff,
      dutyRosterReferenceDate
    );
    return {
      kind: "duty-roster",
      preview: validateDutyRosterImport(state, parsed),
    };
  }
  const { importWorkbook } = await import("../infrastructure/excel");
  const imported = await importWorkbook(file, state.staff, {
    legacySchedule: {
      targetDate: dutyRosterReferenceDate,
      latePriorityOnly: true,
      latePriorityFlightNumbers: state.settings.latePriorityFlightNumbers,
      positionRules: state.positionRules,
      lateShiftEndTime: state.settings.lateShiftEndTime,
    },
  });
  if (imported.legacySchedule?.recognizedSheets)
    return { kind: "legacy-schedule", preview: imported.legacySchedule };
  const { recognized } = applyWorkbookImport(state, imported, mode);
  return { kind: "workbook", recognized, warnings: imported.warnings };
}
