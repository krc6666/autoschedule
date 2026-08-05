import type { PositionRule } from "../../model";
import { timeToMinutes } from "../shared/time";
import { isPriorityRotationPosition } from "./position-rotation-policy";

const NEXT_DAY_EARLY_HOUR_CUTOFF_MINUTES = 6 * 60;

export const LATE_PRIORITY_FREQUENCY_ORDER = [
  "supervisor",
  "number-one",
  "declaration",
  "delivery",
] as const;

export type LatePriorityFrequencyKind =
  (typeof LATE_PRIORITY_FREQUENCY_ORDER)[number];

export function endsAfterLateShiftThreshold(
  target: Pick<{ startTime: string; endTime: string }, "startTime" | "endTime">,
  thresholdTime: string
): boolean {
  const start = timeToMinutes(target.startTime);
  let end = timeToMinutes(target.endTime);
  const threshold = timeToMinutes(thresholdTime);
  if (![start, end, threshold].every(Number.isFinite)) return false;
  if (end <= start || start < NEXT_DAY_EARLY_HOUR_CUTOFF_MINUTES)
    end += 24 * 60;
  return end > threshold;
}

export function isLatePriorityPosition(
  rule: Pick<PositionRule, "category" | "name" | "remark">,
  target: { startTime: string; endTime: string },
  thresholdTime: string
): boolean {
  return (
    isPriorityRotationPosition(rule) &&
    endsAfterLateShiftThreshold(target, thresholdTime)
  );
}

export function isDeclarationOrDeliveryPosition(
  target: Pick<PositionRule, "name" | "remark">
): boolean {
  const searchable = `${target.name} ${target.remark}`;
  return searchable.includes("申报") || searchable.includes("送资料");
}

export function latePriorityFrequencyKinds(
  target: Pick<PositionRule, "name" | "remark">
): readonly LatePriorityFrequencyKind[] {
  const searchable = `${target.name} ${target.remark}`;
  const kinds: LatePriorityFrequencyKind[] = [];
  if (searchable.includes("督导")) kinds.push("supervisor");
  if (searchable.includes("一号")) kinds.push("number-one");
  if (searchable.includes("申报")) kinds.push("declaration");
  if (searchable.includes("送资料")) kinds.push("delivery");
  return kinds;
}

export function isSupervisorPosition(
  target: Pick<PositionRule, "name" | "remark">
): boolean {
  return `${target.name} ${target.remark}`.includes("督导");
}
