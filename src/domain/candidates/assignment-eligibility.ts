import type {
  AppState,
  Assignment,
  Flight,
  PositionRule,
  Staff,
} from "../../model";
import {
  minimumFlightTransitionMessage,
  minimumFlightTransitionViolationsForInsertion,
} from "../assignments/minimum-flight-transition";
import { assignmentRule } from "../flights/schedule-position-rules";
import {
  positionTransitionCost,
  positionTransitionInsertionCost,
} from "../reviews/schedule-protection";
import {
  assignmentConflictFacts,
  assignmentHoursFacts,
  staffAssignmentFacts,
} from "./assignment-eligibility-facts";

export type AssignmentEligibilityViolationCode =
  | "missing-target"
  | "staff-unavailable"
  | "staff-type"
  | "admin-support-disabled"
  | "position-qualification"
  | "night-shift"
  | "guide-source"
  | "time-conflict"
  | "daily-hours"
  | "minimum-flight-transition"
  | "position-transition"
  | "regular-staff-priority";

export interface AssignmentEligibilityViolation {
  code: AssignmentEligibilityViolationCode;
  message: string;
}

export interface AssignmentEligibilityDiagnostic {
  eligible: boolean;
  violations: AssignmentEligibilityViolation[];
}

export interface AutomaticAssignmentEligibilityOptions {
  state: AppState;
  assignments: Assignment[];
  flight: Flight;
  rule: PositionRule;
  person: Staff;
  workHours?: number;
  transitionMode?: "prefer" | "forbid";
  ignoreSameFlightReusable?: boolean;
}

export interface AutomaticEligibilityPoolOptions {
  state: AppState;
  assignments: Assignment[];
  flight: Flight;
  rule: PositionRule;
  excludedStaffIds?: ReadonlySet<string>;
}

export interface AutomaticEligibilityPool {
  configured: Staff[];
  available: Staff[];
  nightCapable: Staff[];
  conflictFree: Staff[];
  withinHours: Staff[];
}

function violation(
  code: AssignmentEligibilityViolationCode,
  message: string
): AssignmentEligibilityDiagnostic {
  return { eligible: false, violations: [{ code, message }] };
}

function success(): AssignmentEligibilityDiagnostic {
  return { eligible: true, violations: [] };
}

export function diagnoseBaseAssignmentEligibility(
  state: AppState,
  flight: Pick<Flight, "startTime" | "endTime">,
  rule: PositionRule,
  person: Staff
): AssignmentEligibilityDiagnostic {
  const facts = staffAssignmentFacts(state, flight, rule, person);
  if (!facts.available)
    return violation(
      "staff-unavailable",
      `${person.name} 当前状态为${person.status}`
    );
  if (!facts.regularStaff)
    return violation("staff-type", `${person.name} 不是常规人员`);
  if (!facts.positionQualified)
    return violation(
      "position-qualification",
      `${person.name} 不具备该岗位资质`
    );
  if (!facts.nightCapable)
    return violation("night-shift", `${person.name} 不具备夜班能力`);
  return success();
}

type PositionTransitionCheck = "target-only" | "insertion";

function automaticPositionTransitionCost(
  options: AutomaticAssignmentEligibilityOptions,
  transitionCheck: PositionTransitionCheck
): number {
  const { state, assignments, flight, rule, person, transitionMode } = options;
  if (!transitionMode) return 0;
  if (transitionCheck === "target-only") {
    return positionTransitionCost(
      assignments,
      person.id,
      flight.flightNo,
      rule.name,
      flight.startTime,
      state,
      transitionMode
    );
  }
  return positionTransitionInsertionCost(
    assignments,
    person.id,
    { key: `${flight.id}:${rule.id}`, flight, rule },
    state,
    transitionMode
  );
}

function diagnoseAutomaticStaffEligibilityWithTransitionCheck(
  options: AutomaticAssignmentEligibilityOptions,
  transitionCheck: PositionTransitionCheck
): AssignmentEligibilityDiagnostic {
  const { state, assignments, flight, rule, person, transitionMode } = options;
  const base = diagnoseBaseAssignmentEligibility(state, flight, rule, person);
  if (!base.eligible) return base;
  const factOptions = {
    state,
    assignments,
    flight,
    person,
    workHours: options.workHours,
    sameFlightConflict: options.ignoreSameFlightReusable
      ? ("allow-reusable" as const)
      : ("block" as const),
  };
  if (assignmentConflictFacts(factOptions).blockingConflicts.length) {
    return violation("time-conflict", `${person.name} 在该时段已有排班`);
  }
  if (!assignmentHoursFacts(factOptions).withinDailyHours) {
    return violation(
      "daily-hours",
      `${person.name} 将超过每日 ${state.settings.maxDailyHours} 小时上限`
    );
  }
  if (
    transitionMode &&
    automaticPositionTransitionCost(options, transitionCheck) > 0
  ) {
    return violation(
      "position-transition",
      `${person.name} 不满足该岗位的最小衔接间隔`
    );
  }
  return success();
}

export function diagnoseAutomaticStaffEligibility(
  options: AutomaticAssignmentEligibilityOptions
): AssignmentEligibilityDiagnostic {
  return diagnoseAutomaticStaffEligibilityWithTransitionCheck(
    options,
    "insertion"
  );
}

export function diagnoseMinimumFlightTransitionEligibility(
  options: AutomaticAssignmentEligibilityOptions
): AssignmentEligibilityDiagnostic {
  const violation = minimumFlightTransitionViolationsForInsertion(
    options.state,
    options.assignments,
    options.person.id,
    options.flight,
    options.rule
  )[0];
  return violation
    ? {
        eligible: false,
        violations: [
          {
            code: "minimum-flight-transition",
            message: minimumFlightTransitionMessage(
              options.person.name,
              violation
            ),
          },
        ],
      }
    : success();
}

function diagnoseAutomaticAssignmentEligibilityWithTransitionCheck(
  options: AutomaticAssignmentEligibilityOptions,
  transitionCheck: PositionTransitionCheck
): AssignmentEligibilityDiagnostic {
  const staffEligibility = diagnoseAutomaticStaffEligibilityWithTransitionCheck(
    options,
    transitionCheck
  );
  if (!staffEligibility.eligible) return staffEligibility;
  return diagnoseMinimumFlightTransitionEligibility(options);
}

export function diagnoseAutomaticAssignmentEligibility(
  options: AutomaticAssignmentEligibilityOptions
): AssignmentEligibilityDiagnostic {
  return diagnoseAutomaticAssignmentEligibilityWithTransitionCheck(
    options,
    "insertion"
  );
}

export function analyzeAutomaticEligibilityPool({
  state,
  assignments,
  flight,
  rule,
  excludedStaffIds = new Set(),
}: AutomaticEligibilityPoolOptions): AutomaticEligibilityPool {
  const staffFacts = new Map(
    state.staff.map((person) => [
      person.id,
      staffAssignmentFacts(state, flight, rule, person),
    ])
  );
  const configured = state.staff.filter(
    (person) =>
      !excludedStaffIds.has(person.id) &&
      staffFacts.get(person.id)?.regularStaff &&
      staffFacts.get(person.id)?.positionQualified
  );
  const available = configured.filter(
    (person) => staffFacts.get(person.id)?.available
  );
  const nightCapable = available.filter(
    (person) => staffFacts.get(person.id)?.nightCapable
  );
  const conflictFacts = new Map(
    nightCapable.map((person) => [
      person.id,
      assignmentConflictFacts({
        state,
        assignments,
        flight,
        person,
      }),
    ])
  );
  const conflictFree = nightCapable.filter(
    (person) => !conflictFacts.get(person.id)?.blockingConflicts.length
  );
  const hoursFacts = new Map(
    conflictFree.map((person) => [
      person.id,
      assignmentHoursFacts({ state, assignments, flight, person }),
    ])
  );
  const withinHours = conflictFree.filter(
    (person) => hoursFacts.get(person.id)?.withinDailyHours
  );
  return { configured, available, nightCapable, conflictFree, withinHours };
}

export function eligibleStaffForRule(
  state: AppState,
  flight: Flight,
  rule: PositionRule
): Staff[] {
  return state.staff.filter(
    (person) =>
      diagnoseBaseAssignmentEligibility(state, flight, rule, person).eligible
  );
}

export function diagnoseManualAssignmentEligibility(
  state: AppState,
  assignmentId: string,
  staffId: string,
  ignoreAssignmentId?: string
): AssignmentEligibilityDiagnostic {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const person = state.staff.find((item) => item.id === staffId);
  if (!assignment || !person)
    return violation("missing-target", "人员或岗位不存在");
  const rule = assignmentRule(state, assignment);
  const flight = state.flights.find(
    (item) => item.id === assignment.flightId
  ) ?? {
    id: assignment.flightId,
    flightNo: assignment.flightNo,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
    bookedPassengers: 0,
    positions: [assignment.position],
    remark: "",
  };
  const factRule = rule ?? {
    id: assignment.positionRuleId ?? assignment.id,
    flightNo: assignment.flightNo,
    name: assignment.position,
    category: "常规" as const,
    remark: assignment.remark,
    qualifiedStaffIds: [staffId],
    manual: true,
    fatiguePoints: assignment.fatiguePoints,
    minPassengers: 0,
    earlyReleaseMinutes: 0,
  };
  const staffFacts = staffAssignmentFacts(state, flight, factRule, person);
  if (!staffFacts.available)
    return violation(
      "staff-unavailable",
      `${person.name} 当前状态为${person.status}`
    );
  const administrativeStaff = person.staffType === "行政支援";
  if (administrativeStaff && !state.settings.adminSupportEnabled) {
    return violation("admin-support-disabled", "行政支援模式尚未启用");
  }
  if (administrativeStaff && (!rule || !staffFacts.positionQualified)) {
    return violation(
      "position-qualification",
      `${person.name} 不具备该岗位资质`
    );
  }
  if (
    rule &&
    rule.category !== "引导" &&
    !rule.manual &&
    !staffFacts.positionQualified
  ) {
    return violation(
      "position-qualification",
      `${person.name} 不具备该岗位资质`
    );
  }
  if (administrativeStaff && rule) {
    const otherAssignments = state.assignments.filter(
      (item) => item.id !== assignmentId
    );
    const regularAvailable = Boolean(
      state.staff.some(
        (regular) =>
          diagnoseAutomaticAssignmentEligibilityWithTransitionCheck(
            {
              state,
              assignments: otherAssignments,
              flight,
              rule,
              person: regular,
              workHours: assignment.workHours,
              transitionMode: "forbid",
              ignoreSameFlightReusable: true,
            },
            "target-only"
          ).eligible
      )
    );
    if (regularAvailable) {
      return violation(
        "regular-staff-priority",
        "仍有满足硬约束的常规人员可用，应优先安排常规人员"
      );
    }
  }
  if (!staffFacts.nightCapable) {
    return violation("night-shift", `${person.name} 不可上夜班`);
  }
  const reuse = rule?.category === "引导";
  const others = state.assignments.filter(
    (item) =>
      item.id !== assignmentId &&
      (reuse || item.id !== ignoreAssignmentId) &&
      item.staffId === staffId
  );
  if (reuse) {
    if (person.staffType !== "常规")
      return violation("staff-type", "引导岗位只能复用常规人员");
    const source = others.find(
      (item) =>
        item.flightId === assignment.flightId &&
        item.status === "assigned" &&
        assignmentRule(state, item)?.category === "常规"
    );
    if (!source)
      return violation("guide-source", `${person.name} 未在该航班承担常规岗位`);
  }
  const factOptions = {
    state,
    assignments: others,
    flight,
    person,
    workHours: assignment.workHours,
    sameFlightConflict: reuse
      ? ("allow-all" as const)
      : ("allow-reusable" as const),
  };
  if (assignmentConflictFacts(factOptions).blockingConflicts.length) {
    return violation("time-conflict", `${person.name} 在该时段已有排班`);
  }
  if (!assignmentHoursFacts(factOptions).withinDailyHours) {
    return violation(
      "daily-hours",
      `${person.name} 将超过每日 ${state.settings.maxDailyHours} 小时上限`
    );
  }
  const minimumTransition = minimumFlightTransitionViolationsForInsertion(
    state,
    others,
    staffId,
    flight,
    factRule
  )[0];
  if (minimumTransition) {
    return violation(
      "minimum-flight-transition",
      minimumFlightTransitionMessage(person.name, minimumTransition)
    );
  }
  if (
    positionTransitionCost(
      others,
      staffId,
      assignment.flightNo,
      assignment.position,
      assignment.startTime,
      state,
      "forbid"
    ) > 0
  ) {
    return violation(
      "position-transition",
      `${person.name} 不满足该岗位的最小衔接间隔`
    );
  }
  return success();
}

export function canAssignStaff(
  state: AppState,
  assignmentId: string,
  staffId: string,
  ignoreAssignmentId?: string
): string | null {
  return (
    diagnoseManualAssignmentEligibility(
      state,
      assignmentId,
      staffId,
      ignoreAssignmentId
    ).violations[0]?.message ?? null
  );
}
