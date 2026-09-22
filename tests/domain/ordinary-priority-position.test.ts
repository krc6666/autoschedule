import { describe, expect, it } from "vitest";

import {
  isOrdinaryPriorityPosition,
  ordinaryPriorityPositionKey,
  normalizeOrdinaryPriorityPositions,
} from "../../src/domain/reviews/position-rotation-policy";

describe("普通重点岗位集合", () => {
  it("只按集合项判断，不再因五类关键词自动命中", () => {
    const rule = {
      category: "常规" as const,
      name: "柜台 A",
      remark: "一号",
      flightNo: "CA123",
    };
    const configured = normalizeOrdinaryPriorityPositions([
      { airlineCode: "CA", position: "柜台 A" },
    ]);

    expect(isOrdinaryPriorityPosition(rule, configured)).toBe(true);
    expect(
      isOrdinaryPriorityPosition(rule, [
        { airlineCode: "MU", position: "柜台 A" },
      ])
    ).toBe(false);
    expect(
      isOrdinaryPriorityPosition({ ...rule, remark: "一号" }, [
        { airlineCode: "CA", position: "柜台 B" },
      ])
    ).toBe(false);
  });

  it("按航司和规范岗位跨航班共享集合项并去重", () => {
    expect(ordinaryPriorityPositionKey("CA123", "柜台 A", "")).toBe(
      ordinaryPriorityPositionKey("CA456", "柜台 A", "")
    );
    expect(
      normalizeOrdinaryPriorityPositions([
        { airlineCode: " ca ", position: " 柜台 A " },
        { airlineCode: "CA", position: "柜台 A" },
      ])
    ).toEqual([{ airlineCode: "CA", position: "柜台 A" }]);
  });
});
