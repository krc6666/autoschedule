import type { DutyRosterImportPreview } from "../infrastructure/duty-roster-excel";
import type { AppState } from "../model";
import {
  applyWorkbookImport,
  validateDutyRosterImport,
} from "./workbook-actions";

export type WorkbookImportMode = "all" | "config" | "history" | "duty-roster";

export type PreparedWorkbookImport =
  | { kind: "duty-roster"; preview: DutyRosterImportPreview }
  | { kind: "workbook"; recognized: string; warnings: string[] };

export async function prepareWorkbookImport(
  state: AppState,
  file: File,
  mode: WorkbookImportMode,
  dutyRosterReferenceDate: string
): Promise<PreparedWorkbookImport> {
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
  const imported = await importWorkbook(file, state.staff);
  const { recognized } = applyWorkbookImport(state, imported, mode);
  return { kind: "workbook", recognized, warnings: imported.warnings };
}
