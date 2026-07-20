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
  });
});
