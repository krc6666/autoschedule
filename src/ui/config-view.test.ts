import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { renderConfig } from "./config-view";
import { renderSchedulePolicy } from "./schedule-policy-view";

describe("config view", () => {
  it("keeps scheduling policies out of the base configuration module", () => {
    const html = renderConfig(createDefaultState());
    expect(html).not.toContain("排班规则");
    expect(html).toContain('<details class="workspace-section config-collapsible" data-config-section="staff">');
    expect(html).not.toContain('<details class="workspace-section config-collapsible" data-config-section="staff" open');
    expect(html).toContain("CX航前资质");
    expect(html).toContain('data-field="cxPreflightQualified"');
    expect(html).toContain("值班资质");
    expect(html).toContain('data-field="dutyQualified"');
    expect(html).toContain("分队长");
    expect(html).toContain('data-field="teamLeader"');
    expect(html).toContain('aria-label="是否为分队长"');
    expect(html).toContain(">机动督导</option>");
    expect(html).not.toContain(">督导</option>");
    expect(html).toMatch(/\d+ 人值班资质/);
  });

  it("lists the independent supervisor category", () => {
    const state = createDefaultState();
    state.positionRules[0]!.category = "机动督导";
    const html = renderConfig(state);
    expect(html).toContain("机动督导");
  });

  it("renders scheduling policies in an independent collapsible module", () => {
    const html = renderSchedulePolicy(createDefaultState());
    expect(html).toContain("排班规则");
    expect(html).not.toContain("排班策略");
    expect(html).toContain('id="policy-workload-balance-enabled"');
    expect(html).toContain('id="policy-max-work-hours-difference"');
    expect(html).toContain('id="policy-max-today-fatigue-difference"');
    expect(html).toContain('id="policy-duty-fatigue-points"');
    expect(html).toContain("08:30前早班");
    expect(html).toContain('id="policy-enabled"');
    expect(html).toContain('id="policy-fatigue-threshold"');
    expect(html).toContain('id="policy-recovery-minutes"');
    expect(html).toContain('id="policy-remarked-high-load"');
    expect(html).toContain('id="policy-transition-mode"');
    expect(html).toContain('data-action="save-schedule-policy"');
    expect(html).toContain('data-action="add-transition-policy"');
    expect(html).toContain('data-entity="transition-policy"');
    expect(html).toContain("当前排班规则清单");
    expect(html).toContain("岗位资质硬约束");
    expect(html).toContain("状态变化后立即重新计算当前排班");
    expect(html).toContain("12点前单岗位稀缺优先");
    expect(html).toContain("12点前岗位完整性");
    expect(html).toContain("可突破严格限制并反馈留痕");
    expect(html).toContain('id="policy-rolling-load-enabled"');
    expect(html).toContain('id="policy-rolling-window-minutes"');
    expect(html).toContain('id="policy-rolling-max-fatigue"');
    expect(html).toContain('id="policy-rolling-load-mode"');
    expect(html).toContain('id="policy-rotation-enabled"');
    expect(html).toContain('id="policy-rotation-lookback-days"');
    expect(html).toContain('id="policy-rotation-mode"');
    expect(html).toContain('id="policy-late-shift-recovery-enabled"');
    expect(html).toContain('id="policy-late-shift-start-time"');
    expect(html).toContain('id="policy-late-shift-latest-window"');
    expect(html).toContain('id="policy-next-day-late-max-fatigue"');
    expect(html).toContain('id="policy-late-shift-recovery-mode"');
    expect(html).toContain("滚动负荷上限");
    expect(html).toContain("同岗轮换");
    expect(html).toContain("跨工作日晚班减负");
    expect(html).toContain('<details class="policy-rule-card"');
    expect(html).not.toContain('<details class="policy-rule-card" open');
  });
});
