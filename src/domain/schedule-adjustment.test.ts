import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import type { AppState, Assignment } from "../model";
import { moveSupervisorWithinFlight, normalizeSupervisorAssignments } from "./schedule-adjustment";

function stateWithSupervisor(): AppState {
  const state = createDefaultState();
  const [supervisor, counterWorker] = state.staff;
  state.staff = [supervisor!, counterWorker!];
  state.flights = [{ id: "f1", flightNo: "F1", startTime: "08:00", endTime: "10:00", bookedPassengers: 100, positions: [], remark: "" }];
  const base = state.positionRules[0]!;
  state.positionRules = [
    { ...base, id: "supervisor", flightNo: "F1", name: "督导", category: "机动督导", qualifiedStaffIds: [supervisor!.id], fatiguePoints: 5 },
    { ...base, id: "h04", flightNo: "F1", name: "H04", category: "常规", qualifiedStaffIds: [], fatiguePoints: 7 },
    { ...base, id: "h03", flightNo: "F1", name: "H03", category: "常规", qualifiedStaffIds: [counterWorker!.id], fatiguePoints: 6 }
  ];
  const assignment = (id: string, ruleId: string, position: string, staffId: string | null, status: Assignment["status"]): Assignment => ({
    id, flightId: "f1", flightNo: "F1", positionRuleId: ruleId, position, staffId,
    staffName: staffId ? state.staff.find((person) => person.id === staffId)!.name : "",
    startTime: "08:00", endTime: "10:00", workHours: 2, fatiguePoints: 2, remark: "", manualRemark: "", status
  });
  state.assignments = [
    assignment("supervisor-assignment", "supervisor", "督导", supervisor!.id, "assigned"),
    assignment("h04-assignment", "h04", "H04", null, "unfilled"),
    assignment("h03-assignment", "h03", "H03", counterWorker!.id, "assigned")
  ];
  return state;
}

describe("督导同航班机动补位", () => {
  it("保留顶部督导并允许补到无资质的空柜台", () => {
    const state = stateWithSupervisor();

    expect(moveSupervisorWithinFlight(state, "supervisor-assignment", "h04-assignment")).toBeNull();

    expect(state.assignments.find((item) => item.id === "supervisor-assignment")).toMatchObject({ status: "assigned", workHours: 2 });
    expect(state.assignments.find((item) => item.id === "h04-assignment")).toMatchObject({
      staffId: state.staff[0]!.id, status: "assigned", workHours: 0, fatiguePoints: 7,
      supervisorSourceAssignmentId: "supervisor-assignment"
    });
  });

  it("移动关联柜台时保持顶部督导并清空原柜台", () => {
    const state = stateWithSupervisor();
    moveSupervisorWithinFlight(state, "supervisor-assignment", "h04-assignment");
    state.assignments.find((item) => item.id === "h03-assignment")!.staffId = null;
    state.assignments.find((item) => item.id === "h03-assignment")!.staffName = "";
    state.assignments.find((item) => item.id === "h03-assignment")!.status = "unfilled";

    expect(moveSupervisorWithinFlight(state, "h04-assignment", "h03-assignment")).toBeNull();
    expect(state.assignments.find((item) => item.id === "h04-assignment")).toMatchObject({ staffId: null, status: "unfilled" });
    expect(state.assignments.find((item) => item.id === "h03-assignment")).toMatchObject({ supervisorSourceAssignmentId: "supervisor-assignment", workHours: 0 });
  });

  it("拒绝跨航班、顶部目标和已有人员的目标", () => {
    const state = stateWithSupervisor();

    expect(moveSupervisorWithinFlight(state, "supervisor-assignment", "h03-assignment")).toContain("已有人员");
    expect(moveSupervisorWithinFlight(state, "h03-assignment", "supervisor-assignment")).toContain("仅督导");
  });

  it("顶部督导变更时同步所有关联柜台", () => {
    const state = stateWithSupervisor();
    moveSupervisorWithinFlight(state, "supervisor-assignment", "h04-assignment");
    const supervisor = state.assignments.find((item) => item.id === "supervisor-assignment")!;
    supervisor.staffId = state.staff[1]!.id;
    supervisor.staffName = state.staff[1]!.name;

    normalizeSupervisorAssignments(state);

    expect(state.assignments.find((item) => item.id === "h04-assignment")).toMatchObject({ staffId: state.staff[1]!.id, staffName: state.staff[1]!.name });
  });

  it("拒绝兼任规则禁止的备注岗位并清理旧违规关联", () => {
    const state = stateWithSupervisor();
    const target = state.assignments.find((item) => item.id === "h04-assignment")!;
    target.remark = "一号";

    expect(moveSupervisorWithinFlight(state, "supervisor-assignment", "h04-assignment")).toContain("机动督导不能兼任 F1/H04");

    target.staffId = state.staff[0]!.id;
    target.staffName = state.staff[0]!.name;
    target.status = "assigned";
    target.workHours = 0;
    target.supervisorSourceAssignmentId = "supervisor-assignment";
    normalizeSupervisorAssignments(state);
    expect(target).toMatchObject({ staffId: null, staffName: "", status: "unfilled" });
    expect(target.supervisorSourceAssignmentId).toBeUndefined();
  });
});
