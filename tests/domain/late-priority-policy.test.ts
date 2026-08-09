import { describe, expect, it } from "vitest";

import {
  endsAfterLateShiftThreshold,
  isDeclarationOrDeliveryPosition,
  isLatePriorityPosition,
  LATE_PRIORITY_ALLOWED_DIFFERENCE,
  LATE_PRIORITY_FREQUENCY_ORDER,
  LATE_PRIORITY_KIND_DEFINITIONS,
  latePriorityFrequencyKinds,
  latePriorityKindLabel,
  latePriorityMonthlyLabel,
  normalizeLatePriorityFlightNumber,
  normalizeLatePriorityPositionReference,
} from "../../src/domain/reviews/late-priority-policy";

describe("late priority position policy", () => {
  it("provides one canonical definition for order, labels, keywords and allowed differences", () => {
    expect(LATE_PRIORITY_KIND_DEFINITIONS).toEqual([
      {
        kind: "supervisor",
        label: "督导",
        keyword: "督导",
        allowedDifference: 1,
      },
      {
        kind: "number-one",
        label: "一号",
        keyword: "一号",
        allowedDifference: 1,
      },
      {
        kind: "declaration",
        label: "申报",
        keyword: "申报",
        allowedDifference: 2,
      },
      {
        kind: "delivery",
        label: "送资料",
        keyword: "送资料",
        allowedDifference: 2,
      },
    ]);
    expect(LATE_PRIORITY_FREQUENCY_ORDER).toEqual([
      "supervisor",
      "number-one",
      "declaration",
      "delivery",
    ]);
    expect(LATE_PRIORITY_ALLOWED_DIFFERENCE).toEqual({
      supervisor: 1,
      "number-one": 1,
      declaration: 2,
      delivery: 2,
    });
    expect(latePriorityKindLabel("delivery")).toBe("送资料");
    expect(latePriorityMonthlyLabel("number-one")).toBe("本月跨航班一号");
    expect(
      latePriorityFrequencyKinds({ name: "督导", remark: "申报、送资料" })
    ).toEqual(["supervisor", "declaration", "delivery"]);
  });

  it("normalizes late-priority flight and position references consistently", () => {
    expect(normalizeLatePriorityFlightNumber(" tr 121 ")).toBe("TR121");
    expect(normalizeLatePriorityPositionReference(" h 02 ")).toBe("H02");
  });

  it.each([
    ["21:00", "23:00", false],
    ["21:00", "23:01", true],
    ["21:55", "23:55", true],
    ["22:30", "00:10", true],
    ["20:00", "22:00", false],
    ["00:05", "00:10", true],
  ])(
    "classifies %s-%s against the strict 23:00 boundary",
    (startTime, endTime, expected) => {
      expect(endsAfterLateShiftThreshold({ startTime, endTime }, "23:00")).toBe(
        expected
      );
    }
  );

  it("counts only regular priority positions ending after the boundary", () => {
    expect(
      isLatePriorityPosition(
        { category: "常规", name: "H04", remark: "申报" },
        { startTime: "21:55", endTime: "23:55" },
        "23:00"
      )
    ).toBe(true);
    expect(
      isLatePriorityPosition(
        { category: "常规", name: "H07", remark: "" },
        { startTime: "21:55", endTime: "23:55" },
        "23:00"
      )
    ).toBe(false);
    expect(
      isLatePriorityPosition(
        { category: "行政支援", name: "H04", remark: "申报" },
        { startTime: "21:55", endTime: "23:55" },
        "23:00"
      )
    ).toBe(false);
  });

  it("groups declaration and document delivery by either position name or remark", () => {
    expect(isDeclarationOrDeliveryPosition({ name: "申报", remark: "" })).toBe(
      true
    );
    expect(
      isDeclarationOrDeliveryPosition({ name: "G14", remark: "送资料" })
    ).toBe(true);
    expect(
      isDeclarationOrDeliveryPosition({ name: "H02", remark: "一号" })
    ).toBe(false);
  });
});
