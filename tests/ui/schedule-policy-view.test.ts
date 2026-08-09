// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { SCHEDULING_RULES } from "../../src/domain/rules/schedule-rule-contract";
import "../../src/ui/components/policy-page";
import { mountElement, settleLit } from "./lit-test-helpers";

describe("rules page", () => {
  it("projects settings, structured rules, and the central rule ledger", async () => {
    const state = createDefaultState();
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-policy-page", { model: state });
    const text = element.textContent ?? "";

    expect(text).toContain("排班规则");
    expect(text).not.toContain("排班策略");
    expect(text).toContain("核心保护与公平参数");
    expect(text).toContain("跨工作日恢复保护");
    expect(text).toContain("普通岗位最小衔接间隔");
    expect(text).toContain("跨工作日资质预留");
    expect(text).not.toContain("下班次值班人员预休");
    expect(text).toContain("机动督导兼任范围");
    expect(text).toContain("规则如何执行");
    expect(text).toContain("必须遵守");
    expect(text).toContain("保护与均衡");
    expect(text).not.toContain("规则启用与优先顺序");
    expect(text).not.toContain("扩展规则文件");
    expect(element.querySelector('input[type="search"]')).not.toBeNull();
    expect(element.querySelector('input[type="file"]')).toBeNull();
    for (const rule of SCHEDULING_RULES) {
      expect(text).toContain(rule.label);
      expect(text).not.toContain(rule.id);
    }
    [
      "Hook",
      "API 1",
      "hard-constraint",
      "candidate-priority",
      "post-schedule",
      "protection",
    ].forEach((internalTerm) => expect(text).not.toContain(internalTerm));
  });

  it("searches actual structured-rule values and hides unrelated rule cards", async () => {
    const state = createDefaultState();
    state.settings.crossWorkdayQualificationReservations = [
      {
        id: "search-reservation",
        enabled: true,
        flightNo: "CX931",
        matchField: "position",
        keyword: "控制",
        minimumStaffCount: 1,
      },
    ];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-policy-page", { model: state });
    const search = element.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )!;

    search.value = "CX931";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settleLit();

    const text = element.textContent ?? "";
    expect(text).toContain("跨工作日资质预留");
    const visibleValues = [
      ...element.querySelectorAll<HTMLInputElement>(
        "autoschedule-policy-structured-rules input"
      ),
    ].map((input) => input.value);
    expect(visibleValues).toContain("CX931");
    expect(visibleValues).toContain("控制");
    expect(text).not.toContain("值班任务规则");
    expect(text).not.toContain("规则如何执行");
    expect(
      element.querySelector<HTMLDetailsElement>(".policy-rule-card")?.open
    ).toBe(true);
  });

  it("searches field labels and central rule descriptions across the whole page", async () => {
    const state = createDefaultState();
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-policy-page", { model: state });
    const search = element.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )!;

    search.value = "最大工时差";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settleLit();
    expect(element.textContent).toContain("核心保护与公平参数");
    expect(element.textContent).not.toContain("值班任务规则");

    search.value = "历史疲劳";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await settleLit();
    expect(element.textContent).toContain("规则如何执行");
    expect(element.textContent).toContain("历史疲劳");
    expect(element.textContent).not.toContain("核心保护与公平参数");
    expect(element.textContent).not.toContain("岗位衔接间隔规则");
  });
});
