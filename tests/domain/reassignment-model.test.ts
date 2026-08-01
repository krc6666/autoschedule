import { describe, expect, it } from "vitest";

import {
  buildReassignmentProblem,
  type ReassignmentModelInput,
} from "../../src/domain/solver/reassignment-model";

function modelInput(
  overrides: Partial<ReassignmentModelInput> = {}
): ReassignmentModelInput {
  return {
    choices: [
      {
        id: "choice-a",
        assignmentId: "assignment-a",
        staffId: "staff-a",
        keepsCurrentStaff: true,
        preferenceRank: 0,
        workHours: 2,
      },
      {
        id: "choice-b",
        assignmentId: "assignment-a",
        staffId: "staff-b",
        keepsCurrentStaff: false,
        preferenceRank: 1,
        workHours: 2,
      },
    ],
    assignmentIds: ["assignment-a"],
    incompatibilities: [],
    capacities: [],
    excludedSelections: [],
    timeoutMs: 1_000,
    ...overrides,
  };
}

describe("reassignment solver model", () => {
  it("expresses required candidate groups as linear lower bounds", () => {
    const input = modelInput() as ReassignmentModelInput & {
      choiceRequirements: Array<{
        id: string;
        choiceIds: string[];
        minimum: number;
      }>;
    };
    input.choiceRequirements = [
      {
        id: "retain-staff-a",
        choiceIds: ["choice-a"],
        minimum: 1,
      },
    ];

    const problem = buildReassignmentProblem(input);

    expect(problem.constraints).toContainEqual({
      id: "required:retain-staff-a",
      terms: [{ variableId: "choice-a", coefficient: 1 }],
      lowerBound: 1,
    });
  });
});
