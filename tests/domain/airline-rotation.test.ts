import { describe, expect, it } from "vitest";

import {
  airlineCode,
  normalizedRotationPosition,
  positionRotationGroupKey,
  sameAirlinePriorityConflict,
} from "../../src/domain/rules/airline-rotation";

function priorityRule(flightNo: string, remark: "控制" | "一号") {
  return { flightNo, category: "常规" as const, name: "G99", remark };
}

describe("airline rotation facts", () => {
  it("normalizes carrier codes once", () => {
    expect(airlineCode(" cx 937 ")).toBe("CX");
    expect(airlineCode("FD202")).toBe("FD");
    expect(airlineCode("3U8633")).toBe("3U");
  });

  it("uses semantic remarks before physical counter names", () => {
    expect(normalizedRotationPosition("G08", "申报")).toBe("申报");
    expect(normalizedRotationPosition("G17", "申报")).toBe("申报");
    expect(normalizedRotationPosition("一号", "申报")).toBe("申报");
    expect(positionRotationGroupKey("FD101", "G08", "申报")).toBe(
      positionRotationGroupKey("FD202", "G17", "申报")
    );
    expect(positionRotationGroupKey("FD101", "G08", "申报")).not.toBe(
      positionRotationGroupKey("FD202", "G17", "送资料")
    );
    expect(positionRotationGroupKey("FD101", "G08", "申报")).not.toBe(
      positionRotationGroupKey("CX202", "G17", "申报")
    );
  });

  it("does not treat an explicitly declared reporting position as control or number one", () => {
    expect(
      sameAirlinePriorityConflict(
        { flightNo: "FD101", category: "常规", name: "G20", remark: "申报" },
        priorityRule("FD202", "一号")
      )
    ).toBe(false);
  });

  it.each([
    ["控制", "控制"],
    ["控制", "一号"],
    ["一号", "控制"],
    ["一号", "一号"],
  ] as const)(
    "treats same-airline %s and %s as a hard conflict",
    (left, right) => {
      expect(
        sameAirlinePriorityConflict(
          priorityRule("FD101", left),
          priorityRule("FD202", right)
        )
      ).toBe(true);
      expect(
        sameAirlinePriorityConflict(
          priorityRule("FD101", left),
          priorityRule("CX202", right)
        )
      ).toBe(false);
    }
  );
});
