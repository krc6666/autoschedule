import type { PositionRule } from "../../model";

export const PRIORITY_ROTATION_POSITION_KEYWORDS = [
  "一号",
  "申报",
  "督导",
  "控制",
  "送资料",
] as const;

export function isPriorityRotationPosition(
  rule: Pick<PositionRule, "category" | "name" | "remark">
): boolean {
  if (rule.category !== "常规") return false;
  const searchable = `${rule.name} ${rule.remark}`;
  return PRIORITY_ROTATION_POSITION_KEYWORDS.some((keyword) =>
    searchable.includes(keyword)
  );
}

export function isHighFatigueOrdinaryRotationPosition(
  rule: Pick<PositionRule, "category" | "name" | "remark" | "fatiguePoints">,
  fatigueThreshold: number
): boolean {
  return (
    rule.category === "常规" &&
    !isPriorityRotationPosition(rule) &&
    Number.isFinite(fatigueThreshold) &&
    rule.fatiguePoints >= fatigueThreshold
  );
}
