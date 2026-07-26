import type { Assignment } from "../model";

export function clearAutomaticAssignmentEvidence(assignment: Assignment): void {
  delete assignment.systemNotes;
  delete assignment.decisionTrace;
}
