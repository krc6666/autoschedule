import type { AppState, Flight, HistoryRecord } from "../model";
import { recentArchivedWorkdays } from "./fatigue";
import { timeToMinutes } from "./time";

function lateShiftOperationalStart(startTime: string, state: AppState): number | null {
  const start = timeToMinutes(startTime);
  const cutoff = timeToMinutes(state.settings.lateShiftStartTime);
  const nightEnd = timeToMinutes(state.settings.nightEnd);
  if (![start, cutoff, nightEnd].every(Number.isFinite)) return null;
  if (start >= cutoff) return start;
  if (start < nightEnd) return start + 24 * 60;
  return null;
}

export function isInFinalLateBatch(
  target: Pick<Flight, "startTime">,
  items: Array<Pick<Flight, "startTime">>,
  state: AppState
): boolean {
  const targetStart = lateShiftOperationalStart(target.startTime, state);
  const lateStarts = items
    .map((item) => lateShiftOperationalStart(item.startTime, state))
    .filter((value): value is number => value !== null);
  if (targetStart === null || !lateStarts.length) return false;
  return Math.max(...lateStarts) - targetStart <= state.settings.lateShiftLatestWindowMinutes;
}

export interface PreviousWorkdayLateProtection {
  previousDate: string | null;
  finalLateRecords: HistoryRecord[];
  protectedRecords: HistoryRecord[];
  protectedStaffIds: ReadonlySet<string>;
  highestFatiguePoints: number | null;
}

export function previousWorkdayLateProtection(state: AppState, date: string): PreviousWorkdayLateProtection {
  const previousWorkday = recentArchivedWorkdays(state.history, date, 1);
  const previousDate = previousWorkday[0]?.date ?? null;
  const finalLateRecords = previousWorkday.filter((record) => isInFinalLateBatch(record, previousWorkday, state));
  const highestFatiguePoints = finalLateRecords.length
    ? Math.max(...finalLateRecords.map((record) => record.fatiguePoints))
    : null;
  const protectedRecords = highestFatiguePoints === null
    ? []
    : finalLateRecords.filter((record) => record.fatiguePoints === highestFatiguePoints);
  return {
    previousDate,
    finalLateRecords,
    protectedRecords,
    protectedStaffIds: new Set(protectedRecords.map((record) => record.staffId)),
    highestFatiguePoints
  };
}

function normalized(value: string): string {
  return value.trim().toUpperCase();
}

export function matchesNextWorkdayRecoveryTarget(
  state: AppState,
  target: Pick<Flight, "flightNo"> & { position: string; remark: string }
): boolean {
  const flightNo = normalized(target.flightNo);
  const searchable = normalized(`${target.position} ${target.remark}`);
  return state.settings.nextWorkdayRecoveryTargets.some((item) => item.enabled
    && normalized(item.flightNo) === flightNo
    && Boolean(item.positionKeyword.trim())
    && searchable.includes(normalized(item.positionKeyword)));
}

export interface CrossDayRecoveryRisk {
  protectedWorker: boolean;
  protectedMorningTarget: boolean;
  lateFatigueExcess: number;
}

export function crossDayRecoveryRisk(
  state: AppState,
  staffId: string,
  target: Pick<Flight, "flightNo" | "startTime"> & { position: string; remark: string; fatiguePoints: number },
  date: string | null
): CrossDayRecoveryRisk {
  if (!state.settings.lateShiftRecoveryEnabled || !date) {
    return { protectedWorker: false, protectedMorningTarget: false, lateFatigueExcess: 0 };
  }
  const protection = previousWorkdayLateProtection(state, date);
  if (!protection.protectedStaffIds.has(staffId)) {
    return { protectedWorker: false, protectedMorningTarget: false, lateFatigueExcess: 0 };
  }
  const protectedMorningTarget = matchesNextWorkdayRecoveryTarget(state, target);
  const inFinalLateBatch = isInFinalLateBatch(target, state.flights, state);
  const lateFatigueExcess = inFinalLateBatch
    ? Math.max(0, target.fatiguePoints - state.settings.nextDayLateMaxFatigue)
    : 0;
  return {
    protectedWorker: protectedMorningTarget || inFinalLateBatch,
    protectedMorningTarget,
    lateFatigueExcess
  };
}
