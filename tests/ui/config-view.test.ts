// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import "../../src/ui/components/config-page";
import { mountElement } from "./lit-test-helpers";

describe("configuration page", () => {
  it("keeps people, position rules, templates, and constraints separated", async () => {
    const state = createDefaultState();
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-config-page", { model: state });
    const text = element.textContent ?? "";

    expect(text).toContain("人员信息");
    expect(text).toContain("岗位规则");
    expect(text).toContain("排班约束");
    expect(text).toContain("航班计划模板");
    expect(text).not.toContain("排班规则");
    expect(
      element.querySelector(".config-collapsible")?.hasAttribute("open")
    ).toBe(false);
    ["是否为分队长", "CX航前资质", "值班资质", "备勤资质", "可上夜班"].forEach(
      (label) =>
        expect(element.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
    );
    expect(text).toContain("机动督导");
    expect(text).not.toContain(">督导<");
  });
});
