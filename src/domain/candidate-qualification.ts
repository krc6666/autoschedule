import type { AppState, Assignment, Flight, Staff } from "../model";
import { canReleaseForFlight, projectedAssignedHours, staffConflicts } from "./assignment-timing";
import type { AssignmentTask } from "./schedule-tasks";
import type { CandidatePriority } from "./scheduling-policy";
import { durationHours, intervalsOverlap } from "./time";

export function scarceQualificationPriority(
  person: Staff,
  flight: Flight,
  tasks: AssignmentTask[],
  processedTasks: Set<string>,
  eligibleCounts: Map<string, number>,
  eligibleStaffIds: Map<string, Set<string>>
): CandidatePriority["scarceQualification"] {
  const futureEligibleCounts = tasks.flatMap((task) => {
    if (processedTasks.has(task.key)
      || !eligibleStaffIds.get(task.key)?.has(person.id)
      || !intervalsOverlap(flight.startTime, flight.endTime, task.flight.startTime, task.flight.endTime)) return [];
    return [Math.max(1, eligibleCounts.get(task.key) ?? 1)];
  });
  return {
    futureTaskCount: futureEligibleCounts.length,
    minimumEligibleStaff: futureEligibleCounts.length ? Math.min(...futureEligibleCounts) : null
  };
}

export function priorityPositionScarceQualification(
  person: Staff,
  task: AssignmentTask,
  state: AppState,
  assignments: Assignment[],
  tasks: AssignmentTask[],
  processedTasks: Set<string>,
  eligibleCounts: Map<string, number>,
  eligibleStaffIds: Map<string, Set<string>>
): CandidatePriority["scarceQualification"] {
  const ordinaryPriority = scarceQualificationPriority(
    person,
    task.flight,
    tasks,
    processedTasks,
    eligibleCounts,
    eligibleStaffIds
  );
  const wouldLeaveFuturePositionWithoutCandidate = tasks.some((futureTask) => {
    if (processedTasks.has(futureTask.key)
      || !eligibleStaffIds.get(futureTask.key)?.has(person.id)
      || !intervalsOverlap(task.flight.startTime, task.flight.endTime, futureTask.flight.startTime, futureTask.flight.endTime)) return false;
    const futureHours = durationHours(futureTask.flight.startTime, futureTask.flight.endTime);
    return !state.staff.some((alternative) => alternative.id !== person.id
      && eligibleStaffIds.get(futureTask.key)?.has(alternative.id)
      && staffConflicts(assignments, alternative.id, futureTask.flight).every((assignment) => canReleaseForFlight(assignment, futureTask.flight, state))
      && projectedAssignedHours(assignments, alternative.id, futureTask.flight, state) + futureHours <= state.settings.maxDailyHours);
  });
  return wouldLeaveFuturePositionWithoutCandidate
    ? ordinaryPriority
    : { futureTaskCount: 0, minimumEligibleStaff: null };
}



