import type { Assignment, Flight, PositionRule, Staff } from "../../model";
import type { MobileSupervisorFillRule } from "../rules/structured-policy-contract";
import type { AssignmentEligibilityFacts } from "../shared/scheduling-facts";
import { evaluateAutomaticHardConstraints } from "../rules/built-in-rule-registry";
import { assignmentRule } from "../flights/schedule-position-rules";

export type SupervisorFillMode = "automatic" | "manual";

export interface SupervisorFillEvaluation {
  allowed: boolean;
  reason: string | null;
  rule: MobileSupervisorFillRule | null;
  hasSafeRegularCandidate: boolean;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function matches(value: string, keyword: string): boolean {
  const normalizedKeyword = normalize(keyword);
  return (
    Boolean(normalizedKeyword) && normalize(value).includes(normalizedKeyword)
  );
}

function matchingRule(
  state: AssignmentEligibilityFacts,
  sourceFlight: Flight,
  sourceRule: PositionRule,
  targetFlight: Flight,
  targetRule: PositionRule,
  mode: SupervisorFillMode
): MobileSupervisorFillRule | undefined {
  return state.settings.mobileSupervisorFillRules.find(
    (rule) =>
      rule.enabled &&
      (mode === "automatic" ? rule.allowAutomatic : rule.allowManual) &&
      normalize(rule.sourceFlightNo) === normalize(sourceFlight.flightNo) &&
      matches(sourceRule.name, rule.sourcePositionKeyword) &&
      normalize(rule.targetFlightNo) === normalize(targetFlight.flightNo) &&
      matches(targetRule.name, rule.targetPositionKeyword)
  );
}

function assignmentFlight(
  state: AssignmentEligibilityFacts,
  assignment: Assignment
): Flight | undefined {
  return state.flights.find((flight) => flight.id === assignment.flightId);
}

function safeRegularCandidate(
  state: AssignmentEligibilityFacts,
  assignments: readonly Assignment[],
  target: Assignment,
  targetFlight: Flight,
  targetRule: PositionRule,
  sourceStaffId: string
): Staff | undefined {
  const otherAssignments = assignments.filter(
    (assignment) => assignment.id !== target.id
  );
  return state.staff.find(
    (person) =>
      person.id !== sourceStaffId &&
      evaluateAutomaticHardConstraints({
        state,
        assignments: [...otherAssignments],
        flight: targetFlight,
        rule: targetRule,
        person,
        workHours: target.workHours,
        transitionMode: "forbid",
      }).eligible
  );
}

export function evaluateSupervisorFillFacts(
  state: AssignmentEligibilityFacts,
  assignments: readonly Assignment[],
  source: Assignment,
  target: Assignment,
  mode: SupervisorFillMode
): SupervisorFillEvaluation {
  const sourceRule = assignmentRule(state, source);
  const targetRule = assignmentRule(state, target);
  const sourceFlight = assignmentFlight(state, source);
  const targetFlight = assignmentFlight(state, target);
  if (!sourceRule || !targetRule || !sourceFlight || !targetFlight)
    return {
      allowed: false,
      reason: "来源督导或目标岗位不存在",
      rule: null,
      hasSafeRegularCandidate: false,
    };
  if (sourceRule.category !== "机动督导")
    return {
      allowed: false,
      reason: "来源岗位不是机动督导",
      rule: null,
      hasSafeRegularCandidate: false,
    };
  if (targetRule.coverageRole !== "supervisor-fill")
    return {
      allowed: false,
      reason: "目标岗位未标记为督导补位",
      rule: null,
      hasSafeRegularCandidate: false,
    };
  const rule = matchingRule(
    state,
    sourceFlight,
    sourceRule,
    targetFlight,
    targetRule,
    mode
  );
  if (!rule)
    return {
      allowed: false,
      reason: "没有启用且允许当前操作的督导补位关系",
      rule: null,
      hasSafeRegularCandidate: false,
    };
  if (source.status !== "assigned" || !source.staffId || !source.staffName)
    return {
      allowed: false,
      reason: "来源机动督导尚未安排人员",
      rule,
      hasSafeRegularCandidate: false,
    };
  const person = state.staff.find(
    (candidate) => candidate.id === source.staffId
  );
  if (!person)
    return {
      allowed: false,
      reason: "来源机动督导人员不存在",
      rule,
      hasSafeRegularCandidate: false,
    };
  const regularCandidate = safeRegularCandidate(
    state,
    assignments,
    target,
    targetFlight,
    targetRule,
    person.id
  );
  if (regularCandidate)
    return {
      allowed: false,
      reason: `${regularCandidate.name}仍可安全承担${target.flightNo}/${target.position}`,
      rule,
      hasSafeRegularCandidate: true,
    };
  const fillRule: PositionRule = {
    ...targetRule,
    qualifiedStaffIds: [person.id],
  };
  const otherAssignments = assignments.filter((assignment) => {
    if (assignment.id === target.id) return false;
    return source.flightId === target.flightId
      ? assignment.id !== source.id
      : true;
  });
  const eligibility = evaluateAutomaticHardConstraints({
    state,
    assignments: [...otherAssignments],
    flight: targetFlight,
    rule: fillRule,
    person,
    workHours: 0,
    transitionMode: "forbid",
  });
  if (!eligibility.eligible)
    return {
      allowed: false,
      reason: eligibility.violations[0]?.message ?? "督导补位未通过安全检查",
      rule,
      hasSafeRegularCandidate: false,
    };
  return {
    allowed: true,
    reason: null,
    rule,
    hasSafeRegularCandidate: false,
  };
}

export function hasRecordedSupervisorFillLink(
  evaluation: SupervisorFillEvaluation,
  target: Pick<Assignment, "supervisorFillRuleId">
): boolean {
  return Boolean(
    evaluation.allowed &&
    evaluation.rule &&
    target.supervisorFillRuleId === evaluation.rule.id
  );
}
