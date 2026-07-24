import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { renderSchedulePolicy } from "./schedule-policy-view";

describe("schedule policy view", () => {
  it("presents the module as rules and exposes duty fatigue and workload balance settings", () => {
    const state = createDefaultState();
    const html = renderSchedulePolicy(state);

    expect(html).toContain("排班规则");
    expect(html).not.toContain("排班策略");
    expect(html).toContain('id="policy-duty-fatigue-points"');
    expect(html).toContain(`value="${state.settings.dutyFatiguePoints}"`);
    expect(html).toContain('id="policy-max-work-hours-difference"');
    expect(html).toContain('id="policy-max-today-fatigue-difference"');
    expect(html).toContain("08:30前早班");
    expect(html).toContain("KE166明确配置机动督导时");
    expect(html).toContain("常规岗位空缺下沉");
    expect(html).toContain('id="policy-rule-search"');
    expect(html).toContain('data-action="add-duty-priority"');
    expect(html).toContain("TR121");
    expect(html).toContain("TW616");
    expect(html).toContain('id="policy-early-departure-cutoff"');
    expect(html).toContain("值班、备勤均照常统计");
    expect(html).toContain("机动督导兼任范围");
    expect(html).toContain('data-action="add-supervisor-coverage"');
    expect(html).toContain('data-entity="supervisor-coverage"');
    expect(html).toContain("岗位备注包含“一号、申报、排查”");
    expect(html).toContain("分队长督导补缺");
    expect(html).toContain("仅作为督导岗位兜底");
  });
});
