import { createDefaultState } from "../../src/defaults";
import {
  createScheduleGenerationFacts,
  type ScheduleGenerationFacts,
} from "../../src/domain/shared/scheduling-facts";
import type { Assignment, Flight, PositionRule, Staff } from "../../src/model";

export function createSchedulingScenario(
  overrides: Partial<ScheduleGenerationFacts> = {}
): ScheduleGenerationFacts {
  return {
    ...createScheduleGenerationFacts(createDefaultState()),
    ...overrides,
  };
}

export interface ReassignmentScenario {
  state: ScheduleGenerationFacts;
  assignedWorker: Staff;
  replacementWorker: Staff;
  flight: Flight;
  rule: PositionRule;
  primary: Assignment;
}

export interface ReassignmentScenarioOptions {
  position?: {
    name: string;
    remark: string;
    fatiguePoints: number;
  };
}

export function createReassignmentScenario(
  options: ReassignmentScenarioOptions = {}
): ReassignmentScenario {
  const position = options.position ?? {
    name: "H01",
    remark: "",
    fatiguePoints: 1,
  };
  const assignedWorker: Staff = {
    id: "assigned-worker",
    name: "原岗位人员",
    staffType: "常规",
    teamLeader: false,
    cxPreflightQualified: false,
    dutyQualified: false,
    standbyQualified: false,
    nightShift: true,
    status: "正常",
    remark: "",
  };
  const replacementWorker: Staff = {
    ...assignedWorker,
    id: "replacement-worker",
    name: "替换人员",
  };
  const flight: Flight = {
    id: "reassignment-flight",
    flightNo: "F100",
    startTime: "08:00",
    endTime: "10:00",
    bookedPassengers: 100,
    positions: [position.name],
    remark: "",
  };
  const rule: PositionRule = {
    id: "reassignment-rule",
    flightNo: flight.flightNo,
    name: position.name,
    category: "常规",
    remark: position.remark,
    qualifiedStaffIds: [assignedWorker.id, replacementWorker.id],
    manual: false,
    fatiguePoints: position.fatiguePoints,
    minPassengers: 0,
    earlyReleaseMinutes: 0,
  };
  const primary: Assignment = {
    id: "primary-assignment",
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule.id,
    position: rule.name,
    staffId: assignedWorker.id,
    staffName: assignedWorker.name,
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: 2,
    fatiguePoints: rule.fatiguePoints,
    remark: position.remark,
    manualRemark: "",
    status: "assigned",
  };
  const state = createSchedulingScenario({
    staff: [assignedWorker, replacementWorker],
    flights: [flight],
    positionRules: [rule],
    history: [],
    assignments: [primary],
  });
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.workloadBalanceEnabled = false;
  return {
    state,
    assignedWorker,
    replacementWorker,
    flight,
    rule,
    primary,
  };
}
