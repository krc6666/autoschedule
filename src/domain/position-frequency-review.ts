import type { AppState, Assignment, Staff } from "../model";
import { eligibleStaffForRule } from "./assignment-eligibility";
import { canAssignStaff } from "./assignment-validation";
import {
  comparePositionFrequency,
  POSITION_FREQUENCY_WORKDAY_COUNT,
  positionFrequencyProfileForAssignment,
  samePositionFrequencyProfile,
  type PositionFrequencyProfile
} from "./schedule-frequency";
import { assignmentRule } from "./schedule-position-rules";
import {
  hasHighLoadTransition,
  lateShiftRecoveryRisk,
  positionTransitionInsertionCost,
  rollingLoadCost
} from "./schedule-protection";
import {
  isRotationLocked,
  rotationCandidateAssignments,
  rotationCycleReason,
  rotationCycleSafetyReasons
} from "./rotation-review-safety";
import { isPriorityRotationPosition, schedulingDecision } from "./scheduling-policy";
import { isNightInterval } from "./time";

function frequencyProfileText(profile: PositionFrequencyProfile): string {
  return `本月${profile.currentMonthCount}次、最近${POSITION_FREQUENCY_WORKDAY_COUNT}个已归档工作日${profile.recentWorkdayCount}次`;
}

function applyFrequencyExchange(cycle: Assignment[], primaryFrequency: PositionFrequencyProfile): void {
  const original = cycle.map((assignment) => ({ staffId: assignment.staffId!, staffName: assignment.staffName, flightNo: assignment.flightNo, position: assignment.position }));
  const primary = original[0]!;
  cycle.forEach((assignment, index) => {
    const incoming = original[(index + 1) % cycle.length]!;
    assignment.staffId = incoming.staffId;
    assignment.staffName = incoming.staffName;
  });
  const route = cycle.length === 2
    ? `已与${original[1]!.staffName}的${original[1]!.flightNo}/${original[1]!.position}安全交换`
    : `已通过${original.map((item) => `${item.staffName}:${item.flightNo}/${item.position}`).join(" → ")}的三人闭环交换`;
  const message = `${primary.staffName}${frequencyProfileText(primaryFrequency)}承担${primary.flightNo}/${primary.position}，本班${route}；岗位资质、岗位完整性及全部安全约束验证通过。`;
  cycle.forEach((assignment) => {
    assignment.decisionTrace = [
      ...(assignment.decisionTrace ?? []),
      schedulingDecision("position-frequency-review", "selected", message)
    ];
  });
}

interface FrequencyReassignment {
  assignment: Assignment;
  person: Staff;
}

function frequencyReassignmentSafetyReasons(
  state: AppState,
  assignments: Assignment[],
  changes: FrequencyReassignment[],
  primary: Assignment,
  date: string
): string[] {
  const changedIds = new Set(changes.map((change) => change.assignment.id));
  const incomingByAssignmentId = new Map(changes.map((change) => [change.assignment.id, change.person]));
  const originalStaffIds = new Set(changes.map((change) => change.assignment.staffId).filter((staffId): staffId is string => Boolean(staffId)));
  const incomingStaffIds = new Set(changes.map((change) => change.person.id));
  const planned = assignments.map((assignment) => {
    const incoming = incomingByAssignmentId.get(assignment.id);
    return incoming ? { ...assignment, staffId: incoming.id, staffName: incoming.name } : assignment;
  });
  const plannedState: AppState = { ...state, assignments: planned };
  const reasons: string[] = [];

  for (const change of changes) {
    const plannedAssignment = planned.find((assignment) => assignment.id === change.assignment.id)!;
    const assignmentError = canAssignStaff(plannedState, plannedAssignment.id, change.person.id);
    if (assignmentError) reasons.push(rotationCycleReason(assignmentError));
    const flight = state.flights.find((item) => item.id === plannedAssignment.flightId);
    const rule = assignmentRule(state, plannedAssignment);
    if (!flight || !rule) {
      reasons.push("交换目标航班或岗位规则不存在");
      continue;
    }
    const otherAssignments = planned.filter((assignment) => assignment.id !== plannedAssignment.id);
    if (positionTransitionInsertionCost(otherAssignments, change.person.id, {
      key: `${flight.id}:${rule.id}`,
      flight,
      rule
    }, state, "prefer") > 0) reasons.push("交换后违反岗位衔接保护");
    if (state.settings.highLoadProtectionEnabled
      && hasHighLoadTransition(otherAssignments, change.person.id, plannedAssignment.startTime, plannedAssignment.endTime, plannedAssignment.fatiguePoints, plannedAssignment.remark, state)) {
      reasons.push("交换后违反高负荷疲劳保护");
    }
    if (state.settings.rollingLoadProtectionEnabled
      && rollingLoadCost(otherAssignments, change.person.id, plannedAssignment.startTime, plannedAssignment.fatiguePoints, plannedAssignment.remark, state) > 0) {
      reasons.push("交换后违反滚动负荷保护");
    }
    if (lateShiftRecoveryRisk(state, change.person.id, {
      ...flight,
      position: plannedAssignment.position,
      remark: plannedAssignment.remark,
      fatiguePoints: plannedAssignment.fatiguePoints
    }, date).excess > 0) {
      reasons.push("交换后违反跨工作日晚班疲劳保护");
    }
    const before = change.assignment.staffId
      ? positionFrequencyProfileForAssignment(state, change.assignment, change.assignment.staffId, date)
      : { currentMonthCount: 0, recentWorkdayCount: 0 };
    const after = positionFrequencyProfileForAssignment(state, change.assignment, change.person.id, date);
    const difference = comparePositionFrequency(after, before);
    if (change.assignment.id === primary.id ? difference >= 0 : difference > 0) {
      reasons.push("重排未降低目标岗位同岗频率或会转移高频问题");
    }
  }

  const removedStaffIds = [...originalStaffIds].filter((staffId) => !incomingStaffIds.has(staffId));
  for (const staffId of removedStaffIds) {
    const hasOtherWork = planned.some((assignment) => !changedIds.has(assignment.id)
      && assignment.staffId === staffId
      && assignment.status === "assigned"
      && assignment.workHours > 0);
    if (!hasOtherWork) reasons.push("重排会使原人员当日无实际岗位");
  }
  return [...new Set(reasons)];
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
    assignment.decisionTrace = [
      ...(assignment.decisionTrace ?? []),
      schedulingDecision("position-frequency-review", "selected", message)
    ];
  });
}

function frequencyFallback(
  primary: Assignment,
  profile: PositionFrequencyProfile,
  reasons: string[]
): string {
  const reason = [...new Set(reasons)].join("；") || "没有满足全部安全约束的重排方案";
  const message = `同岗高频未调整：${primary.staffName}${frequencyProfileText(profile)}承担${primary.flightNo}/${primary.position}；${reason}；为保证岗位完整性，本班保留原安排。`;
  primary.decisionTrace = [
    ...(primary.decisionTrace ?? []),
    schedulingDecision("position-frequency-review", "fallback", message)
  ];
  return message;
}

export function reviewSamePositionFrequency(
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>
): string[] {
  if (!state.settings.positionRotationEnabled) return [];
  const warnings: string[] = [];
  const reviewed = new Set<string>();
  const primaryAssignments = assignments
    .filter((assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds))
    .filter((assignment) => {
      const rule = assignmentRule(state, assignment);
      return Boolean(rule && isPriorityRotationPosition(rule));
    })
    .map((assignment) => ({ assignment, frequency: samePositionFrequencyProfile(state, assignment.staffId!, assignment.flightNo, assignment.position, date) }))
    .sort((left, right) => right.frequency.currentMonthCount - left.frequency.currentMonthCount
      || right.frequency.recentWorkdayCount - left.frequency.recentWorkdayCount
      || left.assignment.flightNo.localeCompare(right.assignment.flightNo)
      || left.assignment.position.localeCompare(right.assignment.position));

  for (const { assignment: primary } of primaryAssignments) {
    if (reviewed.has(primary.id)) continue;
    const frequency = samePositionFrequencyProfile(state, primary.staffId!, primary.flightNo, primary.position, date);
    if (frequency.currentMonthCount < 2 && frequency.recentWorkdayCount < 2) continue;
    const rule = assignmentRule(state, primary);
    const flight = state.flights.find((item) => item.id === primary.flightId);
    if (!rule || !flight) continue;
    const configuredOthers = state.staff.filter((person) => person.id !== primary.staffId
      && person.staffType === "常规"
      && rule.qualifiedStaffIds.includes(person.id));
    const lowerFrequencyConfigured = configuredOthers.filter((person) => comparePositionFrequency(
      samePositionFrequencyProfile(state, person.id, primary.flightNo, primary.position, date),
      frequency
    ) < 0);
    if (!lowerFrequencyConfigured.length) {
      if (!configuredOthers.length && (frequency.currentMonthCount >= 2 || frequency.recentWorkdayCount >= 2)) {
        warnings.push(frequencyFallback(primary, frequency, ["无其他具备目标岗位资质的人员"]));
        reviewed.add(primary.id);
      }
      continue;
    }

    const attemptedReasons: string[] = [];
    const lowerFrequencyEligible = lowerFrequencyConfigured
      .filter((person) => {
        if (person.status !== "正常") {
          attemptedReasons.push(`${person.name}当前状态为${person.status}`);
          return false;
        }
        if (isNightInterval(flight.startTime, flight.endTime, state.settings.nightStart, state.settings.nightEnd) && !person.nightShift) {
          attemptedReasons.push(`${person.name}不具备夜班能力`);
          return false;
        }
        return true;
      })
      .sort((left, right) => comparePositionFrequency(
        samePositionFrequencyProfile(state, left.id, primary.flightNo, primary.position, date),
        samePositionFrequencyProfile(state, right.id, primary.flightNo, primary.position, date)
      ) || left.id.localeCompare(right.id, undefined, { numeric: true }));

    let resolvedAssignments: Assignment[] | null = null;
    for (const person of lowerFrequencyEligible) {
      const direct = [{ assignment: primary, person }];
      const reasons = frequencyReassignmentSafetyReasons(state, assignments, direct, primary, date);
      if (!reasons.length) {
        applyFrequencyReassignment(direct, frequency, `已由低频合格人员${person.name}直接接替`);
        resolvedAssignments = [primary];
        break;
      }
      attemptedReasons.push(...reasons);
    }
    if (resolvedAssignments) {
      resolvedAssignments.forEach((assignment) => reviewed.add(assignment.id));
      continue;
    }

    const candidates = rotationCandidateAssignments(assignments, primary, state, lockedAssignmentIds)
      .filter((candidate) => !reviewed.has(candidate.id))
      .filter((candidate) => lowerFrequencyEligible.some((person) => person.id === candidate.staffId));
    let exchange: Assignment[] | null = null;
    for (const candidate of candidates) {
      const direct = [primary, candidate];
      const reasons = rotationCycleSafetyReasons(state, assignments, direct, date, "frequency");
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
      const sourceFlight = state.flights.find((item) => item.id === source.flightId);
      if (!sourceRule || !sourceFlight || !source.staffId) continue;
      const releaseCandidates = eligibleStaffForRule(state, sourceFlight, sourceRule)
        .filter((person) => person.id !== primary.staffId && person.id !== source.staffId)
        .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
      for (const releaseWorker of releaseCandidates) {
        const lowFrequencyPerson = state.staff.find((person) => person.id === source.staffId)!;
        const changes = [
          { assignment: primary, person: lowFrequencyPerson },
          { assignment: source, person: releaseWorker }
        ];
        const reasons = frequencyReassignmentSafetyReasons(state, assignments, changes, primary, date);
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
      const thirdCandidates = rotationCandidateAssignments(assignments, second, state, lockedAssignmentIds)
        .filter((candidate) => candidate.id !== primary.id && candidate.id !== second.id && !reviewed.has(candidate.id));
      for (const third of thirdCandidates) {
        const proposed = [primary, second, third];
        const reasons = rotationCycleSafetyReasons(state, assignments, proposed, date, "frequency");
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
    const lockedLowerFrequency = lowerFrequencyEligible.filter((person) => assignments.some((assignment) => assignment.staffId === person.id
      && isRotationLocked(state, assignment, lockedAssignmentIds)));
    if (lockedLowerFrequency.length) attemptedReasons.push(`其他低频人员被值班或KE166特殊锁定：${lockedLowerFrequency.map((person) => person.name).join("、")}`);
    if (!candidates.length && !lockedLowerFrequency.length) attemptedReasons.push("其他低频人员没有可参与的同航班或重叠航班普通岗位");
    warnings.push(frequencyFallback(primary, frequency, attemptedReasons));
  }
  return warnings;
}



