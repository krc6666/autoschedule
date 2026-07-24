import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { evaluateMobileSupervisorCoverage } from "./mobile-supervisor-coverage";

describe("mobile supervisor coverage rules", () => {
  it("forbids the default remarked positions", () => {
    const state = createDefaultState();

    expect(evaluateMobileSupervisorCoverage(state, { flightNo: "KE166", position: "H02", remark: "一号" })).toMatchObject({ allowed: false });
    expect(evaluateMobileSupervisorCoverage(state, { flightNo: "KE166", position: "H04", remark: "申报" })).toMatchObject({ allowed: false });
    expect(evaluateMobileSupervisorCoverage(state, { flightNo: "KE166", position: "H05", remark: "排查" })).toMatchObject({ allowed: false });
    expect(evaluateMobileSupervisorCoverage(state, { flightNo: "KE166", position: "H06", remark: "" })).toEqual({ allowed: true, reason: null, rule: null });
  });

  it("uses allow rules as a whitelist while keeping forbid rules stronger", () => {
    const state = createDefaultState();
    state.settings.mobileSupervisorCoverageRules.push(
      { id: "allow-h", enabled: true, flightNo: "KE166", matchField: "position", keyword: "H06", mode: "allow" },
      { id: "forbid-h06", enabled: true, flightNo: "KE166", matchField: "position", keyword: "H06", mode: "forbid" }
    );

    expect(evaluateMobileSupervisorCoverage(state, { flightNo: "KE166", position: "H05", remark: "" }).reason).toContain("不在当前航班的允许兼任范围");
    expect(evaluateMobileSupervisorCoverage(state, { flightNo: "KE166", position: "H06", remark: "" }).reason).toContain("命中禁止规则");
    expect(evaluateMobileSupervisorCoverage(state, { flightNo: "CX937", position: "G15", remark: "" }).allowed).toBe(true);
  });
});
