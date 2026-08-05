import type { AppState, Flight, HistoryRecord } from "../../model";
import type { LateShiftRecoveryPositionRule } from "../rules/structured-policy-contract";
import { recentArchivedWorkdays } from "../statistics/fatigue";
import { timeToMinutes } from "../shared/time";
import { endsAfterLateShiftThreshold } from "./late-priority-policy";

export function isLateEndingWork(
  target: Pick<Flight, "startTime" | "endTime">,
  state: AppState
): boolean {
  return endsAfterLateShiftThreshold(target, state.settings.lateShiftEndTime);
}

export interface PreviousWorkdayLateProtection {
  previousDate: string | null;
  finalLateRecords: HistoryRecord[];
  protectedRecords: HistoryRecord[];
  protectedStaffIds: ReadonlySet<string>;
}

export interface CrossDayRecoveryFacts {
  previousWorkday: PreviousWorkdayLateProtection;
  cutoffByStaffId: ReadonlyMap<string, NextWorkdayCutoffProtection>;
}

function normalized(value: string): string {
  return value.trim().toUpperCase();
}

export function matchesLateShiftRecoveryPosition(
  state: AppState,
  target: Pick<Flight, "flightNo"> & { position: string; remark: string }
): boolean {
  return matchingLateShiftRecoveryPositionRules(state, target).length > 0;
}

export function matchingLateShiftRecoveryPositionRules(
  state: AppState,
  target: Pick<Flight, "flightNo"> & { position: string; remark: string }
): LateShiftRecoveryPositionRule[] {
  const flightNo = normalized(target.flightNo);
  return state.settings.lateShiftRecoveryPositionRules.filter((rule) => {
    if (!rule.enabled || !rule.keyword.trim()) return false;
    if (rule.flightNo.trim() && normalized(rule.flightNo) !== flightNo)
      return false;
    const value =
      rule.matchField === "position" ? target.position : target.remark;
    return normalized(value).includes(normalized(rule.keyword));
  });
}

export function previousWorkdayLateProtection(
  state: AppState,
  date: string
): PreviousWorkdayLateProtection {
  const previousWorkday = recentArchivedWorkdays(state.history, date, 1);
  const previousDate = previousWorkday[0]?.date ?? null;
  const finalLateRecords = previousWorkday.filter((record) =>
    isLateEndingWork(record, state)
  );
  const protectedRecords = finalLateRecords.filter((record) =>
    matchesLateShiftRecoveryPosition(state, record)
  );
  return {
    previousDate,
    finalLateRecords,
    protectedRecords,
    protectedStaffIds: new Set(
      protectedRecords.map((record) => record.staffId)
    ),
  };
}

function cutoffProtectionFromPreviousWorkday(
  state: AppState,
  staffId: string,
  protection: PreviousWorkdayLateProtection
): NextWorkdayCutoffProtection | null {
  const sourceRecords = protection.protectedRecords.filter(
    (record) => record.staffId === staffId
  );
  const configured = sourceRecords
    .flatMap((record) =>
      matchingLateShiftRecoveryPositionRules(state, record).map((rule) => ({
        rule,
        minutes: timeToMinutes(rule.nextWorkdayCutoffTime),
      }))
    )
    .filter(
      (item) => item.rule.nextWorkdayCutoffTime && Number.isFinite(item.minutes)
    )
    .sort((left, right) => left.minutes - right.minutes)[0];
  if (!configured) return null;
  return {
    cutoffTime: configured.rule.nextWorkdayCutoffTime,
    cutoffMinutes: configured.minutes,
    previousEndMinutes: Math.max(...sourceRecords.map(recordEndMinutes)),
    sourceRecords,
  };
}

export function createCrossDayRecoveryFacts(
  state: AppState,
  date: string
): CrossDayRecoveryFacts {
  const previousWorkday = previousWorkdayLateProtection(state, date);
  const cutoffByStaffId = new Map<string, NextWorkdayCutoffProtection>();
  previousWorkday.protectedStaffIds.forEach((staffId) => {
    const protection = cutoffProtectionFromPreviousWorkday(
      state,
      staffId,
      previousWorkday
    );
    if (protection) cutoffByStaffId.set(staffId, protection);
  });
  return { previousWorkday, cutoffByStaffId };
}

export function matchesNextWorkdayRecoveryTarget(
  state: AppState,
  target: Pick<Flight, "flightNo"> & { position: string; remark: string }
): boolean {
  const flightNo = normalized(target.flightNo);
  const searchable = normalized(`${target.position} ${target.remark}`);
  return state.settings.nextWorkdayRecoveryTargets.some(
    (item) =>
      item.enabled &&
      normalized(item.flightNo) === flightNo &&
      Boolean(item.positionKeyword.trim()) &&
      searchable.includes(normalized(item.positionKeyword))
  );
}

export interface CrossDayRecoveryRisk {
  protectedWorker: boolean;
  protectedMorningTarget: boolean;
  protectedLatePriorityTarget: boolean;
}

export interface NextWorkdayCutoffProtection {
  cutoffTime: string;
  cutoffMinutes: number;
  previousEndMinutes: number;
  sourceRecords: HistoryRecord[];
}

function operationalMinutes(value: string, state: AppState): number {
  const minutes = timeToMinutes(value);
  const nightEnd = timeToMinutes(state.settings.nightEnd);
  return minutes < nightEnd ? minutes + 24 * 60 : minutes;
}

function recordEndMinutes(record: HistoryRecord): number {
  const start = timeToMinutes(record.startTime);
  let end = timeToMinutes(record.endTime);
  if (end <= start) end += 24 * 60;
  return end;
}

export function nextWorkdayCutoffProtection(
  state: AppState,
  staffId: string,
  date: string | null,
  facts?: CrossDayRecoveryFacts
): NextWorkdayCutoffProtection | null {
  if (!state.settings.lateShiftRecoveryEnabled || !date) return null;
  if (facts) return facts.cutoffByStaffId.get(staffId) ?? null;
  return cutoffProtectionFromPreviousWorkday(
    state,
    staffId,
    previousWorkdayLateProtection(state, date)
  );
}

export function isNextWorkdayCutoffConflict(
  state: AppState,
  staffId: string,
  targetStartTime: string,
  date: string | null,
  facts?: CrossDayRecoveryFacts
): boolean {
  const protection = nextWorkdayCutoffProtection(state, staffId, date, facts);
  return Boolean(
    protection &&
    operationalMinutes(targetStartTime, state) >= protection.cutoffMinutes
  );
}

export function crossDayRecoveryRisk(
  state: AppState,
  staffId: string,
  target: Pick<Flight, "flightNo" | "startTime" | "endTime"> & {
    position: string;
    remark: string;
    fatiguePoints: number;
  },
  date: string | null,
  facts?: CrossDayRecoveryFacts
): CrossDayRecoveryRisk {
  if (!state.settings.lateShiftRecoveryEnabled || !date) {
    return {
      protectedWorker: false,
      protectedMorningTarget: false,
      protectedLatePriorityTarget: false,
    };
  }
  const protection =
    facts?.previousWorkday ?? previousWorkdayLateProtection(state, date);
  if (!protection.protectedStaffIds.has(staffId)) {
    return {
      protectedWorker: false,
      protectedMorningTarget: false,
      protectedLatePriorityTarget: false,
    };
  }
  const protectedMorningTarget = matchesNextWorkdayRecoveryTarget(
    state,
    target
  );
  const protectedLatePriorityTarget =
    isLateEndingWork(target, state) &&
    matchesLateShiftRecoveryPosition(state, target);
  return {
    protectedWorker: protectedMorningTarget || protectedLatePriorityTarget,
    protectedMorningTarget,
    protectedLatePriorityTarget,
  };
}
