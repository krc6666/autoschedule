import type { Assignment, Flight, Staff } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { diagnoseAutomaticAssignmentEligibility } from "./assignment-eligibility";
import type { AssignmentTask } from "../flights/schedule-tasks";
import { durationHours, intervalsOverlap } from "../shared/time";

export interface ScarceQualificationPriority {
  futureTaskCount: number;
  minimumEligibleStaff: number | null;
}

export function scarceQualificationPriority(
  person: Staff,
  flight: Flight,
  tasks: AssignmentTask[],
  processedTasks: Set<string>,
  eligibleCounts: Map<string, number>,
  eligibleStaffIds: Map<string, Set<string>>
): ScarceQualificationPriority {
  const futureEligibleCounts = tasks.flatMap((task) => {
    if (
      processedTasks.has(task.key) ||
      !eligibleStaffIds.get(task.key)?.has(person.id) ||
      !intervalsOverlap(
        flight.startTime,
        flight.endTime,
        task.flight.startTime,
        task.flight.endTime
      )
    )
      return [];
    return [Math.max(1, eligibleCounts.get(task.key) ?? 1)];
  });
  return {
    futureTaskCount: futureEligibleCounts.length,
    minimumEligibleStaff: futureEligibleCounts.length
      ? Math.min(...futureEligibleCounts)
      : null,
  };
}

export function priorityPositionScarceQualification(
  person: Staff,
  task: AssignmentTask,
  state: ScheduleGenerationFacts,
  assignments: Assignment[],
  tasks: AssignmentTask[],
  processedTasks: Set<string>,
  eligibleCounts: Map<string, number>,
  eligibleStaffIds: Map<string, Set<string>>
): ScarceQualificationPriority {
  const ordinaryPriority = scarceQualificationPriority(
    person,
    task.flight,
    tasks,
    processedTasks,
    eligibleCounts,
    eligibleStaffIds
  );
  const wouldLeaveFuturePositionWithoutCandidate = tasks.some((futureTask) => {
    if (
      processedTasks.has(futureTask.key) ||
      !eligibleStaffIds.get(futureTask.key)?.has(person.id) ||
      !intervalsOverlap(
        task.flight.startTime,
        task.flight.endTime,
        futureTask.flight.startTime,
        futureTask.flight.endTime
      )
    )
      return false;
    const futureHours = durationHours(
      futureTask.flight.startTime,
      futureTask.flight.endTime
    );
    return !state.staff.some(
      (alternative) =>
        alternative.id !== person.id &&
        eligibleStaffIds.get(futureTask.key)?.has(alternative.id) &&
        diagnoseAutomaticAssignmentEligibility({
          state,
          assignments,
          flight: futureTask.flight,
          rule: futureTask.rule,
          person: alternative,
          workHours: futureHours,
        }).eligible
    );
  });
  return wouldLeaveFuturePositionWithoutCandidate
    ? ordinaryPriority
    : { futureTaskCount: 0, minimumEligibleStaff: null };
}
