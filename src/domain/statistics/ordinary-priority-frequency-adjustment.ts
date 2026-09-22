import type { OrdinaryPriorityFrequencyAdjustment } from "../../model";
import { normalizedPolicyValue } from "../reviews/schedule-protection";

export function mergeOrdinaryPriorityFrequencyAdjustments(
  adjustments: readonly OrdinaryPriorityFrequencyAdjustment[]
): OrdinaryPriorityFrequencyAdjustment[] {
  const merged = new Map<string, OrdinaryPriorityFrequencyAdjustment>();
  for (const adjustment of adjustments) {
    const normalized = {
      month: adjustment.month,
      staffId: adjustment.staffId,
      airlineCode: String(adjustment.airlineCode).trim().toUpperCase(),
      position: normalizedPolicyValue(adjustment.position),
      delta: Math.trunc(adjustment.delta),
      ...(Math.trunc(adjustment.resetBaseline ?? 0) > 0
        ? { resetBaseline: Math.trunc(adjustment.resetBaseline!) }
        : {}),
    };
    const key = [
      normalized.month,
      normalized.staffId,
      normalized.airlineCode,
      normalized.position,
    ].join("\u0000");
    const current = merged.get(key);
    const baseline =
      (current?.resetBaseline ?? 0) + (normalized.resetBaseline ?? 0);
    merged.set(key, {
      ...normalized,
      delta: (current?.delta ?? 0) + normalized.delta,
      ...(baseline ? { resetBaseline: baseline } : {}),
    });
  }
  return [...merged.values()].filter(
    (item) => item.delta !== 0 || (item.resetBaseline ?? 0) > 0
  );
}
