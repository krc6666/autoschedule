import { markActiveScheduleStale } from "../domain/kernel/schedule-lifecycle";
import {
  latePriorityKindLabel,
  type LatePriorityFrequencyKind,
} from "../domain/reviews/late-priority-policy";
import { buildMonthlyLatePriorityStatistics } from "../domain/statistics/monthly-late-priority-statistics";
import { mergeLatePriorityFrequencyAdjustments } from "../domain/statistics/late-priority-frequency-adjustment";
import type { AppState } from "../model";

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
