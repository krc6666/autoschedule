import {
  cxPreflightEligibleStaff,
  dutyQualifiedStaff,
  getMonthlyDutyRoster,
  getMonthlyDutyRosterStats,
  rosterEligibleStaff,
} from "../../domain/duty-roster/roster";
import type { AppState } from "../../model";

function countRange(counts: number[]) {
  if (!counts.length) return { min: 0, max: 0, difference: 0 };
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return { min, max, difference: max - min };
}

export function buildDutyRosterPageModel(state: AppState, date: string) {
  const monthly = getMonthlyDutyRoster(state, date);
  const stats = getMonthlyDutyRosterStats(state, date);
  const cxStaff = cxPreflightEligibleStaff(state);
  const dutyStaff = dutyQualifiedStaff(state);
  const regularStaff = rosterEligibleStaff(state);
  const cxIds = new Set(cxStaff.map((person) => person.id));
  const cxStats = stats.filter((item) => cxIds.has(item.staff.id));
  const missingDuty = stats.filter(
    (item) => item.staff.dutyQualified && item.dutyDates.length === 0
  );
  const dutySeatShortage =
    monthly.filter((row) => row.dutyStaffId).length < dutyStaff.length;
  const standbyMissing = stats.filter((item) => item.standbyDates.length < 2);
  const standbyCapacity = monthly.reduce(
    (sum, row) =>
      sum +
      Math.min(2, Math.max(0, regularStaff.length - (row.dutyStaffId ? 1 : 0))),
    0
  );
  return {
    monthly,
    stats,
    cxStaff,
    dutyStaff,
    regularStaff,
    cxStats,
    cxRange: countRange(cxStats.map((item) => item.cxPreflightDates.length)),
    dutyRange: countRange(
      stats
        .filter((item) => item.staff.dutyQualified)
        .map((item) => item.dutyDates.length)
    ),
    standbyRange: countRange(stats.map((item) => item.standbyDates.length)),
    firstRoundCovered: stats.filter(
      (item) => item.staff.dutyQualified && item.dutyDates.length > 0
    ).length,
    missingDuty,
    dutySeatShortage,
    standbyMissing,
    standbySeatShortage: standbyCapacity < regularStaff.length * 2,
    unfilledCxCount: monthly.filter((row) => !row.cxPreflightStaffId).length,
    hasMonthlyAdjustments: monthly.some((row) => row.adjusted),
  };
}

export type DutyRosterPageModel = ReturnType<typeof buildDutyRosterPageModel>;
