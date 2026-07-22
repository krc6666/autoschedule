import type { WorkbookImport } from "../infrastructure/excel";
import type { AppState } from "../model";
import { createId, orderPositionRules } from "../utils";

export type ImportMode = "all" | "config" | "history";

export interface AppliedWorkbookImport {
  changedConfig: boolean;
  recognized: string;
}

export function applyWorkbookImport(state: AppState, imported: WorkbookImport, mode: ImportMode): AppliedWorkbookImport {
  const importConfig = mode !== "history";
  const importHistory = mode !== "config";
  if (importConfig && imported.staff?.length) state.staff = imported.staff;
  if (importConfig && imported.positionRules?.length) state.positionRules = orderPositionRules(imported.positionRules);
  if (importConfig && imported.templates?.length) state.templates = imported.templates;
  if (importConfig && imported.flights?.length && !imported.templates?.length) {
    state.templates = imported.flights.map(({ id, bookedPassengers: _bookedPassengers, ...flight }) => ({ ...structuredClone(flight), id: createId("template") }));
  }
  if (mode === "all" && imported.flights?.length) state.flights = imported.flights;
  if (importHistory && imported.history) {
    const incomingKeys = new Set(imported.history.map((item) => `${item.date}|${item.flightNo}|${item.position}|${item.staffName}`));
    state.history = [...state.history.filter((item) => !incomingKeys.has(`${item.date}|${item.flightNo}|${item.position}|${item.staffName}`)), ...imported.history];
  }
  const changedConfig = importConfig && Boolean(imported.staff?.length || imported.flights?.length || imported.templates?.length || imported.positionRules?.length);
  if (changedConfig) {
    state.assignments = [];
    state.activeScheduleDate = null;
  }
  const recognized = [
    imported.staff?.length && `${imported.staff.length} 人`,
    imported.flights?.length && `${imported.flights.length} 个航班计划`,
    imported.templates?.length && `${imported.templates.length} 个航班模板`,
    imported.positionRules?.length && `${imported.positionRules.length} 条岗位规则`,
    imported.history?.length && `${imported.history.length} 条历史负荷`
  ].filter(Boolean).join("、");
  return { changedConfig, recognized };
}
