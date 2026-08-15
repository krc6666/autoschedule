import type { WorkbookImport } from "../infrastructure/excel";
import type { DutyRosterImportPreview } from "../infrastructure/duty-roster-excel";
import {
  clearUnqualifiedStandbyOverrides,
  getDutyRosterForDate,
} from "../domain/duty-roster/roster";
import { applyScheduleSettingsPatch } from "../domain/rules/schedule-settings";
import { clearActiveSchedule } from "../domain/kernel/schedule-lifecycle";
import type { AppState } from "../model";
import { createId, orderPositionRules } from "../utils";
import {
  createEmptyWeeklyFlightPlans,
  normalizeWeeklyFlightNo,
  replaceWeeklyFlightPlan,
} from "../domain/flights/weekly-flight-plan";

export type ImportMode = "all" | "config" | "history";

export interface AppliedWorkbookImport {
  changedConfig: boolean;
  recognized: string;
}

export function validateDutyRosterImport(
  state: AppState,
  preview: DutyRosterImportPreview
): DutyRosterImportPreview {
  const conflicts = preview.rows.flatMap((row) => {
    if (row.dutyIncluded === false) return [];
    const cxStaffId = getDutyRosterForDate(state, row.date).cxPreflightStaffId;
    if (!cxStaffId || cxStaffId !== row.dutyStaffId) return [];
    const name =
      state.staff.find((person) => person.id === cxStaffId)?.name ??
      `#${cxStaffId}`;
    return [`${row.date}的值班人员${name}同时承担CX航前，请先调整其中一个安排`];
  });
  const errors = [...new Set([...preview.errors, ...conflicts])];
  return {
    ...preview,
    errors,
    canApply: preview.recognizedAssignments > 0 && !errors.length,
  };
}

export function applyDutyRosterImport(
  state: AppState,
  preview: DutyRosterImportPreview
): { importedDays: number; importedAssignments: number } {
  const validated = validateDutyRosterImport(state, preview);
  if (!validated.canApply) return { importedDays: 0, importedAssignments: 0 };
  const existingByDate = new Map(
    preview.rows.map((row) => [row.date, getDutyRosterForDate(state, row.date)])
  );
  state.dutyRosterOverrides = [
    ...state.dutyRosterOverrides.filter(
      (existing) => !preview.rows.some((row) => row.date === existing.date)
    ),
    ...preview.rows.map((row) => ({
      date: row.date,
      cxPreflightStaffId:
        existingByDate.get(row.date)?.cxPreflightStaffId ?? null,
      dutyStaffId:
        row.dutyIncluded === false
          ? (existingByDate.get(row.date)?.dutyStaffId ?? null)
          : row.dutyStaffId,
      standbyStaffIds:
        row.standbyIncluded === false
          ? ([
              ...(existingByDate.get(row.date)?.standbyStaffIds ?? [
                null,
                null,
              ]),
            ] as [string | null, string | null])
          : ([...row.standbyStaffIds] as [string | null, string | null]),
    })),
  ];
  return {
    importedDays: preview.rows.length,
    importedAssignments: preview.recognizedAssignments,
  };
}

export function applyWorkbookImport(
  state: AppState,
  imported: WorkbookImport,
  mode: ImportMode
): AppliedWorkbookImport {
  const importConfig = mode !== "history";
  const importHistory = mode !== "config";
  if (importConfig && imported.staff?.length) {
    state.staff = imported.staff;
    clearUnqualifiedStandbyOverrides(state);
  }
  if (importConfig && imported.positionRules?.length)
    state.positionRules = orderPositionRules(imported.positionRules);
  if (importConfig && imported.templates?.length)
    state.templates = imported.templates;
  if (importConfig && imported.settings)
    state.settings = applyScheduleSettingsPatch(
      state.settings,
      imported.settings
    );
  if (importConfig && imported.flights?.length && !imported.templates?.length) {
    state.templates = imported.flights.map(
      ({ id, bookedPassengers: _bookedPassengers, ...flight }) => ({
        ...structuredClone(flight),
        id: createId("template"),
      })
    );
  }
  if (importConfig && imported.weeklyFlightPlans) {
    const availableFlightNos = new Set(
      state.templates.map((template) =>
        normalizeWeeklyFlightNo(template.flightNo)
      )
    );
    state.weeklyFlightPlans = imported.weeklyFlightPlans.reduce(
      (plans, entry) =>
        replaceWeeklyFlightPlan(
          plans,
          entry.weekday,
          entry.flightNos.filter((flightNo) =>
            availableFlightNos.has(normalizeWeeklyFlightNo(flightNo))
          )
        ),
      createEmptyWeeklyFlightPlans()
    );
  }
  if (mode === "all" && imported.flights?.length)
    state.flights = imported.flights;
  if (importHistory && imported.history) {
    const incomingKeys = new Set(
      imported.history.map(
        (item) =>
          `${item.date}|${item.flightNo}|${item.position}|${item.staffName}`
      )
    );
    state.history = [
      ...state.history.filter(
        (item) =>
          !incomingKeys.has(
            `${item.date}|${item.flightNo}|${item.position}|${item.staffName}`
          )
      ),
      ...imported.history,
    ];
  }
  const changedConfig =
    importConfig &&
    Boolean(
      imported.staff?.length ||
      imported.flights?.length ||
      imported.templates?.length ||
      imported.weeklyFlightPlans ||
      imported.positionRules?.length ||
      imported.settings
    );
  if (changedConfig) {
    clearActiveSchedule(state);
  }
  const recognized = [
    importConfig && imported.staff?.length && `${imported.staff.length} 人`,
    importConfig &&
      imported.flights?.length &&
      `${imported.flights.length} 个航班计划`,
    importConfig &&
      imported.templates?.length &&
      `${imported.templates.length} 个航班模板`,
    importConfig && imported.weeklyFlightPlans && "每周航班计划",
    importConfig &&
      imported.positionRules?.length &&
      `${imported.positionRules.length} 条岗位规则`,
    importConfig && imported.settings && "规则配置",
    importHistory &&
      imported.history?.length &&
      `${imported.history.length} 条历史负荷`,
  ]
    .filter(Boolean)
    .join("、");
  return { changedConfig, recognized };
}
