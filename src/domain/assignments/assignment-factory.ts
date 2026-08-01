import type { Assignment, Staff } from "../../model";
import type { SchedulingDecision } from "../rules/schedule-rule-contract";
import { createId } from "../../utils";
import type { AssignmentTask } from "../flights/schedule-tasks";

export function createAssignedPosition(
  task: AssignmentTask,
  person: Staff,
  workHours: number,
  systemNotes: readonly string[],
  decisionTrace: readonly SchedulingDecision[]
): Assignment {
  const { flight, rule } = task;
  return {
    id: createId("assignment"),
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule.id,
    position: rule.name,
    staffId: person.id,
    staffName: person.name,
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours,
    fatiguePoints: rule.fatiguePoints,
    remark: rule.remark,
    manualRemark: "",
    status: "assigned",
    ...(systemNotes.length ? { systemNotes: [...systemNotes] } : {}),
    ...(decisionTrace.length ? { decisionTrace: [...decisionTrace] } : {}),
  };
}
