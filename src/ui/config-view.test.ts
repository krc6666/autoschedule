import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { renderConfig } from "./config-view";
import { renderSchedulePolicy } from "./schedule-policy-view";

describe("config view", () => {
  it("keeps scheduling policies out of the base configuration module", () => {
    const html = renderConfig(createDefaultState());
    expect(html).not.toContain("排班策略");
    expect(html).toContain('<details class="workspace-section config-collapsible" data-config-section="staff">');
    expect(html).not.toContain('<details class="workspace-section config-collapsible" data-config-section="staff" open');
    expect(html).toContain("CX航前资质");
    expect(html).toContain('data-field="cxPreflightQualified"');
    expect(html).toContain("值班资质");
    expect(html).toContain('data-field="dutyQualified"');
  });

  it("renders scheduling policies in an independent collapsible module", () => {
    const html = renderSchedulePolicy(createDefaultState());
    expect(html).toContain("排班策略");
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
    expect(html).toContain("稀缺岗位优先");
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
