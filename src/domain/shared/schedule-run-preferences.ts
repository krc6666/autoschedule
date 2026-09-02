export type HalfRestMode = "early-finish" | "late-start";

export interface ScheduleRunPreferences {
  halfRestStaffIds: readonly string[];
  halfRestModes?: Readonly<Record<string, HalfRestMode>>;
}

export function normalizeScheduleRunPreferences(
  preferences?: ScheduleRunPreferences
): ScheduleRunPreferences {
  return {
    halfRestStaffIds: [
      ...new Set(
        (preferences?.halfRestStaffIds ?? []).map((staffId) => staffId.trim())
      ),
    ].filter(Boolean),
    halfRestModes: Object.fromEntries(
      Object.entries(preferences?.halfRestModes ?? {}).filter(
        ([staffId, mode]) =>
          staffId.trim() && (mode === "early-finish" || mode === "late-start")
      )
    ),
  };
}
