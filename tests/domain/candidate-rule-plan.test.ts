import { describe, expect, it } from "vitest";

import { createDefaultScheduleSettings } from "../../src/domain/rules/schedule-settings";
import {
  compareCandidateRulePlan,
  createCandidateRulePlan,
} from "../../src/domain/rules/candidate-rule-plan";
import type { CandidatePriority } from "../../src/domain/candidates/candidate-priority";
import type { AssignmentTask } from "../../src/domain/flights/schedule-tasks";
import type { PluginManifest } from "../../src/infrastructure/plugin-protocol";
import type { Staff } from "../../src/model";
import { createDefaultState } from "../../src/defaults";
import { generateSchedule } from "../helpers/generate-schedule";

const profile = {} as CandidatePriority;
const task = {
  flight: { flightNo: "F100" },
  rule: { name: "G01", remark: "一号" },
} as AssignmentTask;
const first = { id: "1" } as Staff;
const second = { id: "2" } as Staff;
const plugin: PluginManifest = {
  apiVersion: 1,
  id: "example.preference",
  name: "示例偏好",
  rules: [
    {
      id: "prefer-second",
      label: "优先二号人员",
      stage: "protection",
      enabled: true,
      match: { flightNo: "F100", positionKeyword: "G01" },
      preferredStaffIds: ["2"],
    },
  ],
};

describe("candidate rule plan", () => {
  it("injects an enabled plugin rule into the typed candidate plan", () => {
    const plan = createCandidateRulePlan(createDefaultScheduleSettings(), [
      plugin,
    ]);
    const pluginRule = plan.find((rule) => rule.source !== "built-in")!;

    expect(pluginRule).toMatchObject({
      id: "plugin:example.preference:prefer-second",
      label: "优先二号人员",
      source: "plugin:example.preference",
    });
    expect(
      compareCandidateRulePlan(
        [pluginRule],
        task,
        first,
        profile,
        second,
        profile
      )
    ).toBeGreaterThan(0);
  });

  it("does not execute disabled or non-matching plugin rules", () => {
    const disabled = structuredClone(plugin);
    disabled.rules[0]!.enabled = false;
    expect(
      createCandidateRulePlan(createDefaultScheduleSettings(), [disabled])
        .map((rule) => rule.id)
        .some((id) => id.startsWith("plugin:"))
    ).toBe(false);

    const plan = createCandidateRulePlan(createDefaultScheduleSettings(), [
      plugin,
    ]);
    expect(
      compareCandidateRulePlan(
        plan.filter((rule) => rule.source !== "built-in"),
        { ...task, flight: { ...task.flight, flightNo: "OTHER" } },
        first,
        profile,
        second,
        profile
      )
    ).toBe(0);
  });

  it("changes a real schedule only through the injected candidate hook", async () => {
    const state = createDefaultState();
    state.staff = state.staff.slice(0, 2).map((person) => ({
      ...person,
      dutyQualified: false,
      status: "正常",
    }));
    state.flights = [
      {
        id: "flight",
        flightNo: "F100",
        startTime: "13:00",
        endTime: "14:00",
        bookedPassengers: 10,
        positions: ["G01"],
        remark: "",
      },
    ];
    state.positionRules = [
      {
        id: "position",
        flightNo: "F100",
        name: "G01",
        category: "常规",
        remark: "",
        qualifiedStaffIds: state.staff.map((person) => person.id),
        manual: false,
        fatiguePoints: 1,
        minPassengers: 0,
        earlyReleaseMinutes: 0,
      },
    ];

    expect(
      (await generateSchedule(state, "2026-08-01")).assignments[0]?.staffId
    ).toBe("1");
    expect(
      (await generateSchedule(state, "2026-08-01", { plugins: [plugin] }))
        .assignments[0]?.staffId
    ).toBe("2");
  });
});
