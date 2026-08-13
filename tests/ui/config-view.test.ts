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

  it("shows persisted non-default staff and position selections after remount", async () => {
    const state = createDefaultState();
    const positionRule = state.positionRules[0]!;
    const administrativeStaff = state.staff[0]!;
    const unavailableStaff = state.staff[1]!;
    positionRule.category = "分流";
    positionRule.earlyReleaseMinutes = 60;
    administrativeStaff.staffType = "行政支援";
    unavailableStaff.status = "休假";

    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-config-page", { model: state });
    const rows = [...element.querySelectorAll("tr")];
    const positionRow = rows.find(
      (row) =>
        row.querySelector<HTMLInputElement>('input[aria-label="航班号"]')
          ?.value === positionRule.flightNo &&
        row.querySelector<HTMLInputElement>('input[aria-label="岗位名称"]')
          ?.value === positionRule.name
    );
    const administrativeRow = rows.find(
      (row) =>
        row.querySelector<HTMLInputElement>('input[aria-label="编号"]')
          ?.value === administrativeStaff.id
    );
    const unavailableRow = rows.find(
      (row) =>
        row.querySelector<HTMLInputElement>('input[aria-label="编号"]')
          ?.value === unavailableStaff.id
    );

    expect(
      positionRow?.querySelector<HTMLSelectElement>('select[aria-label="分类"]')
        ?.value
    ).toBe("分流");
    expect(
      administrativeRow?.querySelector<HTMLSelectElement>(
        'select[aria-label="人员类型"]'
      )?.value
    ).toBe("行政支援");
    expect(
      unavailableRow?.querySelector<HTMLSelectElement>(
        'select[aria-label="状态"]'
      )?.value
    ).toBe("休假");
  });
});
