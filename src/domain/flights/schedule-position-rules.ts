import type { AppState, Assignment, Flight, PositionRule } from "../../model";
import { createId } from "../../utils";
import { durationHours } from "../shared/time";

export function isAuxiliaryCategory(
  category: PositionRule["category"] | undefined
): boolean {
  return category === "行政支援";
}

export function isFixedBottomPosition(position: string): boolean {
  return position.includes("引导") && !position.includes("督导");
}

export function isSupervisorPosition(position: string): boolean {
  return position.includes("督导");
}

export function assignmentRule(
  state: AppState,
  assignment: Assignment
): PositionRule | undefined {
  return assignment.positionRuleId
    ? state.positionRules.find((rule) => rule.id === assignment.positionRuleId)
    : undefined;
}

export function isGuideAssignment(
  state: AppState,
  assignment: Assignment
): boolean {
  return assignmentRule(state, assignment)?.category === "引导";
}

export function isReusableAssignment(
  state: AppState,
  assignment: Assignment
): boolean {
  return isGuideAssignment(state, assignment);
}

export function makeUnfilled(
  flight: Flight,
  position: string,
  rule: PositionRule | undefined
): Assignment {
  return {
    id: createId("assignment"),
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule?.id ?? null,
    position,
    staffId: null,
    staffName: "",
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: durationHours(flight.startTime, flight.endTime),
    fatiguePoints:
      rule?.fatiguePoints ?? durationHours(flight.startTime, flight.endTime),
    remark: rule?.remark ?? "未找到岗位规则",
    manualRemark: "",
    status:
      rule?.manual || isAuxiliaryCategory(rule?.category)
        ? "manual"
        : "unfilled",
  };
}

export function activeFlightRules(
  state: AppState,
  flight: Flight
): PositionRule[] {
  const flightRules = state.positionRules.filter(
    (rule) => rule.flightNo === flight.flightNo
  );
  const administrativePositions = new Set(
    flightRules
      .filter((rule) => rule.category === "行政支援")
      .map((rule) => rule.name.trim())
  );
  const configured = state.settings.adminSupportEnabled
    ? flightRules.filter(
        (rule) =>
          rule.category === "行政支援" ||
          !administrativePositions.has(rule.name.trim())
      )
    : flightRules.filter((rule) => rule.category !== "行政支援");
  const primary = configured.filter(
    (rule) => rule.category !== "引导" && !isFixedBottomPosition(rule.name)
  );
  const fixedBottom = configured.filter(
    (rule) => rule.category === "引导" || isFixedBottomPosition(rule.name)
  );
  const orderedPrimary = primary
    .map((rule, index) => ({ rule, index }))
    .sort(
      (left, right) =>
        Number(
          right.rule.category === "机动督导" ||
            isSupervisorPosition(right.rule.name)
        ) -
          Number(
            left.rule.category === "机动督导" ||
              isSupervisorPosition(left.rule.name)
          ) || left.index - right.index
    )
    .map(({ rule }) => rule);
  return [...orderedPrimary, ...fixedBottom];
}

export function activeFlightPositions(
  state: AppState,
  flight: Flight
): string[] {
  return activeFlightRules(state, flight).map((rule) => rule.name);
}
