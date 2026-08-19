import type { LatePriorityFrequencyAdjustment } from "../../model";
import { normalizeLatePriorityFlightNumber } from "../reviews/late-priority-policy";

export function mergeLatePriorityFrequencyAdjustments(
  adjustments: readonly LatePriorityFrequencyAdjustment[]
): LatePriorityFrequencyAdjustment[] {
  const merged = new Map<string, LatePriorityFrequencyAdjustment>();
  for (const adjustment of adjustments) {
    const normalized = {
      ...adjustment,
      flightNo: normalizeLatePriorityFlightNumber(adjustment.flightNo),
      delta: Math.trunc(adjustment.delta),
    };
    const key = [
      normalized.month,
      normalized.staffId,
      normalized.flightNo,
      normalized.kind,
    ].join("\u0000");
    const current = merged.get(key);
    merged.set(key, {
      ...normalized,
      delta: (current?.delta ?? 0) + normalized.delta,
    });
  }
  return [...merged.values()].filter((item) => item.delta !== 0);
}
