import type { AppState, Assignment, Staff } from "../model";
import {
  diagnoseBaseAssignmentEligibility,
  eligibleStaffForRule,
} from "./assignment-eligibility";
import {
  comparePositionFrequency,
  createScheduleFrequencyFacts,
  POSITION_FREQUENCY_WORKDAY_COUNT,
  samePositionFrequencyProfile,
  type PositionFrequencyProfile,
} from "./schedule-frequency";
import { assignmentRule } from "./schedule-position-rules";
import {
  applyRotationCycleStaff,
  isRotationLocked,
  reassignmentSafetyReasons,
  rotationCandidateAssignments,
} from "./rotation-review-safety";
import { schedulingDecision } from "../schedule-rule-contract";
import { isPriorityRotationPosition } from "./position-rotation-policy";
import type { ScheduleRunFacts } from "./schedule-run-facts";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "./assignment-evidence";

function frequencyProfileText(profile: PositionFrequencyProfile): string {
  return `本月${profile.currentMonthCount}次、最近${POSITION_FREQUENCY_WORKDAY_COUNT}个已归档工作日${profile.recentWorkdayCount}次`;
}

function applyFrequencyExchange(
  cycle: Assignment[],
  primaryFrequency: PositionFrequencyProfile
): void {
  const original = applyRotationCycleStaff(cycle);
  const primary = original[0]!;
  const route =
    cycle.length === 2
      ? `已与${original[1]!.staffName}的${original[1]!.flightNo}/${original[1]!.position}安全交换`
      : `已通过${original.map((item) => `${item.staffName}:${item.flightNo}/${item.position}`).join(" → ")}的三人闭环交换`;
  const message = `${primary.staffName}${frequencyProfileText(primaryFrequency)}承担${primary.flightNo}/${primary.position}，本班${route}；岗位资质、岗位完整性及全部安全约束验证通过。`;
  cycle.forEach((assignment) => {
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("position-frequency-review", "selected", message),
    ]);
  });
}

interface FrequencyReassignment {
  assignment: Assignment;
  person: Staff;
}

function applyFrequencyReassignment(
  changes: FrequencyReassignment[],
  primaryFrequency: PositionFrequencyProfile,
  route: string
): void {
  const primary = changes[0]!.assignment;
  const originalName = primary.staffName;
  const originalFlightNo = primary.flightNo;
  const originalPosition = primary.position;
  for (const change of changes) {
    change.assignment.staffId = change.person.id;
    change.assignment.staffName = change.person.name;
  }
  const message = `${originalName}${frequencyProfileText(primaryFrequency)}承担${originalFlightNo}/${originalPosition}，本班${route}；岗位资质、岗位完整性及全部安全约束验证通过。`;
  changes.forEach(({ assignment }) => {
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("position-frequency-review", "selected", message),
    ]);
  });
}

function frequencyFallback(
  primary: Assignment,
  profile: PositionFrequencyProfile,
  reasons: string[]
): string {
  const reason =
    [...new Set(reasons)].join("；") || "没有满足全部安全约束的重排方案";
  const message = `同岗高频未调整：${primary.staffName}${frequencyProfileText(profile)}承担${primary.flightNo}/${primary.position}；${reason}；为保证岗位完整性，本班保留原安排。`;
  replaceAssignmentDecisions(primary, "position-frequency-review", [
    schedulingDecision("position-frequency-review", "fallback", message),
  ]);
  return message;
}

export function reviewSamePositionFrequency(
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): string[] {
  if (!state.settings.positionRotationEnabled) return [];
  const frequencyFacts =
    facts?.scheduleFrequency ?? createScheduleFrequencyFacts(state, date);
  const warnings: string[] = [];
  const reviewed = new Set<string>();
  const primaryAssignments = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .filter((assignment) => {
      const rule = assignmentRule(state, assignment);
      return Boolean(rule && isPriorityRotationPosition(rule));
    })
    .map((assignment) => ({
      assignment,
      frequency: samePositionFrequencyProfile(
        state,
        assignment.staffId!,
        assignment.flightNo,
        assignment.position,
        date,
        frequencyFacts
      ),
    }))
    .sort(
      (left, right) =>
        right.frequency.currentMonthCount - left.frequency.currentMonthCount ||
        right.frequency.recentWorkdayCount -
          left.frequency.recentWorkdayCount ||
        left.assignment.flightNo.localeCompare(right.assignment.flightNo) ||
        left.assignment.position.localeCompare(right.assignment.position)
    );

  for (const { assignment: primary } of primaryAssignments) {
    if (reviewed.has(primary.id)) continue;
    const frequency = samePositionFrequencyProfile(
      state,
      primary.staffId!,
      primary.flightNo,
      primary.position,
      date,
      frequencyFacts
    );
    if (frequency.currentMonthCount < 2 && frequency.recentWorkdayCount < 2)
      continue;
    const rule = assignmentRule(state, primary);
    const flight = state.flights.find((item) => item.id === primary.flightId);
    if (!rule || !flight) continue;
    const configuredOthers = state.staff.filter(
      (person) =>
        person.id !== primary.staffId &&
        person.staffType === "常规" &&
        rule.qualifiedStaffIds.includes(person.id)
    );
    const lowerFrequencyConfigured = configuredOthers.filter(
      (person) =>
        comparePositionFrequency(
          samePositionFrequencyProfile(
            state,
            person.id,
            primary.flightNo,
            primary.position,
            date,
            frequencyFacts
          ),
          frequency
        ) < 0
    );
    if (!lowerFrequencyConfigured.length) {
      if (
        !configuredOthers.length &&
        (frequency.currentMonthCount >= 2 || frequency.recentWorkdayCount >= 2)
      ) {
        warnings.push(
          frequencyFallback(primary, frequency, [
            "无其他具备目标岗位资质的人员",
          ])
        );
        reviewed.add(primary.id);
      }
      continue;
    }

    const attemptedReasons: string[] = [];
    const lowerFrequencyEligible = lowerFrequencyConfigured
      .filter((person) => {
        const diagnostic = diagnoseBaseAssignmentEligibility(
          state,
          flight,
          rule,
          person
        );
        attemptedReasons.push(
          ...diagnostic.violations.map((violation) => violation.message)
        );
        return diagnostic.eligible;
      })
      .sort(
        (left, right) =>
          comparePositionFrequency(
            samePositionFrequencyProfile(
              state,
              left.id,
              primary.flightNo,
              primary.position,
              date,
              frequencyFacts
            ),
            samePositionFrequencyProfile(
              state,
              right.id,
              primary.flightNo,
              primary.position,
              date,
              frequencyFacts
            )
          ) || left.id.localeCompare(right.id, undefined, { numeric: true })
      );

    let resolvedAssignments: Assignment[] | null = null;
    for (const person of lowerFrequencyEligible) {
      const direct = [{ assignment: primary, person }];
      const reasons = reassignmentSafetyReasons({
        kind: "plan",
        state,
        assignments,
        changes: [{ assignmentId: primary.id, staffId: person.id }],
        primaryAssignmentId: primary.id,
        date,
        review: "frequency",
        facts,
      });
      if (!reasons.length) {
        applyFrequencyReassignment(
          direct,
          frequency,
          `已由低频合格人员${person.name}直接接替`
        );
        resolvedAssignments = [primary];
        break;
      }
      attemptedReasons.push(...reasons);
    }
    if (resolvedAssignments) {
      resolvedAssignments.forEach((assignment) => reviewed.add(assignment.id));
      continue;
    }

    const candidates = rotationCandidateAssignments(
      assignments,
      primary,
      state,
      lockedAssignmentIds
    )
      .filter((candidate) => !reviewed.has(candidate.id))
      .filter((candidate) =>
        lowerFrequencyEligible.some((person) => person.id === candidate.staffId)
      );
    let exchange: Assignment[] | null = null;
    for (const candidate of candidates) {
      const direct = [primary, candidate];
      const reasons = reassignmentSafetyReasons({
        kind: "cycle",
        state,
        assignments,
        cycle: direct,
        date,
        review: "frequency",
        facts,
      });
      if (!reasons.length) {
        exchange = direct;
        break;
      }
      attemptedReasons.push(...reasons);
    }
    if (exchange) {
      applyFrequencyExchange(exchange, frequency);
      exchange.forEach((assignment) => reviewed.add(assignment.id));
      continue;
    }

    let pathChanges: FrequencyReassignment[] | null = null;
    for (const source of candidates) {
      const sourceRule = assignmentRule(state, source);
      const sourceFlight = state.flights.find(
        (item) => item.id === source.flightId
      );
      if (!sourceRule || !sourceFlight || !source.staffId) continue;
      const releaseCandidates = eligibleStaffForRule(
        state,
        sourceFlight,
        sourceRule
      )
        .filter(
          (person) =>
            person.id !== primary.staffId && person.id !== source.staffId
        )
        .sort((left, right) =>
          left.id.localeCompare(right.id, undefined, { numeric: true })
        );
      for (const releaseWorker of releaseCandidates) {
        const lowFrequencyPerson = state.staff.find(
          (person) => person.id === source.staffId
        )!;
        const changes = [
          { assignment: primary, person: lowFrequencyPerson },
          { assignment: source, person: releaseWorker },
        ];
        const reasons = reassignmentSafetyReasons({
          kind: "plan",
          state,
          assignments,
          changes: changes.map((change) => ({
            assignmentId: change.assignment.id,
            staffId: change.person.id,
          })),
          primaryAssignmentId: primary.id,
          date,
          review: "frequency",
          facts,
        });
        if (!reasons.length) {
          pathChanges = changes;
          break;
        }
        attemptedReasons.push(...reasons);
      }
      if (pathChanges) break;
    }
    if (pathChanges) {
      applyFrequencyReassignment(
        pathChanges,
        frequency,
        `已通过${pathChanges[0]!.person.name}接替目标岗位、${pathChanges[1]!.person.name}接替其原岗位的三人安全重排`
      );
      pathChanges.forEach(({ assignment }) => reviewed.add(assignment.id));
      continue;
    }

    let triple: Assignment[] | null = null;
    for (const second of candidates) {
      const thirdCandidates = rotationCandidateAssignments(
        assignments,
        second,
        state,
        lockedAssignmentIds
      ).filter(
        (candidate) =>
          candidate.id !== primary.id &&
          candidate.id !== second.id &&
          !reviewed.has(candidate.id)
      );
      for (const third of thirdCandidates) {
        const proposed = [primary, second, third];
        const reasons = reassignmentSafetyReasons({
          kind: "cycle",
          state,
          assignments,
          cycle: proposed,
          date,
          review: "frequency",
          facts,
        });
        if (!reasons.length) {
          triple = proposed;
          break;
        }
        attemptedReasons.push(...reasons);
      }
      if (triple) break;
    }
    if (triple) {
      applyFrequencyExchange(triple, frequency);
      triple.forEach((assignment) => reviewed.add(assignment.id));
      continue;
    }

    reviewed.add(primary.id);
    const lockedLowerFrequency = lowerFrequencyEligible.filter((person) =>
      assignments.some(
        (assignment) =>
          assignment.staffId === person.id &&
          isRotationLocked(state, assignment, lockedAssignmentIds)
      )
    );
    if (lockedLowerFrequency.length)
      attemptedReasons.push(
        `其他低频人员被值班或KE166特殊锁定：${lockedLowerFrequency.map((person) => person.name).join("、")}`
      );
    if (!candidates.length && !lockedLowerFrequency.length)
      attemptedReasons.push("其他低频人员没有可参与的同航班或重叠航班普通岗位");
    warnings.push(frequencyFallback(primary, frequency, attemptedReasons));
  }
  return warnings;
}
