import type { LatePriorityFrequencyAdjustment } from "../../model";
import { normalizeLatePriorityFlightNumber } from "../reviews/late-priority-policy";

export function mergeLatePriorityFrequencyAdjustments(
  adjustments: readonly LatePriorityFrequencyAdjustment[]
): LatePriorityFrequencyAdjustment[] {
  const merged = new Map<string, LatePriorityFrequencyAdjustment>();
  for (const adjustment of adjustments) {
    const resetBaseline = Math.max(
      0,
      Math.trunc(adjustment.resetBaseline ?? 0)
    );
    const normalized = {
      month: adjustment.month,
      staffId: adjustment.staffId,
      flightNo: normalizeLatePriorityFlightNumber(adjustment.flightNo),
      kind: adjustment.kind,
      delta: Math.trunc(adjustment.delta),
      ...(resetBaseline ? { resetBaseline } : {}),
    };
    const key = [
      normalized.month,
      normalized.staffId,
      normalized.flightNo,
      normalized.kind,
    ].join("\u0000");
    const current = merged.get(key);
    const mergedBaseline =
      (current?.resetBaseline ?? 0) + (normalized.resetBaseline ?? 0);
    merged.set(key, {
      ...normalized,
      delta: (current?.delta ?? 0) + normalized.delta,
      ...(mergedBaseline ? { resetBaseline: mergedBaseline } : {}),
    });
  }
  return [...merged.values()].filter(
    (item) => item.delta !== 0 || (item.resetBaseline ?? 0) > 0
  );
}
