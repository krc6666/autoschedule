import { describe, expect, it } from "vitest";

import {
  assignmentWarningMessage,
  conciseAssignmentWarningReason,
} from "../../src/domain/reviews/schedule-warning-message";
import { dailyScheduleFailureMessage } from "../../src/domain/solver/solver-user-message";

const TECHNICAL_TERMS =
  /infeasible|changed-assignment-count|双向岗位资质|完整重排方案/;

describe("user-facing schedule warnings", () => {
  it("turns solver diagnostics into one plain business reason", () => {
    expect(
      conciseAssignmentWarningReason([
        "求解目标 changed-assignment-count 结束状态：infeasible",
        "没有具备双向岗位资质的完整重排方案",
      ])
    ).toBe("其他人员资质不匹配");
  });

  it("uses the person-fact-reason-decision-result order in at most two sentences", () => {
    const message = assignmentWarningMessage({
      staffName: "测试人员",
      fact: "已连续2次承担TEST100/G20",
      reasons: [
        "求解目标 changed-assignment-count 结束状态：infeasible",
        "没有具备双向岗位资质的完整重排方案",
      ],
      result: "保留原安排，当前连续第3次",
    });

    expect(message).toBe(
      "测试人员 已连续2次承担TEST100/G20，本次尝试换人但无替代人选（其他人员资质不匹配）。岗位完整性优先，保留原安排，当前连续第3次。"
    );
    expect(message).not.toMatch(TECHNICAL_TERMS);
    expect((message.match(/[。！？]/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("does not expose solver terms in a failed daily schedule message", () => {
    const message = dailyScheduleFailureMessage("infeasible");

    expect(message).toContain(
      "请检查人员状态、岗位资质、夜班能力、时间冲突和工时上限"
    );
    expect(message).not.toMatch(TECHNICAL_TERMS);
  });

  it("reports the confirmed 150-second daily schedule limit", () => {
    expect(dailyScheduleFailureMessage("timed-out")).toBe(
      "当天排班计算超过150秒，请重试"
    );
  });
});
