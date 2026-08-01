import type { AppState, Assignment } from "../../model";
import { consecutivePositionAssignments } from "../statistics/schedule-frequency";
import { assignmentRule } from "../flights/schedule-position-rules";
import { isKe166MobileSupervisor } from "../flights/schedule-tasks";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import { isPriorityRotationPosition } from "./position-rotation-policy";
import {
  appendAssignmentDecision,
  replaceAssignmentDecisions,
} from "../assignments/assignment-evidence";

function clearPositionRotationDecisions(assignment: Assignment): void {
  replaceAssignmentDecisions(assignment, "position-rotation", []);
}

export function refreshPositionRotationEvidence(
  state: AppState,
  date: string | null
): void {
  state.assignments.forEach(clearPositionRotationDecisions);
  if (!date || !state.settings.positionRotationEnabled) return;

  for (const assignment of state.assignments) {
    const rule = assignmentRule(state, assignment);
    const flight = state.flights.find(
      (item) => item.id === assignment.flightId
    );
    if (
      rule &&
      flight &&
      isKe166MobileSupervisor(flight, rule) &&
      assignment.status === "assigned" &&
      assignment.staffId
    ) {
      const previousRuns = consecutivePositionAssignments(
        state,
        assignment.staffId,
        assignment.flightNo,
        assignment.position,
        date
      );
      if (previousRuns >= 1) {
        const linkedAssignments = state.assignments.filter(
          (item) => item.supervisorSourceAssignmentId === assignment.id
        );
        const message = `KE166机动督导连续轮岗未落实：${assignment.staffName}上一工作班已承担${assignment.flightNo}/${assignment.position}，手动调整后的本班仍再次承担；当前人工安排未解除${linkedAssignments.length ? "机动督导及兼任柜台的整组" : "独立机动督导"}连续，请复核或保留并说明。`;
        for (const target of [assignment, ...linkedAssignments]) {
          appendAssignmentDecision(
            target,
            schedulingDecision("position-rotation", "fallback", message)
          );
        }
      }
      continue;
    }
    if (
      !rule ||
      rule.category !== "常规" ||
      rule.manual ||
      assignment.supervisorSourceAssignmentId !== undefined ||
      assignment.status !== "assigned" ||
      !assignment.staffId
    )
      continue;
    const priority = isPriorityRotationPosition(rule);
    const previousRuns = consecutivePositionAssignments(
      state,
      assignment.staffId,
      assignment.flightNo,
      assignment.position,
      date
    );
    if (priority ? previousRuns < 1 : previousRuns < 2) continue;
    const message =
      priority && previousRuns === 1
        ? `重点岗位连续轮岗未落实：${assignment.staffName}上一工作班已承担${assignment.flightNo}/${assignment.position}，手动调整后的本班仍再次承担；当前人工安排未解除连续重点岗位，请复核或保留并说明。`
        : `连续轮岗未落实：${assignment.staffName}此前已连续两个工作班承担${assignment.flightNo}/${assignment.position}，手动调整后的本班仍再次承担；当前人工安排未解除连续岗位。`;
    appendAssignmentDecision(
      assignment,
      schedulingDecision("position-rotation", "fallback", message)
    );
  }
}
