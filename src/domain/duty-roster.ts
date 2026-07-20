import type { AppState, DutyRosterOverride, Staff } from "../model";

export type DutyRosterSlot = "cx-preflight" | "duty" | "standby-0" | "standby-1";

export interface DutyRosterAssignment extends DutyRosterOverride {
  adjusted: boolean;
}

export interface DutyRosterPersonStats {
  staff: Staff;
  cxPreflightDates: string[];
  dutyDates: string[];
  standbyDates: string[];
}

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function monthlyDutyDates(date: string): string[] {
  const parsed = parseDate(date);
  if (!parsed) return [];
  const dayCount = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  return Array.from({ length: dayCount }, (_, index) => index + 1)
    .filter((day) => day % 2 === parsed.day % 2)
    .map((day) => `${String(parsed.year).padStart(4, "0")}-${String(parsed.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

export function rosterEligibleStaff(state: AppState): Staff[] {
  return state.staff.filter((person) => person.staffType === "常规" && person.status === "正常");
}

export function cxPreflightEligibleStaff(state: AppState): Staff[] {
  return rosterEligibleStaff(state).filter((person) => person.cxPreflightQualified);
}

export function dutyQualifiedStaff(state: AppState): Staff[] {
  return rosterEligibleStaff(state).filter((person) => person.dutyQualified);
}

function pickFairly(pool: Staff[], counts: Map<string, number>, start: number, excludedIds: Set<string>, count: number): Array<string | null> {
  if (!pool.length) return Array.from({ length: count }, () => null);
  const selected = pool
    .filter((person) => !excludedIds.has(person.id))
    .map((person, index) => ({
      person,
      count: counts.get(person.id) ?? 0,
      rotationDistance: (index - (start % pool.length) + pool.length) % pool.length
    }))
    .sort((left, right) => left.count - right.count || left.rotationDistance - right.rotationDistance)
    .slice(0, count)
    .map(({ person }) => person.id);
  return [...selected, ...Array.from({ length: count - selected.length }, () => null)];
}

function defaultMonthlyDutyRoster(state: AppState, date: string): DutyRosterAssignment[] {
  const dates = monthlyDutyDates(date);
  const regular = rosterEligibleStaff(state);
  const cxPool = cxPreflightEligibleStaff(state);
  const dutyPool = dutyQualifiedStaff(state);
  const dutyCounts = new Map(dutyPool.map((person) => [person.id, 0]));
  const standbyCounts = new Map(regular.map((person) => [person.id, 0]));
  const cxByDate = dates.map((_, ordinal) => cxPool.length ? cxPool[ordinal % cxPool.length]!.id : null);
  const dutyByDate = dates.map((_, ordinal) => {
    const cxPreflightStaffId = cxByDate[ordinal] ?? null;
    const excluded = new Set(cxPreflightStaffId ? [cxPreflightStaffId] : []);
    const dutyStaffId = pickFairly(dutyPool, dutyCounts, ordinal, excluded, 1)[0] ?? null;
    if (dutyStaffId) dutyCounts.set(dutyStaffId, (dutyCounts.get(dutyStaffId) ?? 0) + 1);
    return dutyStaffId;
  });
  for (let pass = 0; pass < dates.length * dutyPool.length; pass += 1) {
    const ordered = [...dutyPool].sort((left, right) => (dutyCounts.get(left.id) ?? 0) - (dutyCounts.get(right.id) ?? 0));
    const least = ordered[0];
    const most = ordered.at(-1);
    if (!least || !most || (dutyCounts.get(most.id) ?? 0) - (dutyCounts.get(least.id) ?? 0) <= 1) break;
    const replaceIndex = dutyByDate.findIndex((staffId, index) => staffId === most.id && cxByDate[index] !== least.id);
    if (replaceIndex < 0) break;
    dutyByDate[replaceIndex] = least.id;
    dutyCounts.set(most.id, (dutyCounts.get(most.id) ?? 0) - 1);
    dutyCounts.set(least.id, (dutyCounts.get(least.id) ?? 0) + 1);
  }
  return dates.map((item, ordinal) => {
    const cxPreflightStaffId = cxByDate[ordinal] ?? null;
    const dutyStaffId = dutyByDate[ordinal] ?? null;
    const excluded = new Set([cxPreflightStaffId, dutyStaffId].filter((staffId): staffId is string => Boolean(staffId)));
    const standbyStaffIds = pickFairly(regular, standbyCounts, ordinal * 2, excluded, 2) as [string | null, string | null];
    standbyStaffIds.forEach((staffId) => {
      if (staffId) standbyCounts.set(staffId, (standbyCounts.get(staffId) ?? 0) + 1);
    });
    return { date: item, cxPreflightStaffId, dutyStaffId, standbyStaffIds, adjusted: false };
  });
}

function validOverride(state: AppState, override: DutyRosterOverride): boolean {
  const regularIds = new Set(rosterEligibleStaff(state).map((person) => person.id));
  const cxIds = new Set(cxPreflightEligibleStaff(state).map((person) => person.id));
  const dutyIds = new Set(dutyQualifiedStaff(state).map((person) => person.id));
  const ids = [override.cxPreflightStaffId, override.dutyStaffId, ...override.standbyStaffIds].filter((id): id is string => Boolean(id));
  if (new Set(ids).size !== ids.length) return false;
  if (override.cxPreflightStaffId && !cxIds.has(override.cxPreflightStaffId)) return false;
  if (override.dutyStaffId && !dutyIds.has(override.dutyStaffId)) return false;
  return [override.dutyStaffId, ...override.standbyStaffIds].every((id) => !id || regularIds.has(id));
}

export function getDutyRosterForDate(state: AppState, date: string): DutyRosterAssignment {
  const override = state.dutyRosterOverrides.find((item) => item.date === date);
  if (override && validOverride(state, override)) return { ...override, standbyStaffIds: [...override.standbyStaffIds], adjusted: true };
  return defaultMonthlyDutyRoster(state, date).find((item) => item.date === date)
    ?? { date, cxPreflightStaffId: null, dutyStaffId: null, standbyStaffIds: [null, null], adjusted: false };
}

export function getMonthlyDutyRoster(state: AppState, date: string): DutyRosterAssignment[] {
  return monthlyDutyDates(date).map((item) => getDutyRosterForDate(state, item));
}

export function getMonthlyDutyRosterStats(state: AppState, date: string): DutyRosterPersonStats[] {
  const rows = getMonthlyDutyRoster(state, date);
  return rosterEligibleStaff(state).map((staff) => ({
    staff,
    cxPreflightDates: rows.filter((row) => row.cxPreflightStaffId === staff.id).map((row) => row.date),
    dutyDates: rows.filter((row) => row.dutyStaffId === staff.id).map((row) => row.date),
    standbyDates: rows.filter((row) => row.standbyStaffIds.includes(staff.id)).map((row) => row.date)
  }));
}

export function updateDutyRosterSlot(state: AppState, date: string, slot: DutyRosterSlot, staffId: string): string | null {
  const current = getDutyRosterForDate(state, date);
  const regularIds = new Set(rosterEligibleStaff(state).map((person) => person.id));
  const cxIds = new Set(cxPreflightEligibleStaff(state).map((person) => person.id));
  const dutyIds = new Set(dutyQualifiedStaff(state).map((person) => person.id));
  if (slot === "cx-preflight") {
    if (!cxIds.has(staffId)) return "该人员不具备CX航前资质或当前不可用";
    if ([current.dutyStaffId, ...current.standbyStaffIds].includes(staffId)) return "CX航前不能与值班或备勤由同一人承担";
    current.cxPreflightStaffId = staffId;
  } else {
    if (!regularIds.has(staffId)) return "值班和备勤只能选择状态正常的常规人员";
    if (slot === "duty" && !dutyIds.has(staffId)) return "该人员不具备值班资质或当前不可用";
    if (staffId === current.cxPreflightStaffId) return "值班或备勤不能与CX航前由同一人承担";
    const values: [string | null, string | null, string | null] = [current.dutyStaffId, current.standbyStaffIds[0], current.standbyStaffIds[1]];
    const targetIndex = slot === "duty" ? 0 : slot === "standby-0" ? 1 : 2;
    const sourceIndex = values.indexOf(staffId);
    if (sourceIndex >= 0 && sourceIndex !== targetIndex) {
      const targetValue = values[targetIndex] ?? null;
      values[targetIndex] = values[sourceIndex] ?? null;
      values[sourceIndex] = targetValue;
    }
    else values[targetIndex] = staffId;
    if (new Set(values.filter(Boolean)).size !== values.filter(Boolean).length) return "值班和两名备勤不能重复";
    if (values[0] && !dutyIds.has(values[0])) return "调整后值班人员不具备值班资质";
    current.dutyStaffId = values[0];
    current.standbyStaffIds = [values[1], values[2]];
  }
  const override: DutyRosterOverride = {
    date,
    cxPreflightStaffId: current.cxPreflightStaffId,
    dutyStaffId: current.dutyStaffId,
    standbyStaffIds: [...current.standbyStaffIds]
  };
  state.dutyRosterOverrides = [...state.dutyRosterOverrides.filter((item) => item.date !== date), override];
  return null;
}

export function clearDutyRosterOverride(state: AppState, date: string): void {
  state.dutyRosterOverrides = state.dutyRosterOverrides.filter((item) => item.date !== date);
}

export function dutyFatigueByStaff(state: AppState, date: string): Map<string, number> {
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  return dutyStaffId ? new Map([[dutyStaffId, state.settings.dutyFatiguePoints]]) : new Map();
}
