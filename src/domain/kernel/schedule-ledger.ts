import { freeze } from "immer";

import type { Assignment } from "../../model";
import type { ScheduleSafetySession } from "./schedule-safety-session";

export type ScheduleProposal =
  | { type: "append"; assignments: readonly Assignment[] }
  | { type: "replace"; assignments: readonly Assignment[] }
  | { type: "remove"; assignmentIds: readonly string[] };

export interface ScheduleLedger {
  snapshot(): readonly Readonly<Assignment>[];
  commit(proposal: ScheduleProposal): void;
}

export interface ScheduleLedgerOptions {
  safetySession?: ScheduleSafetySession;
}

function cloneAssignments(assignments: readonly Assignment[]): Assignment[] {
  return assignments.map((assignment) => structuredClone(assignment));
}

function validateAssignments(assignments: readonly Assignment[]): void {
  const ids = new Set<string>();
  for (const assignment of assignments) {
    if (!assignment.id.trim()) throw new Error("排班项缺少 ID");
    if (ids.has(assignment.id))
      throw new Error(`排班项 ID 重复：${assignment.id}`);
    ids.add(assignment.id);
  }
}

export function createScheduleLedger(
  initial: readonly Assignment[] = [],
  options: ScheduleLedgerOptions = {}
): ScheduleLedger {
  let current = freeze(cloneAssignments(initial), true);
  validateAssignments(current);
  return Object.freeze({
    snapshot: () => current,
    commit: (proposal: ScheduleProposal) => {
      const next =
        proposal.type === "append"
          ? [...current, ...cloneAssignments(proposal.assignments)]
          : proposal.type === "replace"
            ? cloneAssignments(proposal.assignments)
            : current.filter(
                (assignment) => !proposal.assignmentIds.includes(assignment.id)
              );
      validateAssignments(next);
      options.safetySession?.assertAssignmentsSafe(next);
      current = freeze(next, true);
    },
  });
}
