import type { Assignment, PositionRule } from "../../model";
import { normalizedPolicyValue } from "../reviews/schedule-protection";
import { isCombinedDeclarationDeliveryPosition } from "./priority-position-semantics";

export const SAME_DAY_PRIORITY_CONFLICT_REASON =
  "调整会新增同日同航司控制/一号冲突";

export function sameAirlinePriorityConflictMessage(
  left: Pick<Assignment, "flightNo" | "position" | "staffId" | "staffName">,
  right: Pick<Assignment, "flightNo" | "position" | "staffId" | "staffName">
): string {
  return `${left.staffName || left.staffId} 已在${left.flightNo}/${left.position}承担同日同航司控制/一号，跨航班组合优先避免但当前无安全替代或已人工落位，保留当前安排并允许提交，继续承担${right.flightNo}/${right.position}（琥珀色警告）`;
}

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
  if (isCombinedDeclarationDeliveryPosition({ name: position, remark }))
    return "送资料";
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

export function sameAirlinePriorityConflictPairs(
  assignments: readonly Assignment[],
  positionRules: readonly Pick<
    PositionRule,
    "id" | "flightNo" | "category" | "name" | "remark"
  >[]
): Array<[Assignment, Assignment]> {
  const rulesById = new Map(positionRules.map((rule) => [rule.id, rule]));
  const assignedByStaff = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    if (assignment.status !== "assigned" || !assignment.staffId) continue;
    const own = assignedByStaff.get(assignment.staffId) ?? [];
    own.push(assignment);
    assignedByStaff.set(assignment.staffId, own);
  }
  const pairs: Array<[Assignment, Assignment]> = [];
  for (const staffAssignments of assignedByStaff.values()) {
    for (
      let leftIndex = 0;
      leftIndex < staffAssignments.length;
      leftIndex += 1
    ) {
      const left = staffAssignments[leftIndex]!;
      const leftRule = left.positionRuleId
        ? rulesById.get(left.positionRuleId)
        : undefined;
      if (!leftRule) continue;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < staffAssignments.length;
        rightIndex += 1
      ) {
        const right = staffAssignments[rightIndex]!;
        const rightRule = right.positionRuleId
          ? rulesById.get(right.positionRuleId)
          : undefined;
        if (
          !rightRule ||
          left.flightId === right.flightId ||
          !sameAirlinePriorityAssignmentConflict(
            { ...left, positionRule: leftRule },
            { ...right, positionRule: rightRule }
          )
        )
          continue;
        pairs.push([left, right]);
      }
    }
  }
  return pairs;
}

export function sameAirlinePriorityWarningsByAssignment(
  assignments: readonly Assignment[],
  positionRules: readonly Pick<
    PositionRule,
    "id" | "flightNo" | "category" | "name" | "remark"
  >[]
): ReadonlyMap<string, readonly { code: string; message: string }[]> {
  const warnings = new Map<string, { code: string; message: string }[]>();
  for (const [left, right] of sameAirlinePriorityConflictPairs(
    assignments,
    positionRules
  )) {
    const own = warnings.get(right.id) ?? [];
    own.push({
      code: "same-day-cross-flight-priority",
      message: sameAirlinePriorityConflictMessage(left, right),
    });
    warnings.set(right.id, own);
  }
  return warnings;
}
