import { describe, expect, it } from "vitest";

import type { Assignment } from "../model";
import { schedulingDecision } from "../schedule-rule-contract";
import {
  appendAssignmentDecision,
  assignmentDecisionMessages,
  assignmentDecisions,
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "./assignment-evidence";

function assignment(): Assignment {
  return {
    id: "assignment",
    flightId: "flight",
    flightNo: "KE166",
    positionRuleId: "rule",
    position: "H04",
    staffId: "staff",
    staffName: "员工",
    startTime: "08:00",
    endTime: "10:00",
    workHours: 2,
    fatiguePoints: 4,
    remark: "",
    manualRemark: "",
    status: "assigned",
  };
}

describe("assignment evidence module", () => {
  it("replaces one rule's evidence without erasing earlier rule decisions", () => {
    const target = assignment();
    appendAssignmentDecision(
      target,
      schedulingDecision("ke166-supervisor", "selected", "特殊锁定成立")
    );
    appendAssignmentDecision(
      target,
      schedulingDecision("position-rotation", "fallback", "旧轮岗结论")
    );
    replaceAssignmentDecisions(target, "position-rotation", [
      schedulingDecision("position-rotation", "selected", "新轮岗结论"),
    ]);
    expect(target.decisionTrace).toEqual([
      expect.objectContaining({
        ruleId: "ke166-supervisor",
        message: "特殊锁定成立",
      }),
      expect.objectContaining({
        ruleId: "position-rotation",
        message: "新轮岗结论",
      }),
    ]);
  });

  it("rebuilds all automatic evidence after a staff change and exposes one collection seam", () => {
    const target = assignment();
    target.systemNotes = ["旧说明"];
    target.decisionTrace = [
      schedulingDecision("position-frequency", "selected", "旧人员结论"),
    ];
    rebuildAutomaticAssignmentEvidence(target, [
      schedulingDecision("next-duty-rest", "selected", "新人员结论"),
    ]);
    expect(target.systemNotes).toBeUndefined();
    expect(
      assignmentDecisions([target], { ruleIds: new Set(["next-duty-rest"]) })
    ).toEqual([expect.objectContaining({ message: "新人员结论" })]);
  });

  it("queries by rule and outcome while deduplicating messages", () => {
    const first = assignment();
    const second = assignment();
    first.decisionTrace = [
      schedulingDecision("position-rotation", "fallback", "无法安全轮岗"),
    ];
    second.decisionTrace = [
      schedulingDecision("position-rotation", "fallback", "无法安全轮岗"),
      schedulingDecision("position-rotation", "selected", "已完成轮岗"),
    ];

    expect(
      assignmentDecisionMessages([first, second], {
        ruleIds: new Set(["position-rotation"]),
        outcomes: new Set(["fallback"]),
      })
    ).toEqual(["无法安全轮岗"]);
  });
});
