import type { Assignment, Flight, PositionRule, Staff } from "../../model";
import { createId } from "../../utils";
import { durationHours } from "../shared/time";
import type {
  FlightRuleFacts,
  ScheduleGenerationFacts,
} from "../shared/scheduling-facts";

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
  state: Pick<FlightRuleFacts, "positionRules">,
  assignment: Assignment
): PositionRule | undefined {
  return assignment.positionRuleId
    ? state.positionRules.find((rule) => rule.id === assignment.positionRuleId)
    : undefined;
}

export function isGuideAssignment(
  state: Pick<FlightRuleFacts, "positionRules">,
  assignment: Assignment
): boolean {
  return assignmentRule(state, assignment)?.category === "引导";
}

export function guideSourceStaff(
  state: Pick<ScheduleGenerationFacts, "positionRules" | "staff">,
  assignment: Assignment
): Staff | undefined {
  if (assignment.status !== "assigned" || !assignment.staffId) return undefined;
  const category = assignmentRule(state, assignment)?.category;
  if (category === "引导") return undefined;
  const person = state.staff.find((item) => item.id === assignment.staffId);
  return person?.status === "正常" && person.staffType === "常规"
    ? person
    : undefined;
}

export function compareGuideSourceAssignments(
  state: Pick<FlightRuleFacts, "positionRules">,
  displayIndex: ReadonlyMap<string, number>,
  left: Assignment,
  right: Assignment
): number {
  const leftAdministrative =
    assignmentRule(state, left)?.category === "行政支援";
  const rightAdministrative =
    assignmentRule(state, right)?.category === "行政支援";
  return (
    Number(rightAdministrative) - Number(leftAdministrative) ||
    (displayIndex.get(right.positionRuleId ?? "") ?? -1) -
      (displayIndex.get(left.positionRuleId ?? "") ?? -1)
  );
}

export function isReusableAssignment(
  state: Pick<FlightRuleFacts, "positionRules">,
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
  state: Pick<FlightRuleFacts, "positionRules" | "settings">,
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
    ? flightRules
        .filter(
          (rule) =>
            rule.category === "行政支援" ||
            !administrativePositions.has(rule.name.trim())
        )
        .map((rule) => administrativeSupportAutomaticRule(state, rule))
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

export function administrativeSupportAutomaticRule(
  state: Pick<FlightRuleFacts, "positionRules">,
  rule: PositionRule
): PositionRule {
  if (rule.category !== "行政支援") return rule;
  const regularCounterpartStaffIds = state.positionRules
    .filter(
      (candidate) =>
        candidate.flightNo === rule.flightNo &&
        candidate.name.trim() === rule.name.trim() &&
        candidate.category === "常规"
    )
    .flatMap((candidate) => candidate.qualifiedStaffIds);
  const qualifiedStaffIds = [
    ...new Set([...rule.qualifiedStaffIds, ...regularCounterpartStaffIds]),
  ];
  return qualifiedStaffIds.length === rule.qualifiedStaffIds.length &&
    qualifiedStaffIds.every(
      (staffId, index) => staffId === rule.qualifiedStaffIds[index]
    )
    ? rule
    : { ...rule, qualifiedStaffIds };
}

export function activeFlightPositions(
  state: Pick<FlightRuleFacts, "positionRules" | "settings">,
  flight: Flight
): string[] {
  return activeFlightRules(state, flight).map((rule) => rule.name);
}
