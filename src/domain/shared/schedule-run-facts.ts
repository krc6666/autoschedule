import type { AppState } from "../../model";
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

export interface ScheduleRunFacts {
  currentDutyStaffId: string | null;
  crossDayRecovery: CrossDayRecoveryFacts;
  previousWorkdayLoad: PreviousWorkdayLoadFacts;
  workloadPressure: WorkloadPressureFacts;
  scheduleFrequency: ScheduleFrequencyFacts;
  historicalFatigueByStaff: ReadonlyMap<string, number>;
}

export function createScheduleRunFacts(
  state: AppState,
  date: string
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
  };
}
