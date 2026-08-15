import { describe, expect, it } from "vitest";
import { createDefaultState } from "../../src/defaults";
import type { Assignment, PositionRule } from "../../src/model";
import { applyConfiguredEarlyReleases } from "../../src/domain/assignments/assignment-timing";

function makeAssignment(
  id: string,
  flightId: string,
  flightNo: string,
  rule: PositionRule,
  staffId: string,
  startTime: string,
  endTime: string
): Assignment {
  return {
    id,
    flightId,
    flightNo,
    positionRuleId: rule.id,
    position: rule.name,
    staffId,
    staffName: staffId,
    startTime,
    endTime,
    workHours: 2,
    fatiguePoints: rule.fatiguePoints,
    remark: rule.remark,
    manualRemark: "",
    status: "assigned",
  };
}

function diversionScenario(earlyReleaseMinutes: number) {
  const state = createDefaultState();
  const sourceFlight = {
    ...state.flights[0]!,
    id: "source-flight",
    flightNo: "SOURCE",
    startTime: "21:05",
    endTime: "23:05",
  };
  const targetFlight = {
    ...state.flights[0]!,
    id: "target-flight",
    flightNo: "TARGET",
    startTime: "21:55",
    endTime: "23:55",
  };
  const sourceRule: PositionRule = {
    ...state.positionRules[0]!,
    id: "source-rule",
    flightNo: sourceFlight.flightNo,
    name: "G09",
    category: "分流",
    earlyReleaseMinutes,
    qualifiedStaffIds: ["worker"],
  };
  const targetRule: PositionRule = {
    ...sourceRule,
    id: "target-rule",
    flightNo: targetFlight.flightNo,
    name: "H02",
    category: "常规",
    earlyReleaseMinutes: 0,
  };
  const source = makeAssignment(
    "source-assignment",
    sourceFlight.id,
    sourceFlight.flightNo,
    sourceRule,
    "worker",
    sourceFlight.startTime,
    "22:10"
  );
  const target = makeAssignment(
    "target-assignment",
    targetFlight.id,
    targetFlight.flightNo,
    targetRule,
    "worker",
    targetFlight.startTime,
    targetFlight.endTime
  );
  state.flights = [sourceFlight, targetFlight];
  state.positionRules = [sourceRule, targetRule];
  return { state, source, target };
}

describe("configured diversion timing projection", () => {
  it("rejects a transfer when the original source interval exceeds the configured release", () => {
    const { state, source, target } = diversionScenario(60);

    applyConfiguredEarlyReleases([source, target], state);

    expect(source.endTime).toBe("22:10");
    expect(source.workHours).toBe(2);
  });

  it("recomputes a valid transfer from the original source interval", () => {
    const { state, source, target } = diversionScenario(75);

    applyConfiguredEarlyReleases([source, target], state);

    expect(source.endTime).toBe("21:55");
    expect(source.workHours).toBe(0.83);
  });
});
