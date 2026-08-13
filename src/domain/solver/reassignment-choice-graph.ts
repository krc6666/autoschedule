import type { Assignment, Staff } from "../../model";
import { isDutyMorningFlight } from "../assignments/duty-assignment";
import { applyConfiguredEarlyReleases } from "../assignments/assignment-timing";
import { diagnoseBaseAssignmentEligibility } from "../candidates/assignment-eligibility";
import { assignmentRule } from "../flights/schedule-position-rules";
import {
  reassignmentCandidateSafetyReasons,
  reassignmentDynamicSafetyReasons,
  ROTATION_REVIEW_POLICIES,
} from "../reviews/reassignment-safety-policy";
import type { RotationStaffChange } from "../reviews/rotation-review-safety";
import { intervalsOverlap } from "../shared/time";
import type { ReassignmentOptimizationOptions } from "./reassignment-contract";
import type {
  IncompatibleReassignmentChoices,
  ReassignmentChoice,
  ReassignmentChoiceRequirement,
} from "./reassignment-model";

export interface ReassignmentChoiceFacts {
  choice: ReassignmentChoice;
  assignment: Assignment;
  person: Staff;
}

export interface PreparedReassignmentChoices {
  choices: ReassignmentChoiceFacts[];
  movable: Assignment[];
  fixed: Assignment[];
  candidateRejectionReasons: string[];
}

function projectedAssignment(
  assignment: Assignment,
  person: Staff
): Assignment {
  return {
    ...assignment,
    staffId: person.id,
    staffName: person.name,
  };
}

function dynamicChoiceSafetyReasons(
  options: ReassignmentOptimizationOptions,
  assignment: Assignment,
  person: Staff,
  surroundingAssignments: readonly Assignment[]
): string[] {
  const projected = [
    ...surroundingAssignments.map((item) => ({ ...item })),
    projectedAssignment(assignment, person),
  ];
  applyConfiguredEarlyReleases(projected, options.state, new Set([person.id]));
  return reassignmentDynamicSafetyReasons({
    state: options.state,
    assignments: projected,
    assignment: projected.at(-1)!,
    primaryAssignment: options.primary,
    review: options.review,
  });
}

function fixedAssignments(
  assignments: readonly Assignment[],
  movableAssignmentIds: ReadonlySet<string>
): Assignment[] {
  return assignments.filter(
    (assignment) => !movableAssignmentIds.has(assignment.id)
  );
}

export function fixedHoursForStaff(
  assignments: readonly Assignment[],
  staffId: string
): number {
  return assignments
    .filter(
      (assignment) =>
        assignment.staffId === staffId && assignment.status === "assigned"
    )
    .reduce((total, assignment) => total + assignment.workHours, 0);
}

function conflictsWithFixedAssignment(
  options: ReassignmentOptimizationOptions,
  assignment: Assignment,
  person: Staff,
  fixed: readonly Assignment[],
  permittedConcurrentAssignmentIds: ReadonlySet<string>
): boolean {
  const ownFixedAssignments = fixed.filter(
    (item) => item.staffId === person.id
  );
  const projected = [
    ...ownFixedAssignments.map((item) => ({ ...item })),
    projectedAssignment(assignment, person),
  ];
  applyConfiguredEarlyReleases(projected, options.state, new Set([person.id]));
  const projectedChoice = projected.at(-1)!;
  return projected
    .slice(0, -1)
    .some(
      (other) =>
        other.staffId === person.id &&
        intervalsOverlap(
          projectedChoice.startTime,
          projectedChoice.endTime,
          other.startTime,
          other.endTime
        ) &&
        !(
          permittedConcurrentAssignmentIds.has(assignment.id) &&
          permittedConcurrentAssignmentIds.has(other.id)
        )
    );
}

function createChoices(
  options: ReassignmentOptimizationOptions,
  movable: readonly Assignment[],
  fixed: readonly Assignment[]
): Pick<PreparedReassignmentChoices, "choices" | "candidateRejectionReasons"> {
  const permittedConcurrentAssignmentIds =
    options.permittedConcurrentAssignmentIds ?? new Set<string>();
  const activeStaff = options.state.staff.filter(
    (person) => person.status === "正常" && person.staffType === "常规"
  );
  const choices: ReassignmentChoiceFacts[] = [];
  const candidateRejectionReasons: string[] = [];
  for (const assignment of movable) {
    const flight = options.state.flights.find(
      (item) => item.id === assignment.flightId
    );
    const rule = assignmentRule(options.state, assignment);
    if (!flight || !rule) continue;
    const candidates = activeStaff
      .filter(
        (person) =>
          diagnoseBaseAssignmentEligibility(options.state, flight, rule, person)
            .eligible
      )
      .filter(
        (person) => options.candidateAllowed?.(assignment, person) ?? true
      )
      .filter(
        (person) =>
          !conflictsWithFixedAssignment(
            options,
            assignment,
            person,
            fixed,
            permittedConcurrentAssignmentIds
          )
      )
      .filter((person) => {
        if (person.id === assignment.staffId) return true;
        const projected = projectedAssignment(assignment, person);
        const reasons = [
          ...reassignmentCandidateSafetyReasons({
            state: options.state,
            assignment: projected,
            originalAssignment: assignment,
            primaryAssignment: options.primary,
            date: options.date,
            review: options.review,
            facts: options.facts,
            frequencyFacts: options.frequencyFacts,
            latePriorityFatigueRelief: options.latePriorityFatigueRelief,
            allowCutoffProtectionRegression:
              options.allowCutoffProtectionRegression,
          }),
          ...dynamicChoiceSafetyReasons(
            options,
            assignment,
            person,
            fixed.filter((item) => item.staffId === person.id)
          ),
        ];
        candidateRejectionReasons.push(...reasons);
        return reasons.length === 0;
      })
      .filter((person) => {
        if (assignment.id !== options.primary.id) return true;
        if (person.id === assignment.staffId) return false;
        if (options.primaryCandidateAllowed(person)) return true;
        const reason = options.primaryCandidateRejectionReason?.(person);
        if (reason) candidateRejectionReasons.push(reason);
        return false;
      })
      .sort((left, right) =>
        options.compareCandidates
          ? options.compareCandidates(assignment, left, right)
          : left.id.localeCompare(right.id, undefined, { numeric: true })
      );
    candidates.forEach((person, preferenceRank) => {
      choices.push({
        choice: {
          id: String(choices.length),
          assignmentId: assignment.id,
          staffId: person.id,
          keepsCurrentStaff: person.id === assignment.staffId,
          preferenceRank,
          workHours:
            options.choiceWorkHours?.(assignment, person) ??
            assignment.workHours,
        },
        assignment,
        person,
      });
    });
  }
  return {
    choices,
    candidateRejectionReasons: [...new Set(candidateRejectionReasons)],
  };
}

export function prepareReassignmentChoices(
  options: ReassignmentOptimizationOptions
): PreparedReassignmentChoices {
  const movable = [
    options.primary,
    ...options.movableAssignments.filter(
      (assignment) => assignment.id !== options.primary.id
    ),
  ];
  const movableIds = new Set(movable.map((assignment) => assignment.id));
  const fixed = fixedAssignments(options.assignments, movableIds);
  return { movable, fixed, ...createChoices(options, movable, fixed) };
}

export function incompatibleReassignmentChoices(
  choices: readonly ReassignmentChoiceFacts[],
  options: ReassignmentOptimizationOptions,
  fixed: readonly Assignment[],
  permittedConcurrentAssignmentIds: ReadonlySet<string>
): IncompatibleReassignmentChoices[] {
  const conflicts: IncompatibleReassignmentChoices[] = [];
  const choicesByStaffId = new Map<string, ReassignmentChoiceFacts[]>();
  for (const choice of choices) {
    const ownChoices = choicesByStaffId.get(choice.person.id) ?? [];
    ownChoices.push(choice);
    choicesByStaffId.set(choice.person.id, ownChoices);
  }
  for (const [staffId, ownChoices] of choicesByStaffId) {
    const ownFixedAssignments = fixed.filter(
      (assignment) => assignment.staffId === staffId
    );
    for (let leftIndex = 0; leftIndex < ownChoices.length; leftIndex += 1) {
      const left = ownChoices[leftIndex]!;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < ownChoices.length;
        rightIndex += 1
      ) {
        const right = ownChoices[rightIndex]!;
        if (left.assignment.id === right.assignment.id) continue;
        const projected = [
          ...ownFixedAssignments.map((assignment) => ({ ...assignment })),
          projectedAssignment(left.assignment, left.person),
          projectedAssignment(right.assignment, right.person),
        ];
        applyConfiguredEarlyReleases(
          projected,
          options.state,
          new Set([staffId])
        );
        const leftAssignment = projected.at(-2)!;
        const rightAssignment = projected.at(-1)!;
        const concurrencyPermitted =
          permittedConcurrentAssignmentIds.has(left.assignment.id) &&
          permittedConcurrentAssignmentIds.has(right.assignment.id);
        const timingConflict =
          !concurrencyPermitted &&
          intervalsOverlap(
            leftAssignment.startTime,
            leftAssignment.endTime,
            rightAssignment.startTime,
            rightAssignment.endTime
          );
        const dynamicReasons = [left, right].flatMap((choice, index) =>
          choice.choice.keepsCurrentStaff
            ? []
            : reassignmentDynamicSafetyReasons({
                state: options.state,
                assignments: permittedConcurrentAssignmentIds.has(
                  choice.assignment.id
                )
                  ? projected.filter(
                      (assignment) =>
                        assignment.id === choice.assignment.id ||
                        !permittedConcurrentAssignmentIds.has(assignment.id)
                    )
                  : projected,
                assignment: index === 0 ? leftAssignment : rightAssignment,
                primaryAssignment: options.primary,
                review: options.review,
              })
        );
        if (!timingConflict && !dynamicReasons.length) continue;
        conflicts.push({
          leftChoiceId: left.choice.id,
          rightChoiceId: right.choice.id,
        });
      }
    }
  }
  return conflicts;
}

export function decodeReassignmentChanges(
  selectedVariableIds: ReadonlySet<string>,
  choices: readonly ReassignmentChoiceFacts[]
): RotationStaffChange[] {
  return choices.flatMap(({ choice }) =>
    selectedVariableIds.has(choice.id) && !choice.keepsCurrentStaff
      ? [{ assignmentId: choice.assignmentId, staffId: choice.staffId }]
      : []
  );
}

function hasActualWork(
  assignments: readonly Assignment[],
  staffId: string
): boolean {
  return assignments.some(
    (assignment) =>
      assignment.staffId === staffId &&
      assignment.status === "assigned" &&
      assignment.workHours > 0
  );
}

export function reassignmentChoiceRequirements(
  options: ReassignmentOptimizationOptions,
  choices: readonly ReassignmentChoiceFacts[],
  movable: readonly Assignment[],
  fixed: readonly Assignment[]
): ReassignmentChoiceRequirement[] {
  const policy = ROTATION_REVIEW_POLICIES[options.review];
  const requirements: ReassignmentChoiceRequirement[] = [];
  if (policy.preventStaffWithoutWork) {
    const originalStaffIds = new Set(
      movable.flatMap((assignment) =>
        assignment.status === "assigned" && assignment.staffId
          ? [assignment.staffId]
          : []
      )
    );
    for (const staffId of originalStaffIds) {
      if (hasActualWork(fixed, staffId)) continue;
      requirements.push({
        id: `retain-work:${staffId}`,
        choiceIds: choices.flatMap(({ choice }) =>
          choice.staffId === staffId ? [choice.id] : []
        ),
        minimum: 1,
      });
    }
  }

  const dutyStaffId = options.facts?.currentDutyStaffId;
  if (
    policy.protectDutyMorning &&
    dutyStaffId &&
    !fixed.some(
      (assignment) =>
        assignment.staffId === dutyStaffId &&
        assignment.status === "assigned" &&
        assignment.workHours > 0 &&
        isDutyMorningFlight({ startTime: assignment.startTime }, options.state)
    )
  ) {
    requirements.push({
      id: `duty-morning:${dutyStaffId}`,
      choiceIds: choices.flatMap(({ choice, assignment }) =>
        choice.staffId === dutyStaffId &&
        choice.workHours > 0 &&
        isDutyMorningFlight({ startTime: assignment.startTime }, options.state)
          ? [choice.id]
          : []
      ),
      minimum: 1,
    });
  }
  return requirements;
}
