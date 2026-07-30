import type { AppState, Assignment } from "../model";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "./assignment-evidence";
import {
  isNextWorkdayCutoffConflict,
  nextWorkdayCutoffProtection,
} from "./cross-day-recovery";
import {
  isRotationLocked,
  reassignmentSafetyReasons,
  rotationCandidateAssignments,
} from "./rotation-review-safety";
import { schedulingDecision } from "../schedule-rule-contract";
import { timeToMinutes } from "./time";
import type { ScheduleRunFacts } from "./schedule-run-facts";

interface RecoveryPlan {
  assignments: Assignment[];
  latestEnd: number;
  description: string;
}

function operationalEnd(
  assignment: Pick<Assignment, "startTime" | "endTime">
): number {
  const start = timeToMinutes(assignment.startTime);
  let end = timeToMinutes(assignment.endTime);
  if (end <= start) end += 24 * 60;
  return end;
}

function latestAssignedEnd(assignments: Assignment[], staffId: string): number {
  const ends = assignments
    .filter(
      (assignment) =>
        assignment.status === "assigned" && assignment.staffId === staffId
    )
    .map(operationalEnd);
  return ends.length ? Math.max(...ends) : -1;
}

function plannedCycle(
  assignments: Assignment[],
  cycle: Assignment[]
): Assignment[] {
  return assignments.map((assignment) => {
    const index = cycle.findIndex((item) => item.id === assignment.id);
    if (index < 0) return assignment;
    const incoming = cycle[(index + 1) % cycle.length]!;
    return {
      ...assignment,
      staffId: incoming.staffId,
      staffName: incoming.staffName,
    };
  });
}

function chooseEarlierPlan(left: RecoveryPlan, right: RecoveryPlan): number {
  return (
    left.latestEnd - right.latestEnd ||
    left.description.localeCompare(right.description, "zh-CN")
  );
}

function applyPlan(
  assignments: Assignment[],
  plan: RecoveryPlan,
  protectedName: string
): void {
  const plannedById = new Map(
    plan.assignments.map((assignment) => [assignment.id, assignment])
  );
  const changed = assignments.filter((assignment) => {
    const planned = plannedById.get(assignment.id);
    return planned && planned.staffId !== assignment.staffId;
  });
  const message = `${protectedName}已通过${plan.description}落实末班重点岗位次班截止保护。`;
  changed.forEach((assignment) => {
    const planned = plannedById.get(assignment.id)!;
    assignment.staffId = planned.staffId;
    assignment.staffName = planned.staffName;
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("late-shift-cutoff", "selected", message),
    ]);
  });
}

function fallbackMessage(primary: Assignment, reasons: string[]): string {
  const details = [...new Set(reasons)].slice(0, 4);
  const reason = details.length
    ? details.join("；")
    : "没有可用的直接替代、两人交换或三人安全重排方案";
  return `末班重点岗位次班截止保护未落实：${primary.staffName}仍安排在${primary.flightNo}/${primary.position}；${reason}；为保证岗位完整性，本班允许突破。`;
}

export function reviewLateShiftCutoff(
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): string[] {
  if (!state.settings.lateShiftRecoveryEnabled) return [];
  const warnings: string[] = [];
  const protectedAssignments = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .filter((assignment) =>
      isNextWorkdayCutoffConflict(
        state,
        assignment.staffId!,
        assignment.startTime,
        date,
        facts?.crossDayRecovery
      )
    )
    .sort((left, right) => {
      const leftProtection = nextWorkdayCutoffProtection(
        state,
        left.staffId!,
        date,
        facts?.crossDayRecovery
      )!;
      const rightProtection = nextWorkdayCutoffProtection(
        state,
        right.staffId!,
        date,
        facts?.crossDayRecovery
      )!;
      return (
        leftProtection.cutoffMinutes - rightProtection.cutoffMinutes ||
        rightProtection.previousEndMinutes -
          leftProtection.previousEndMinutes ||
        operationalEnd(right) - operationalEnd(left)
      );
    });

  for (const primary of protectedAssignments) {
    if (
      !primary.staffId ||
      !isNextWorkdayCutoffConflict(
        state,
        primary.staffId,
        primary.startTime,
        date,
        facts?.crossDayRecovery
      )
    )
      continue;
    const protectedStaffId = primary.staffId;
    const protectedName = primary.staffName;
    const originalLatestEnd = latestAssignedEnd(assignments, protectedStaffId);
    const attemptedReasons = (primary.decisionTrace ?? [])
      .filter(
        (decision) =>
          decision.ruleId === "late-shift-cutoff" &&
          decision.outcome === "fallback"
      )
      .map((decision) => decision.message.split("；").slice(1).join("；"));

    const directPlans = state.staff
      .filter(
        (person) =>
          person.id !== protectedStaffId &&
          person.status === "正常" &&
          person.staffType === "常规"
      )
      .flatMap((person): RecoveryPlan[] => {
        const reasons = reassignmentSafetyReasons({
          kind: "direct",
          state,
          assignments,
          assignmentId: primary.id,
          staffId: person.id,
          date,
          facts,
        });
        if (reasons.length) {
          attemptedReasons.push(...reasons);
          return [];
        }
        const planned = assignments.map((assignment) =>
          assignment.id === primary.id
            ? { ...assignment, staffId: person.id, staffName: person.name }
            : assignment
        );
        const latestEnd = latestAssignedEnd(planned, protectedStaffId);
        if (latestEnd >= originalLatestEnd) return [];
        return [
          {
            assignments: planned,
            latestEnd,
            description: `由${person.name}直接接替${primary.flightNo}/${primary.position}`,
          },
        ];
      })
      .sort(chooseEarlierPlan);

    let plan = directPlans[0] ?? null;
    const candidates = rotationCandidateAssignments(
      assignments,
      primary,
      state,
      lockedAssignmentIds
    );
    if (!plan) {
      const pairPlans = candidates
        .flatMap((candidate): RecoveryPlan[] => {
          const cycle = [primary, candidate];
          const reasons = reassignmentSafetyReasons({
            kind: "cycle",
            state,
            assignments,
            cycle,
            date,
            review: "recovery",
            facts,
          });
          if (reasons.length) {
            attemptedReasons.push(...reasons);
            return [];
          }
          const planned = plannedCycle(assignments, cycle);
          const latestEnd = latestAssignedEnd(planned, protectedStaffId);
          if (latestEnd >= originalLatestEnd) return [];
          return [
            {
              assignments: planned,
              latestEnd,
              description: `与${candidate.staffName}两人安全交换`,
            },
          ];
        })
        .sort(chooseEarlierPlan);
      plan = pairPlans[0] ?? null;
    }

    if (!plan) {
      const triplePlans: RecoveryPlan[] = [];
      for (const second of candidates) {
        const thirds = rotationCandidateAssignments(
          assignments,
          second,
          state,
          lockedAssignmentIds
        ).filter(
          (candidate) =>
            candidate.id !== primary.id && candidate.id !== second.id
        );
        for (const third of thirds) {
          const cycle = [primary, second, third];
          const reasons = reassignmentSafetyReasons({
            kind: "cycle",
            state,
            assignments,
            cycle,
            date,
            review: "recovery",
            facts,
          });
          if (reasons.length) {
            attemptedReasons.push(...reasons);
            continue;
          }
          const planned = plannedCycle(assignments, cycle);
          const latestEnd = latestAssignedEnd(planned, protectedStaffId);
          if (latestEnd >= originalLatestEnd) continue;
          triplePlans.push({
            assignments: planned,
            latestEnd,
            description: `与${second.staffName}、${third.staffName}三人安全重排`,
          });
        }
      }
      plan = triplePlans.sort(chooseEarlierPlan)[0] ?? null;
    }

    if (plan) {
      applyPlan(assignments, plan, protectedName);
      continue;
    }

    const message = fallbackMessage(primary, attemptedReasons);
    replaceAssignmentDecisions(primary, "late-shift-cutoff", [
      schedulingDecision("late-shift-cutoff", "fallback", message),
    ]);
    warnings.push(message);
  }
  return warnings;
}
