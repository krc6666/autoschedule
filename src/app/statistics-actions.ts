import { markActiveScheduleStale } from "../domain/kernel/schedule-lifecycle";
import {
  latePriorityKindLabel,
  type LatePriorityFrequencyKind,
} from "../domain/reviews/late-priority-policy";
import { buildMonthlyLatePriorityStatistics } from "../domain/statistics/monthly-late-priority-statistics";
import { mergeLatePriorityFrequencyAdjustments } from "../domain/statistics/late-priority-frequency-adjustment";
import type { AppState } from "../model";

function normalizedFlightNo(flightNo: string): string {
  return flightNo.trim().toUpperCase().replaceAll(/\s+/g, "");
}

export function updateLatePriorityFrequencyAdjustment(
  state: AppState,
  month: string,
  staffId: string,
  flightNo: string,
  kind: LatePriorityFrequencyKind,
  delta: number
): boolean {
  const normalizedDelta = Math.trunc(delta);
  if (!normalizedDelta || !/^\d{4}-\d{2}$/.test(month) || !staffId || !flightNo)
    return false;
  if (normalizedDelta < 0) {
    const row = buildMonthlyLatePriorityStatistics(
      state,
      `${month}-01`
    ).rows.find((item) => item.staff.id === staffId);
    if (!row || row.categories[latePriorityKindLabel(kind)].effectiveCount <= 0)
      return false;
  }
  const normalizedFlightNo = flightNo
    .trim()
    .toUpperCase()
    .replaceAll(/\s+/g, "");
  const existing = state.latePriorityFrequencyAdjustments.find(
    (item) =>
      item.month === month &&
      item.staffId === staffId &&
      item.flightNo === normalizedFlightNo &&
      item.kind === kind
  );
  if (existing) existing.delta += normalizedDelta;
  else
    state.latePriorityFrequencyAdjustments.push({
      month,
      staffId,
      flightNo: normalizedFlightNo,
      kind,
      delta: normalizedDelta,
    });
  state.latePriorityFrequencyAdjustments =
    mergeLatePriorityFrequencyAdjustments(
      state.latePriorityFrequencyAdjustments
    );
  markActiveScheduleStale(state);
  return true;
}

export function resetMonthlyLatePriorityFrequencyCounts(
  state: AppState,
  date: string
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const month = date.slice(0, 7);
  const statistics = buildMonthlyLatePriorityStatistics(state, date);
  const scopeFlights = new Set(statistics.flightNumbers);
  const kindByCategory = {
    督导: "supervisor",
    一号: "number-one",
    申报: "declaration",
    送资料: "delivery",
  } as const;
  const counts = new Map<string, number>();
  for (const row of statistics.rows) {
    for (const [category, categoryStatistics] of Object.entries(
      row.categories
    ) as Array<
      [
        keyof typeof kindByCategory,
        (typeof row.categories)[keyof typeof row.categories],
      ]
    >) {
      for (const detail of categoryStatistics.details) {
        const key = [
          row.staff.id,
          normalizedFlightNo(detail.flightNo),
          kindByCategory[category],
        ].join("\u0000");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const preserved = state.latePriorityFrequencyAdjustments.filter(
    (item) =>
      item.month !== month ||
      !scopeFlights.has(normalizedFlightNo(item.flightNo))
  );
  const resetAdjustments = [...counts].map(([key, count]) => {
    const [staffId, flightNo, kind] = key.split("\u0000") as [
      string,
      string,
      LatePriorityFrequencyKind,
    ];
    return {
      month,
      staffId,
      flightNo,
      kind,
      delta: -count,
      resetBaseline: count,
    };
  });
  const before = JSON.stringify(state.latePriorityFrequencyAdjustments);
  state.latePriorityFrequencyAdjustments =
    mergeLatePriorityFrequencyAdjustments([...preserved, ...resetAdjustments]);
  if (JSON.stringify(state.latePriorityFrequencyAdjustments) === before)
    return false;
  markActiveScheduleStale(state);
  return true;
}
