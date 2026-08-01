import type { AppState, Flight, PositionRule, Staff } from "../../model";
import { createId } from "../../utils";
import type { ScheduleLedger } from "./schedule-ledger";
import {
  assignmentRule,
  makeUnfilled,
} from "../flights/schedule-position-rules";
import { isKe166MobileSupervisor } from "../flights/schedule-tasks";

export interface PassivePositionContext {
  state: AppState;
  ledger: ScheduleLedger;
  warnings: string[];
  flight: Flight;
  rule: PositionRule;
  displayIndex: ReadonlyMap<string, number>;
}

export function placePassivePosition({
  state,
  ledger,
  warnings,
  flight,
  rule,
  displayIndex,
}: PassivePositionContext): boolean {
  const ke166MobileSupervisor = isKe166MobileSupervisor(flight, rule);
  if (
    rule.category === "行政支援" ||
    (!ke166MobileSupervisor &&
      (rule.minPassengers ?? 0) > flight.bookedPassengers)
  ) {
    ledger.commit({
      type: "append",
      assignments: [
        { ...makeUnfilled(flight, rule.name, rule), status: "manual" },
      ],
    });
    return true;
  }
  if (rule.category === "引导") {
    const assignments = ledger.snapshot();
    const usedReusableStaff = new Set(
      assignments
        .filter(
          (item) =>
            item.flightId === flight.id &&
            assignmentRule(state, item)?.category === rule.category
        )
        .map((item) => item.staffId)
        .filter((staffId): staffId is string => Boolean(staffId))
    );
    const selected = assignments
      .filter(
        (item) =>
          item.flightId === flight.id &&
          item.staffId &&
          item.status === "assigned" &&
          !usedReusableStaff.has(item.staffId)
      )
      .map((item) => ({
        assignment: item,
        sourceRule: assignmentRule(state, item),
        person: state.staff.find((person) => person.id === item.staffId),
      }))
      .filter((item): item is typeof item & { person: Staff } =>
        Boolean(
          item.sourceRule?.category === "常规" &&
          item.person?.status === "正常" &&
          item.person.staffType === "常规"
        )
      )
      .sort(
        (left, right) =>
          (displayIndex.get(right.assignment.positionRuleId ?? "") ?? -1) -
          (displayIndex.get(left.assignment.positionRuleId ?? "") ?? -1)
      )[0]?.person;
    const assignment = selected
      ? {
          id: createId("assignment"),
          flightId: flight.id,
          flightNo: flight.flightNo,
          positionRuleId: rule.id,
          position: rule.name,
          staffId: selected.id,
          staffName: selected.name,
          startTime: flight.startTime,
          endTime: flight.endTime,
          workHours: 0,
          fatiguePoints: 0,
          remark: rule.remark,
          manualRemark: "",
          status: "assigned" as const,
        }
      : {
          ...makeUnfilled(flight, rule.name, rule),
          workHours: 0,
          fatiguePoints: 0,
        };
    ledger.commit({ type: "append", assignments: [assignment] });
    if (!selected)
      warnings.push(
        `${flight.flightNo} / ${rule.name} 没有可复用的常规岗位人员`
      );
    return true;
  }
  if (rule.manual && !ke166MobileSupervisor) {
    ledger.commit({
      type: "append",
      assignments: [makeUnfilled(flight, rule.name, rule)],
    });
    return true;
  }
  return false;
}
