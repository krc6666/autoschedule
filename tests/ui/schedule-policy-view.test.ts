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
    expect(text).toContain("跨工作日恢复目标强度");
    expect(text).toContain("优先避开");
    expect(text).toContain("严格限制");
    expect(
      element.querySelector(
        "autoschedule-policy-structured-rules [data-policy-recovery-mode]"
      )
    ).not.toBeNull();
    expect(
      element.querySelector(
        "autoschedule-policy-settings [data-policy-recovery-mode]"
      )
    ).toBeNull();
    expect(text).toContain("普通岗位最小衔接间隔");
    expect(text).toContain("每日工时上限");
    expect(
      element.querySelector<HTMLInputElement>(
        'input[data-policy-setting="maxDailyHours"]'
      )?.value
    ).toBe(String(state.settings.maxDailyHours));
    expect(text).toContain("跨工作日资质预留");
    expect(text).not.toContain("下班次值班人员预休");
    expect(text).toContain("机动督导兼任范围");
    expect(text).toContain("规则如何执行");
    expect(text).toContain("必须遵守");
    expect(text).toContain("保护与均衡");
    expect(text).toContain(
      "若整体缺员使晚班不可避免，则保留晚班并优先安全撤掉其截止前岗位"
    );
    expect(text).toContain(
      "晚班不可避免时，在不制造岗位空缺的前提下优先安全撤掉其截止前岗位"
    );
    expect(text).toContain("多人冲突时先保护截止更早的人");
    expect(text).not.toContain("后续晚班只有少数人能做时");
    expect(text).not.toContain("早班重点岗位");
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

  it("emits the selected recovery mode from the recovery module", async () => {
    const state = createDefaultState();
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-policy-page", { model: state });
    const structuredRules = element.querySelector(
      "autoschedule-policy-structured-rules"
    )!;
    const select = structuredRules.querySelector<HTMLSelectElement>(
      "[data-policy-recovery-mode] select"
    )!;
    let emitted: CustomEvent | undefined;
    structuredRules.addEventListener("autoschedule-command", (event) => {
      emitted = event as CustomEvent;
    });

    select.value = "forbid";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(emitted?.detail.type).toBe("apply-policy");
    expect(emitted?.detail.input.nextWorkdayRecoveryMode).toBe("forbid");
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

  it("shows persisted non-default structured-rule selections after remount", async () => {
    const state = createDefaultState();
    const transition = state.settings.positionTransitionPolicies[0]!;
    transition.mode = "forbid";
    const reservation = {
      id: "non-default-reservation",
      enabled: true,
      flightNo: "TEST931",
      matchField: "remark" as const,
      keyword: "控制",
      minimumStaffCount: 1,
    };
    state.settings.crossWorkdayQualificationReservations = [reservation];
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-policy-page", { model: state });
    const transitionSelect = element.querySelector<HTMLSelectElement>(
      ".transition-policy-grid select"
    );
    const reservationRow = [
      ...element.querySelectorAll<HTMLElement>(".supervisor-coverage-row"),
    ].find((row) =>
      [...row.querySelectorAll<HTMLInputElement>('input[type="text"]')].some(
        (input) => input.value === reservation.flightNo
      )
    );

    expect(transitionSelect?.value).toBe("forbid");
    expect(reservationRow?.querySelector("select")?.value).toBe("remark");
  });
});
