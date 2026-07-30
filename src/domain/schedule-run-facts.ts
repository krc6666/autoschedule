import type { AppState } from "../model";
import {
  createCrossDayRecoveryFacts,
  type CrossDayRecoveryFacts,
} from "./cross-day-recovery";
import { getDutyRosterForDate } from "./duty-roster";
import {
  nextDutyRestProtection,
  type NextDutyRestProtection,
} from "./next-duty-rest";
import {
  createPreviousWorkdayLoadFacts,
  type PreviousWorkdayLoadFacts,
} from "./previous-workday-load";
import {
  analyzeWorkloadPressure,
  type WorkloadPressureFacts,
} from "./workload-balance";
import {
  createScheduleFrequencyFacts,
  type ScheduleFrequencyFacts,
} from "./schedule-frequency";

export interface ScheduleRunFacts {
  currentDutyStaffId: string | null;
  nextDutyRest: NextDutyRestProtection;
  crossDayRecovery: CrossDayRecoveryFacts;
  previousWorkdayLoad: PreviousWorkdayLoadFacts;
  workloadPressure: WorkloadPressureFacts;
  scheduleFrequency: ScheduleFrequencyFacts;
}

export function createScheduleRunFacts(
  state: AppState,
  date: string
): ScheduleRunFacts {
  const currentDutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  return {
    currentDutyStaffId,
    nextDutyRest: nextDutyRestProtection(state, date),
    crossDayRecovery: createCrossDayRecoveryFacts(state, date),
    previousWorkdayLoad: createPreviousWorkdayLoadFacts(state, date),
    workloadPressure: analyzeWorkloadPressure(state),
    scheduleFrequency: createScheduleFrequencyFacts(state, date),
  };
}
