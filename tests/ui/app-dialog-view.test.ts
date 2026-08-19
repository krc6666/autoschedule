// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { analyzeManualSwap } from "../../src/domain/reviews/manual-swap-analysis";
import "../../src/ui/components/app-dialog";
import { mountElement } from "./lit-test-helpers";

describe("application dialog", () => {
  it("counts every structured rule collection in configuration import preview", async () => {
    const model = createDefaultState();
    model.settings.crossFlightPriorityPolicies = [
      {
        id: "preview-priority",
        enabled: true,
        flightNo: "KE166",
        positions: ["督导"],
      },
    ];
    const expectedCount =
      model.settings.positionTransitionPolicies.length +
      model.settings.dutyPositionPriorities.length +
      model.settings.nextWorkdayRecoveryTargets.length +
      model.settings.lateShiftRecoveryPositionRules.length +
      model.settings.mobileSupervisorCoverageRules.length +
      model.settings.crossWorkdayQualificationReservations.length +
      model.settings.crossFlightPriorityPolicies.length;
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-dialog", {
      model,
      dialog: {
        kind: "workbook-import",
        mode: "config",
        importedState: model,
        recognized: "规则配置",
        warnings: [],
      },
    });

    expect(element.textContent).toContain("结构化规则");
    expect(element.textContent).toContain(`${expectedCount} 条`);
  });

  it("gives legacy schedule import content a constrained scrolling host", async () => {
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-dialog", {
      model: createDefaultState(),
      dialog: {
        kind: "legacy-schedule-import",
        date: "2026-08-19",
        preview: {
          records: [],
          sheets: 1,
          recognizedSheets: 1,
          readyRecords: 0,
          reviewRecords: 0,
          warnings: [],
        },
      },
    });

    expect(
      element
        .querySelector("autoschedule-legacy-schedule-import-dialog")
        ?.classList.contains("modal-content-stack")
    ).toBe(true);
    expect(
      element.querySelector<HTMLInputElement>("#legacy-import-date")?.value
    ).toBe("2026-08-19");
  });

  it("gives online flight query content a constrained scrolling host", async () => {
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-dialog", {
      model: createDefaultState(),
      dialog: {
        kind: "flight-query",
        date: "2026-08-05",
        loading: false,
        reconciliation: null,
        fetchedAt: "",
        error: "",
      },
    });

    expect(
      element
        .querySelector("autoschedule-flight-query-dialog")
        ?.classList.contains("modal-content-stack")
    ).toBe(true);
  });

  it("shows a compact swap analysis and only enables a valid confirmation", async () => {
    const model = createDefaultState();
    const flight = model.flights.find((item) => item.flightNo === "TR121")!;
    const rules = model.positionRules.filter(
      (item) =>
        item.flightNo === flight.flightNo && ["H02", "H08"].includes(item.name)
    );
    rules.forEach((rule) => {
      rule.qualifiedStaffIds = [model.staff[0]!.id, model.staff[1]!.id];
    });
    model.settings.rollingLoadProtectionEnabled = false;
    model.assignments = rules.map((rule, index) => ({
      id: `swap-${index}`,
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: model.staff[index]!.id,
      staffName: model.staff[index]!.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      workHours: 2,
      fatiguePoints: rule.fatiguePoints,
      remark: rule.remark,
      manualRemark: "",
      status: "assigned" as const,
    }));
    const analysis = analyzeManualSwap(model, "2026-08-21", "swap-0", "swap-1");
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-dialog", {
      model,
      dialog: {
        kind: "swap-analysis",
        sourceAssignmentId: "swap-0",
        targetAssignmentId: "swap-1",
        analysis,
      },
    });

    expect(element.textContent).toContain("调整原因分析");
    expect(element.textContent).toContain("选择交换人员");
    expect(element.textContent).toContain("可以安全调整");
    expect(
      element.querySelector<HTMLButtonElement>(
        'button[aria-label="确认交换岗位"]'
      )?.disabled
    ).toBe(false);
  });
});
