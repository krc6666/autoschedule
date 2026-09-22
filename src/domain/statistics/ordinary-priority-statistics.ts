import type { HistoryRecord, Staff } from "../../model";
import { assignmentRule } from "../flights/schedule-position-rules";
import { ordinaryPriorityPositionKey } from "../reviews/position-rotation-policy";
import type { SchedulingFacts } from "../shared/scheduling-facts";

export interface OrdinaryPriorityStatisticsRow {
  staff: Staff;
  airlineCode: string;
  position: string;
  actualCount: number;
  manualCorrection: number;
  effectiveCount: number;
}

export function buildOrdinaryPriorityStatistics(
  state: SchedulingFacts,
  date: string
): OrdinaryPriorityStatisticsRow[] {
  const month = date.slice(0, 7);
  const rows: OrdinaryPriorityStatisticsRow[] = [];
  for (const item of state.settings.ordinaryPriorityPositions) {
    for (const staff of state.staff.filter(
      (person) => person.staffType === "常规" && person.status === "正常"
    )) {
      const actual =
        state.history.filter(
          (record: HistoryRecord) =>
            record.staffId === staff.id &&
            record.date.startsWith(month) &&
            ordinaryPriorityPositionKey(
              record.flightNo,
              record.position,
              record.remark
            ) ===
              ordinaryPriorityPositionKey(
                `${item.airlineCode}0`,
                item.position,
                ""
              )
        ).length +
        state.assignments.filter((assignment) => {
          const rule = assignmentRule(state, assignment);
          return (
            state.activeScheduleDate === date &&
            assignment.status === "assigned" &&
            assignment.staffId === staff.id &&
            rule &&
            ordinaryPriorityPositionKey(
              assignment.flightNo,
              assignment.position,
              assignment.remark
            ) ===
              ordinaryPriorityPositionKey(
                `${item.airlineCode}0`,
                item.position,
                ""
              )
          );
        }).length;
      const manualCorrection = (
        state.ordinaryPriorityFrequencyAdjustments ?? []
      )
        .filter(
          (adjustment) =>
            adjustment.month === month &&
            adjustment.staffId === staff.id &&
            ordinaryPriorityPositionKey(
              `${adjustment.airlineCode}0`,
              adjustment.position,
              ""
            ) ===
              ordinaryPriorityPositionKey(
                `${item.airlineCode}0`,
                item.position,
                ""
              )
        )
        .reduce(
          (sum, adjustment) =>
            sum + adjustment.delta + (adjustment.resetBaseline ?? 0),
          0
        );
      rows.push({
        staff,
        airlineCode: item.airlineCode,
        position: item.position,
        actualCount: actual,
        manualCorrection,
        effectiveCount: Math.max(0, actual + manualCorrection),
      });
    }
  }
  return rows;
}
