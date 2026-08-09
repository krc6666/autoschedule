import type { PositionRule } from "../../model";
import {
  latePriorityFrequencyKinds,
  normalizeLatePriorityFlightNumber,
} from "../reviews/late-priority-policy";

export function normalizeLatePriorityFlightNumbers(
  values: readonly string[]
): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const normalized = normalizeLatePriorityFlightNumber(value);
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  });
}

export function latePriorityFlightScopeCandidates(
  positionRules: readonly PositionRule[]
): string[] {
  return normalizeLatePriorityFlightNumbers(
    positionRules.flatMap((rule) =>
      rule.category === "常规" && latePriorityFrequencyKinds(rule).length
        ? [rule.flightNo]
        : []
    )
  );
}

export function latePriorityFlightInScope(
  flightNumbers: readonly string[],
  flightNo: string
): boolean {
  const target = normalizeLatePriorityFlightNumber(flightNo);
  return flightNumbers.some(
    (value) => normalizeLatePriorityFlightNumber(value) === target
  );
}
