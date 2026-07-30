import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { SCHEDULING_RULES } from "../schedule-rule-contract";
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
    expect(html).toContain("12点前上午航班");
    expect(html).toContain("2至5人最短闭环或开放式连续腾挪");
    expect(html).toContain("先彻底退出晚班");
    expect(html).toContain("疲劳点严格下降");
    expect(html).toContain("参与人数最少");
    expect(html).toContain("下个工作班值班人员不能换入");
    expect(html).toContain('id="policy-next-duty-rest-enabled"');
    expect(html).toContain("下班次值班人员预休");
    expect(html).toContain("KE166先完成柜台安排与重点岗位轮换");
    expect(html).toContain("只有没有独立人选、否则会出现岗位空缺时");
    expect(html).toContain("常规岗位空缺下沉");
    expect(html).toContain('id="policy-team-leader-concurrent-overlap"');
    expect(html).toContain("分队长并行督导补缺");
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
    expect(html).not.toContain("仅作为督导岗位兜底");
    SCHEDULING_RULES.forEach((rule) => {
      expect(html).toContain(rule.id);
      expect(html).toContain(rule.label);
    });
    expect(html).toContain("至少 4 个航班");
    expect(html).toContain("90%");
    expect(html).toContain("75%");
    expect(html).not.toContain('id="policy-transition-mode"');
    expect(html).not.toContain('id="policy-rolling-load-mode"');
    expect(html).not.toContain('id="policy-late-shift-recovery-mode"');
    expect(html).not.toContain("强保护");
    expect(html).toContain("优先避开，无安全替代时保证岗位完整");
    expect(html).toContain('data-action="add-late-shift-recovery-position"');
    expect(html).toContain('data-entity="late-shift-recovery-position"');
    expect(html).toContain("末班重点岗位");
    expect(html).toContain('data-field="nextWorkdayCutoffTime"');
    expect(html).toContain("次班截止时间");
    expect(html).toContain("保存规则");
    expect(html).toContain("late-shift-cutoff");
    expect(html).not.toContain('id="policy-next-day-late-max-fatigue"');
    expect(html).not.toContain("疲劳点最高");
    expect(html).not.toContain("晚班疲劳上限");
  });
});
