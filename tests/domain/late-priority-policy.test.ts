import { describe, expect, it } from "vitest";

import {
  endsAfterLateShiftThreshold,
  isDeclarationOrDeliveryPosition,
  isLatePriorityPosition,
} from "../../src/domain/reviews/late-priority-policy";

describe("late priority position policy", () => {
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
