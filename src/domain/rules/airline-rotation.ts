import type { Assignment, PositionRule } from "../../model";
import { normalizedPolicyValue } from "../reviews/schedule-protection";

/** Returns the carrier code from a normalized flight number such as CX931. */
export function airlineCode(flightNo: string): string {
  const normalized = normalizedPolicyValue(flightNo).replaceAll(/\s+/g, "");
  const match = /^([A-Z0-9]{2,3}?)(?=\d{2,})/.exec(normalized);
  return match?.[1] ?? normalized;
}

const ROTATION_POSITION_KINDS = [
  "一号",
  "申报",
  "督导",
  "控制",
  "送资料",
] as const;

function semanticRotationPosition(value: string): string | undefined {
  return ROTATION_POSITION_KINDS.find((kind) => value.includes(kind));
}

export function normalizedRotationPosition(
  position: string,
  remark: string
): string {
  const semanticRemark = semanticRotationPosition(remark);
  if (semanticRemark) return semanticRemark;
  const semanticPosition = semanticRotationPosition(position);
  if (semanticPosition) return semanticPosition;
  return normalizedPolicyValue(position).replace(/^HO(?=\d)/, "H0");
}

export function positionRotationGroupKey(
  flightNo: string,
  position: string,
  remark: string
): string {
  return `${airlineCode(flightNo)}\u0000${normalizedRotationPosition(position, remark)}`;
}

export function isSameAirlinePriorityPosition(
  rule: Pick<PositionRule, "category" | "name" | "remark">
): boolean {
  if (rule.category !== "常规") return false;
  const position = normalizedRotationPosition(rule.name, rule.remark);
  return (
    position === "控制" ||
    position === "一号" ||
    /^(?:G18|G20)$/i.test(position)
  );
}

export function sameAirlinePriorityConflict(
  left: Pick<PositionRule, "flightNo" | "category" | "name" | "remark">,
  right: Pick<PositionRule, "flightNo" | "category" | "name" | "remark">
): boolean {
  return (
    airlineCode(left.flightNo) === airlineCode(right.flightNo) &&
    isSameAirlinePriorityPosition(left) &&
    isSameAirlinePriorityPosition(right)
  );
}

export function sameAirlinePriorityAssignmentConflict(
  left: Pick<Assignment, "flightNo" | "position" | "remark"> & {
    positionRule?: Pick<PositionRule, "category" | "name" | "remark">;
  },
  right: Pick<Assignment, "flightNo" | "position" | "remark"> & {
    positionRule?: Pick<PositionRule, "category" | "name" | "remark">;
  }
): boolean {
  const leftRule = left.positionRule ?? {
    category: "常规" as const,
    name: left.position,
    remark: left.remark,
  };
  const rightRule = right.positionRule ?? {
    category: "常规" as const,
    name: right.position,
    remark: right.remark,
  };
  return sameAirlinePriorityConflict(
    { flightNo: left.flightNo, ...leftRule },
    { flightNo: right.flightNo, ...rightRule }
  );
}
