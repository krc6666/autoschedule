import type { ScheduleGenerationFacts } from "./scheduling-facts";
import {
  createCrossDayRecoveryFacts,
  type CrossDayRecoveryFacts,
} from "../reviews/cross-day-recovery";
import { getDutyRosterForDate } from "../duty-roster/roster";
import {
  createPreviousWorkdayLoadFacts,
  type PreviousWorkdayLoadFacts,
} from "./previous-workday-load";
import {
  analyzeWorkloadPressure,
  type WorkloadPressureFacts,
} from "../reviews/workload-balance";
import {
  createScheduleFrequencyFacts,
  type ScheduleFrequencyFacts,
} from "../statistics/schedule-frequency";
import { historyFatigue } from "../statistics/fatigue";
import { createHalfRestFacts, type HalfRestFacts } from "../rules/half-rest";
import {
  normalizeScheduleRunPreferences,
  type ScheduleRunPreferences,
} from "./schedule-run-preferences";

export interface ScheduleRunFacts {
  currentDutyStaffId: string | null;
  crossDayRecovery: CrossDayRecoveryFacts;
  previousWorkdayLoad: PreviousWorkdayLoadFacts;
  workloadPressure: WorkloadPressureFacts;
  scheduleFrequency: ScheduleFrequencyFacts;
  historicalFatigueByStaff: ReadonlyMap<string, number>;
  halfRest: HalfRestFacts;
}

export function createScheduleRunFacts(
  state: ScheduleGenerationFacts,
  date: string,
  preferences?: ScheduleRunPreferences
): ScheduleRunFacts {
  const currentDutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  const historicalFatigueByStaff = new Map(
    state.staff.map((person) => [
      person.id,
      historyFatigue(state.history, person.id, date, state.settings),
    ])
  );
  return {
    currentDutyStaffId,
    crossDayRecovery: createCrossDayRecoveryFacts(state, date),
    previousWorkdayLoad: createPreviousWorkdayLoadFacts(state, date),
    workloadPressure: analyzeWorkloadPressure(state),
    scheduleFrequency: createScheduleFrequencyFacts(state, date),
    historicalFatigueByStaff,
    halfRest: createHalfRestFacts(
      state,
      normalizeScheduleRunPreferences(preferences),
      currentDutyStaffId
    ),
  };
}
