import type { AppState, Assignment } from "../model";
import { consecutivePositionAssignments } from "./schedule-frequency";
import { assignmentRule } from "./schedule-position-rules";
import {
  isRotationLocked,
  rotationCandidateAssignments,
  rotationCycleSafetyReasons
} from "./rotation-review-safety";
import { isPriorityRotationPosition, schedulingDecision } from "./scheduling-policy";

function applyRotationCycle(cycle: Assignment[], previousRuns: number[]): void {
  const original = cycle.map((assignment) => ({ staffId: assignment.staffId!, staffName: assignment.staffName, flightNo: assignment.flightNo, position: assignment.position }));
  const primary = original[0]!;
  cycle.forEach((assignment, index) => {
    const incoming = original[(index + 1) % original.length]!;
    assignment.staffId = incoming.staffId;
    assignment.staffName = incoming.staffName;
  });
  const route = cycle.length === 2
    ? `已与${original[1]!.staffName}的${original[1]!.flightNo}/${original[1]!.position}交换`
    : `已通过${original.map((item) => `${item.staffName}:${item.flightNo}/${item.position}`).join(" → ")}的三人闭环交换`;
  const message = `${primary.staffName}已连续${previousRuns[0] === 1 ? "一" : "两"}个工作班承担${primary.flightNo}/${primary.position}，本班${route}；双方岗位资质、岗位完整性及全部安全约束验证通过。`;
  cycle.forEach((assignment) => {
    assignment.decisionTrace = [
      ...(assignment.decisionTrace ?? []),
      schedulingDecision("position-rotation", "selected", message)
    ];
  });
}

export function reviewConsecutivePositionRotation(
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>
): string[] {
  if (!state.settings.positionRotationEnabled) return [];
  const reviewed = new Set<string>();
  const warnings: string[] = [];
  const primaryAssignments = assignments
    .filter((assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds))
    .map((assignment) => ({
      assignment,
      priority: isPriorityRotationPosition(assignmentRule(state, assignment)!),
      runs: consecutivePositionAssignments(state, assignment.staffId!, assignment.flightNo, assignment.position, date)
    }))
    .filter((item) => item.priority ? item.runs > 0 : item.runs >= 2)
    .sort((left, right) => Number(right.priority) - Number(left.priority)
      || right.runs - left.runs || left.assignment.flightNo.localeCompare(right.assignment.flightNo)
      || left.assignment.position.localeCompare(right.assignment.position));

  for (const { assignment: primary, runs, priority } of primaryAssignments) {
    if (reviewed.has(primary.id)) continue;
    const candidates = rotationCandidateAssignments(assignments, primary, state, lockedAssignmentIds)
      .filter((candidate) => !reviewed.has(candidate.id))
      .filter((candidate) => priority || !isPriorityRotationPosition(assignmentRule(state, candidate)!));
    const attemptedReasons: string[] = [];
    let cycle: Assignment[] | null = null;
    for (const candidate of candidates) {
      const direct = [primary, candidate];
      const reasons = rotationCycleSafetyReasons(state, assignments, direct, date, "consecutive");
      if (!reasons.length) {
        cycle = direct;
        break;
      }
      attemptedReasons.push(...reasons);
    }
    if (!cycle) {
      for (const second of candidates) {
        const thirdCandidates = rotationCandidateAssignments(assignments, second, state, lockedAssignmentIds)
          .filter((candidate) => candidate.id !== primary.id && candidate.id !== second.id && !reviewed.has(candidate.id));
        for (const third of thirdCandidates) {
          const triple = [primary, second, third];
          const reasons = rotationCycleSafetyReasons(state, assignments, triple, date, "consecutive");
          if (!reasons.length) {
            cycle = triple;
            break;
          }
          attemptedReasons.push(...reasons);
        }
        if (cycle) break;
      }
    }
    if (cycle) {
      const previousRuns = cycle.map((item) => consecutivePositionAssignments(state, item.staffId!, item.flightNo, item.position, date));
      applyRotationCycle(cycle, previousRuns);
      cycle.forEach((item) => reviewed.add(item.id));
      continue;
    }
    reviewed.add(primary.id);
    if (runs < 2) continue;
    const details = [...new Set(attemptedReasons)].slice(0, 3);
    const reason = details.length ? details.join("；") : candidates.length
      ? "没有满足全部安全约束的交换人员"
      : "没有可交换的常规岗位人员";
    const message = `连续轮岗未落实：${primary.staffName}已连续两个工作班承担${primary.flightNo}/${primary.position}；${reason}；为保证岗位完整性，本班异常保留该人员，形成第三次连续安排。`;
    primary.decisionTrace = [
      ...(primary.decisionTrace ?? []),
      schedulingDecision("position-rotation", "fallback", message)
    ];
    warnings.push(message);
  }
  return warnings;
}





