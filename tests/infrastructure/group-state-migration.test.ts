import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { restorePersistedState } from "../../src/infrastructure/state-restoration";

describe("双组工作区状态迁移", () => {
  it("默认状态创建 A/B 两个独立工作区，并只保存一份共享配置", () => {
    const state = createDefaultState();

    expect(state.activeGroupId).toBe("A");
    expect(Object.keys(state.groups).sort()).toEqual(["A", "B"]);
    expect(state.groups.A.staff).toEqual(state.staff);
    expect(state.groups.A.flights).toEqual(state.flights);
    expect(state.groups.B.staff).toEqual([]);
    expect(state.groups.B.flights).toEqual([]);
    expect(state.shared.templates).toEqual(state.templates);
    expect(state.shared.positionRules).toEqual(state.positionRules);
  });

  it("把旧单组状态整体迁移到 A，B 保持空且共享配置不复制", () => {
    const legacy = JSON.parse(JSON.stringify(createDefaultState())) as Record<
      string,
      unknown
    >;
    legacy.version = 5;
    legacy.staff = [
      {
        id: "legacy-a-1",
        name: "A组人员",
        staffType: "常规",
        teamLeader: false,
        cxPreflightQualified: false,
        dutyQualified: false,
        standbyQualified: false,
        nightShift: true,
        status: "正常",
        remark: "",
      },
    ];
    legacy.history = [
      {
        id: "legacy-history-a",
        date: "2026-09-18",
        flightNo: "CX931",
        position: "控制",
        staffId: "legacy-a-1",
        staffName: "A组人员",
        startTime: "17:50",
        endTime: "19:50",
        workHours: 2,
        fatiguePoints: 1,
        remark: "",
      },
    ];

    const migrated = restorePersistedState(legacy, createDefaultState());

    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(6);
    expect(migrated!.activeGroupId).toBe("A");
    expect(migrated!.groups.A.staff.map((item) => item.id)).toEqual([
      "legacy-a-1",
    ]);
    expect(migrated!.groups.A.history.map((item) => item.id)).toEqual([
      "legacy-history-a",
    ]);
    expect(migrated!.groups.B.staff).toEqual([]);
    expect(migrated!.groups.B.history).toEqual([]);
    expect(migrated!.groups.A.staff).not.toBe(migrated!.groups.B.staff);
    expect(migrated!.shared.settings).toEqual(migrated!.settings);
    expect(migrated!.shared.positionRules).toEqual(migrated!.positionRules);
  });

  it("恢复 v6 状态时保留 B 组，不把当前组投影覆盖掉", () => {
    const current = createDefaultState();
    current.groups.B.staff = [
      {
        id: "b-1",
        name: "B组人员",
        staffType: "常规",
        teamLeader: false,
        cxPreflightQualified: false,
        dutyQualified: false,
        standbyQualified: false,
        nightShift: true,
        status: "正常",
        remark: "",
      },
    ];
    current.activeGroupId = "B";
    const restored = restorePersistedState(
      JSON.parse(JSON.stringify(current)),
      createDefaultState()
    );

    expect(restored!.activeGroupId).toBe("B");
    expect(restored!.groups.B.staff.map((item) => item.id)).toEqual(["b-1"]);
    expect(restored!.groups.A.staff.length).toBeGreaterThan(0);
  });
});
