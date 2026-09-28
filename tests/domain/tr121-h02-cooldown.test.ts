import { describe, expect, it } from "vitest";

import { generateSchedule } from "../helpers/generate-schedule";
import {
  createTr121H02CooldownHistoryRecord,
  createTr121H02CooldownScenario,
} from "../helpers/scheduling-scenario";
import { createScheduleFrequencyFacts } from "../../src/domain/statistics/schedule-frequency";
import { tr121H02CooldownProfile } from "../../src/domain/rules/tr121-h02-cooldown";
import { reassignmentSafetyReasons } from "../../src/domain/reviews/rotation-review-safety";
import { preferredDutyLateTasks } from "../../src/domain/assignments/duty-assignment";

const DATE = "2026-09-15";

describe("TR121/H02 workday cooldown", () => {
  it("uses a worker outside the three-workday cooldown before an equally frequent recent worker", async () => {
    const { state, recent, rested } = createTr121H02CooldownScenario();

    const result = await generateSchedule(state, DATE);
    const h02 = result.assignments.find(
      (assignment) => assignment.positionRuleId === "tr121-h02"
    );

    expect(h02).toMatchObject({ status: "assigned", staffId: rested.id });
    expect(h02?.staffId).not.toBe(recent.id);
  });

  it("counts the exact workday boundary and supports disabling cooldown", () => {
    const { state, recent, rested } = createTr121H02CooldownScenario();
    const facts = createScheduleFrequencyFacts(state, DATE);
    const rule = state.positionRules[0]!;
    expect(
      tr121H02CooldownProfile(state, recent.id, "TR121", rule, DATE, facts)
    ).toMatchObject({ inCooldown: true, remainingWorkdays: 2 });
    expect(
      tr121H02CooldownProfile(state, rested.id, "TR121", rule, DATE, facts)
    ).toMatchObject({ inCooldown: false, remainingWorkdays: 0 });
    state.settings.tr121H02CooldownWorkdays = 0;
    expect(
      tr121H02CooldownProfile(
        state,
        recent.id,
        "TR121",
        rule,
        DATE,
        createScheduleFrequencyFacts(state, DATE)
      ).inCooldown
    ).toBe(false);
  });

  it("when everyone is cooling down, chooses the person whose cooldown ends sooner", async () => {
    const { state, recent, rested } = createTr121H02CooldownScenario();
    state.history = state.history.map((record) =>
      record.id === "recent-h02"
        ? { ...record, date: "2026-09-13" }
        : record.id === "rested-h02"
          ? { ...record, date: "2026-09-11" }
          : record
    );
    const result = await generateSchedule(state, DATE);
    const h02 = result.assignments.find(
      (assignment) => assignment.positionRuleId === "tr121-h02"
    );
    expect(h02).toMatchObject({ status: "assigned", staffId: rested.id });
    expect(h02?.staffId).not.toBe(recent.id);
    expect(
      h02?.decisionTrace?.some(
        (decision) =>
          decision.ruleId === "tr121-h02-cooldown" &&
          decision.outcome === "fallback"
      )
    ).toBe(true);
  });

  it("does not apply to another flight or another position", () => {
    const { state, recent } = createTr121H02CooldownScenario();
    const facts = createScheduleFrequencyFacts(state, DATE);
    const rule = state.positionRules[0]!;
    expect(
      tr121H02CooldownProfile(state, recent.id, "TW616", rule, DATE, facts)
        .applies
    ).toBe(false);
    expect(
      tr121H02CooldownProfile(
        state,
        recent.id,
        "TR121",
        { ...rule, name: "H03" },
        DATE,
        facts
      ).applies
    ).toBe(false);
  });

  it("keeps the monthly automatic limit above cooldown fallback", async () => {
    const { state, recent, rested } = createTr121H02CooldownScenario();
    state.history.push(
      createTr121H02CooldownHistoryRecord(
        "recent-h02-month-1",
        "2026-09-01",
        recent,
        "H02",
        "一号"
      ),
      createTr121H02CooldownHistoryRecord(
        "recent-h02-month-2",
        "2026-09-03",
        recent,
        "H02",
        "一号"
      )
    );
    const result = await generateSchedule(state, DATE);
    const h02 = result.assignments.find(
      (assignment) => assignment.positionRuleId === "tr121-h02"
    );
    expect(h02?.staffId).toBe(rested.id);
  });

  it("keeps a cooling H02 as the duty fallback when no other late target exists", () => {
    const { state, recent } = createTr121H02CooldownScenario();
    const task = {
      key: "tr121-h02-task",
      flight: state.flights[0]!,
      rule: state.positionRules[0]!,
    };
    expect(
      preferredDutyLateTasks(
        state,
        DATE,
        [task],
        recent.id,
        createScheduleFrequencyFacts(state, DATE)
      ).map((item) => item.key)
    ).toEqual([task.key]);
  });

  it("rejects a post-review swap that changes a non-cooling H02 assignment to a cooling worker", () => {
    const { state, recent, rested } = createTr121H02CooldownScenario();
    const assignment = {
      id: "h02-assignment",
      flightId: "tr121",
      flightNo: "TR121",
      positionRuleId: "tr121-h02",
      position: "H02",
      staffId: rested.id,
      staffName: rested.name,
      startTime: "21:30",
      endTime: "23:30",
      workHours: 2,
      fatiguePoints: 10,
      remark: "一号",
      manualRemark: "",
      status: "assigned" as const,
    };
    const facts = createScheduleFrequencyFacts(state, DATE);
    const reasons = reassignmentSafetyReasons({
      kind: "plan",
      state,
      assignments: [assignment],
      changes: [{ assignmentId: assignment.id, staffId: recent.id }],
      primaryAssignmentId: assignment.id,
      date: DATE,
      intent: { kind: "position-frequency-review" },
      frequencyFacts: facts,
    });
    expect(reasons).toContain("调整会扩大 TR121/H02 冷却违反");
    const coverageReasons = reassignmentSafetyReasons({
      kind: "plan",
      state,
      assignments: [assignment],
      changes: [{ assignmentId: assignment.id, staffId: recent.id }],
      primaryAssignmentId: assignment.id,
      date: DATE,
      intent: { kind: "team-leader-concurrent-gap-fill" },
      frequencyFacts: facts,
    });
    expect(coverageReasons).toContain("调整会扩大 TR121/H02 冷却违反");
  });

  it("allows coverage to use a cooling worker when it fills an H02 vacancy", () => {
    const { state, recent } = createTr121H02CooldownScenario();
    const vacancy = {
      id: "h02-vacancy",
      flightId: "tr121",
      flightNo: "TR121",
      positionRuleId: "tr121-h02",
      position: "H02",
      staffId: null,
      staffName: "",
      startTime: "21:30",
      endTime: "23:30",
      workHours: 0,
      fatiguePoints: 10,
      remark: "一号",
      manualRemark: "",
      status: "unfilled" as const,
    };
    const reasons = reassignmentSafetyReasons({
      kind: "plan",
      state,
      assignments: [vacancy],
      changes: [
        {
          assignmentId: vacancy.id,
          staffId: recent.id,
          workHours: 2,
          status: "assigned",
        },
      ],
      primaryAssignmentId: vacancy.id,
      date: DATE,
      intent: { kind: "team-leader-concurrent-gap-fill" },
      frequencyFacts: createScheduleFrequencyFacts(state, DATE),
    });
    expect(reasons).not.toContain("调整会扩大 TR121/H02 冷却违反");
  });
});
