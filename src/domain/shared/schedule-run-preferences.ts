export interface ScheduleRunPreferences {
  halfRestStaffIds: readonly string[];
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
  };
}
