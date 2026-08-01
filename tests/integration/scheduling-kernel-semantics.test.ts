import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { buildScheduleFeedback } from "../../src/domain/feedback/schedule-feedback";
import { generateSchedule } from "../helpers/generate-schedule";

async function normalizedSchedule(date: string) {
  const state = createDefaultState();
  const result = await generateSchedule(state, date);
  const assignmentIds = new Map(
    result.assignments.map((assignment, index) => [
      assignment.id,
      `assignment-${index + 1}`,
    ])
  );
  const assignments = result.assignments.map((assignment) => ({
    ...assignment,
    id: assignmentIds.get(assignment.id),
    ...(assignment.supervisorSourceAssignmentId
      ? {
          supervisorSourceAssignmentId: assignmentIds.get(
            assignment.supervisorSourceAssignmentId
          ),
        }
      : {}),
  }));
  state.assignments = result.assignments;
  state.activeScheduleDate = date;
  return {
    assignments,
    unfilledCount: result.unfilledCount,
    warnings: result.warnings,
    feedback: buildScheduleFeedback(state, date),
  };
}

describe("scheduler semantic baseline", () => {
  it("preserves the complete default scheduling result during responsibility extraction", async () => {
    expect(await normalizedSchedule("2026-07-18")).toMatchSnapshot();
  });
});
