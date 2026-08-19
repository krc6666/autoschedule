import type {
  Assignment,
  HistoryRecord,
  PositionRule,
  Staff,
} from "../../model";
import type { SchedulingFacts } from "../shared/scheduling-facts";
import { assignmentRule } from "../flights/schedule-position-rules";
import {
  endsAfterLateShiftThreshold,
  latePriorityKindForLabel,
  latePriorityKindLabel,
  latePriorityFrequencyKinds,
  LATE_PRIORITY_ALLOWED_DIFFERENCE,
  LATE_PRIORITY_FREQUENCY_ORDER,
  normalizeLatePriorityFlightNumber,
  normalizeLatePriorityPositionReference,
  type LatePriorityKindLabel,
} from "../reviews/late-priority-policy";
import {
  latePriorityFlightInScope,
  normalizeLatePriorityFlightNumbers,
} from "./late-priority-flight-scope";

export type LatePriorityStatisticsCategory = LatePriorityKindLabel;
export const LATE_PRIORITY_STATISTICS_CATEGORIES: readonly LatePriorityStatisticsCategory[] =
  LATE_PRIORITY_FREQUENCY_ORDER.map(latePriorityKindLabel);

export interface LatePriorityStatisticsDetail {
  date: string;
  flightNo: string;
  position: string;
}

export interface MonthlyLatePriorityCategoryStatistics {
  qualified: boolean;
  details: LatePriorityStatisticsDetail[];
  visibleDetails: LatePriorityStatisticsDetail[];
  manualCorrection: number;
  effectiveCount: number;
}

export interface MonthlyLatePriorityStatisticsRow {
  staff: Staff;
  totalCount: number;
  categories: Record<
    LatePriorityStatisticsCategory,
    MonthlyLatePriorityCategoryStatistics
  >;
}

export interface MonthlyLatePriorityStatistics {
  month: string;
  flightNumbers: string[];
  rows: MonthlyLatePriorityStatisticsRow[];
  ranges: Record<
    LatePriorityStatisticsCategory,
    { min: number; max: number; difference: number; allowedDifference: number }
  >;
}

function categoryKinds(
  target: Pick<PositionRule, "name" | "remark">
): LatePriorityStatisticsCategory[] {
  const kinds = latePriorityFrequencyKinds(target);
  return LATE_PRIORITY_STATISTICS_CATEGORIES.filter((category) =>
    kinds.includes(latePriorityKindForLabel(category))
  );
}

function scopedRules(state: SchedulingFacts): PositionRule[] {
  return state.positionRules.filter(
    (rule) =>
      rule.category === "常规" &&
      latePriorityFlightInScope(
        state.settings.latePriorityFlightNumbers,
        rule.flightNo
      ) &&
      categoryKinds(rule).length > 0
  );
}

function matchingRule(
  rules: readonly PositionRule[],
  flightNo: string,
  position: string
): PositionRule | undefined {
  return rules.find(
    (rule) =>
      normalizeLatePriorityFlightNumber(rule.flightNo) ===
        normalizeLatePriorityFlightNumber(flightNo) &&
      normalizeLatePriorityPositionReference(rule.name) ===
        normalizeLatePriorityPositionReference(position)
  );
}

function emptyCategories(): MonthlyLatePriorityStatisticsRow["categories"] {
  return Object.fromEntries(
    LATE_PRIORITY_STATISTICS_CATEGORIES.map((category) => [
      category,
      {
        qualified: false,
        details: [],
        visibleDetails: [],
        manualCorrection: 0,
        effectiveCount: 0,
      },
    ])
  ) as unknown as MonthlyLatePriorityStatisticsRow["categories"];
}

function detailKey(
  staffId: string,
  category: LatePriorityStatisticsCategory,
  detail: LatePriorityStatisticsDetail
): string {
  return [
    staffId,
    detail.date,
    normalizeLatePriorityFlightNumber(detail.flightNo),
    category,
  ].join("\u0000");
}

function sortedDetails(
  details: readonly LatePriorityStatisticsDetail[]
): LatePriorityStatisticsDetail[] {
  return [...details].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.flightNo.localeCompare(right.flightNo) ||
      left.position.localeCompare(right.position)
  );
}

function statisticsRange(
  rows: readonly MonthlyLatePriorityStatisticsRow[],
  category: LatePriorityStatisticsCategory
): MonthlyLatePriorityStatistics["ranges"][LatePriorityStatisticsCategory] {
  const counts = rows
    .filter((row) => row.categories[category].qualified)
    .map((row) => row.categories[category].effectiveCount);
  const min = counts.length ? Math.min(...counts) : 0;
  const max = counts.length ? Math.max(...counts) : 0;
  return {
    min,
    max,
    difference: max - min,
    allowedDifference:
      LATE_PRIORITY_ALLOWED_DIFFERENCE[latePriorityKindForLabel(category)],
  };
}

function actualTotalCount(row: MonthlyLatePriorityStatisticsRow): number {
  return LATE_PRIORITY_STATISTICS_CATEGORIES.reduce(
    (sum, category) => sum + row.categories[category].details.length,
    0
  );
}

export function latePriorityStatisticsFlightNumbers(
  state: SchedulingFacts
): string[] {
  return normalizeLatePriorityFlightNumbers(
    state.settings.latePriorityFlightNumbers
  );
}

export function buildMonthlyLatePriorityStatistics(
  state: SchedulingFacts,
  date: string
): MonthlyLatePriorityStatistics {
  const month = date.slice(0, 7);
  const flightNumbers = latePriorityStatisticsFlightNumbers(state);
  const rules = scopedRules(state);
  const eligibleStaff = state.staff.filter(
    (person) =>
      person.staffType === "常规" &&
      person.status === "正常" &&
      rules.some((rule) => rule.qualifiedStaffIds.includes(person.id))
  );
  const rowByStaffId = new Map<string, MonthlyLatePriorityStatisticsRow>(
    eligibleStaff.map((staff) => [
      staff.id,
      { staff, totalCount: 0, categories: emptyCategories() },
    ])
  );
  for (const row of rowByStaffId.values()) {
    for (const category of LATE_PRIORITY_STATISTICS_CATEGORIES) {
      const kind = latePriorityKindForLabel(category);
      row.categories[category].manualCorrection = (
        state.latePriorityFrequencyAdjustments ?? []
      )
        .filter((item) => {
          const itemFlight = normalizeLatePriorityFlightNumber(item.flightNo);
          return (
            item.month === month &&
            item.staffId === row.staff.id &&
            item.kind === kind &&
            flightNumbers.includes(itemFlight) &&
            rules.some(
              (rule) =>
                normalizeLatePriorityFlightNumber(rule.flightNo) ===
                  itemFlight && latePriorityFrequencyKinds(rule).includes(kind)
            )
          );
        })
        .reduce((sum, item) => sum + item.delta + (item.resetBaseline ?? 0), 0);
    }
  }
  for (const row of rowByStaffId.values()) {
    for (const category of LATE_PRIORITY_STATISTICS_CATEGORIES) {
      row.categories[category].qualified = rules.some(
        (rule) =>
          categoryKinds(rule).includes(category) &&
          rule.qualifiedStaffIds.includes(row.staff.id)
      );
    }
  }
  const seen = new Set<string>();
  const addDetail = (
    staffId: string,
    category: LatePriorityStatisticsCategory,
    detail: LatePriorityStatisticsDetail
  ): void => {
    const row = rowByStaffId.get(staffId);
    if (!row?.categories[category].qualified) return;
    const key = detailKey(staffId, category, detail);
    if (seen.has(key)) return;
    seen.add(key);
    row.categories[category].details.push(detail);
  };
  const activeDate =
    state.activeScheduleDate === date && state.assignments.length ? date : null;
  const addHistoricalRecord = (record: HistoryRecord): void => {
    const rule = matchingRule(rules, record.flightNo, record.position);
    if (
      !rule ||
      !rule.qualifiedStaffIds.includes(record.staffId) ||
      !endsAfterLateShiftThreshold(record, state.settings.lateShiftEndTime)
    )
      return;
    for (const category of categoryKinds({
      name: record.position,
      remark: record.remark,
    })) {
      if (!categoryKinds(rule).includes(category)) continue;
      addDetail(record.staffId, category, {
        date: record.date,
        flightNo: record.flightNo,
        position: record.position,
      });
    }
  };
  state.history
    .filter(
      (record) => record.date.startsWith(month) && record.date !== activeDate
    )
    .forEach(addHistoricalRecord);

  const addCurrentAssignment = (assignment: Assignment): void => {
    const rule = assignmentRule(state, assignment);
    if (
      !activeDate ||
      !assignment.staffId ||
      assignment.status !== "assigned" ||
      !rule ||
      !rules.some((item) => item.id === rule.id) ||
      !rule.qualifiedStaffIds.includes(assignment.staffId) ||
      !endsAfterLateShiftThreshold(assignment, state.settings.lateShiftEndTime)
    )
      return;
    for (const category of categoryKinds(rule)) {
      addDetail(assignment.staffId, category, {
        date: activeDate,
        flightNo: assignment.flightNo,
        position: assignment.position,
      });
    }
  };
  state.assignments.forEach(addCurrentAssignment);

  const staffOrder = new Map(
    state.staff.map((person, index) => [person.id, index])
  );
  const rows = [...rowByStaffId.values()]
    .map((row) => {
      for (const category of LATE_PRIORITY_STATISTICS_CATEGORIES) {
        row.categories[category].details = sortedDetails(
          row.categories[category].details
        );
        const kind = latePriorityKindForLabel(category);
        const remainingBaseline = new Map<string, number>();
        for (const adjustment of state.latePriorityFrequencyAdjustments ?? []) {
          if (
            adjustment.month !== month ||
            adjustment.staffId !== row.staff.id ||
            adjustment.kind !== kind ||
            !flightNumbers.includes(
              normalizeLatePriorityFlightNumber(adjustment.flightNo)
            )
          )
            continue;
          const flightNo = normalizeLatePriorityFlightNumber(
            adjustment.flightNo
          );
          remainingBaseline.set(
            flightNo,
            (remainingBaseline.get(flightNo) ?? 0) +
              (adjustment.resetBaseline ?? 0)
          );
        }
        row.categories[category].visibleDetails = row.categories[
          category
        ].details.filter((detail) => {
          const flightNo = normalizeLatePriorityFlightNumber(detail.flightNo);
          const remaining = remainingBaseline.get(flightNo) ?? 0;
          if (remaining <= 0) return true;
          remainingBaseline.set(flightNo, remaining - 1);
          return false;
        });
      }
      for (const category of LATE_PRIORITY_STATISTICS_CATEGORIES) {
        row.categories[category].effectiveCount = Math.max(
          0,
          row.categories[category].visibleDetails.length +
            row.categories[category].manualCorrection
        );
      }
      row.totalCount = LATE_PRIORITY_STATISTICS_CATEGORIES.reduce(
        (sum, category) => sum + row.categories[category].effectiveCount,
        0
      );
      return row;
    })
    .sort(
      (left, right) =>
        actualTotalCount(left) - actualTotalCount(right) ||
        (staffOrder.get(left.staff.id) ?? Number.MAX_SAFE_INTEGER) -
          (staffOrder.get(right.staff.id) ?? Number.MAX_SAFE_INTEGER)
    );
  return {
    month,
    flightNumbers,
    rows,
    ranges: Object.fromEntries(
      LATE_PRIORITY_STATISTICS_CATEGORIES.map((category) => [
        category,
        statisticsRange(rows, category),
      ])
    ) as MonthlyLatePriorityStatistics["ranges"],
  };
}
