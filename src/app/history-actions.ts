import { getDutyRosterForDate } from "../domain/duty-roster/roster";
import { assignmentUsesUnavailableStaff } from "../domain/kernel/schedule-state";
import { isCountedWorkloadAssignment } from "../domain/shared/workload-accounting";
import type { AppState, HistoryRecord } from "../model";
import { assignmentWarningRemark, createId } from "../utils";

export function currentScheduleHistory(
  state: AppState,
  date: string
): HistoryRecord[] {
  const records = state.assignments
    .filter((item) => item.status === "assigned" && item.staffName)
    .filter((item) => !assignmentUsesUnavailableStaff(state, item))
    .filter((item) => isCountedWorkloadAssignment(state, item))
    .map((item) => ({
      id: createId("history"),
      date,
      flightNo: item.flightNo,
      position: item.position,
      staffId: item.staffId ?? "",
      staffName: item.staffName,
      startTime: item.startTime,
      endTime: item.endTime,
      workHours: item.workHours,
      fatiguePoints: item.fatiguePoints,
      remark: assignmentWarningRemark(
        item.remark,
        item.manualRemark,
        item.manualOverrideWarnings
      ),
    }));
  const roster = getDutyRosterForDate(state, date);
  const dutyPerson = roster.dutyStaffId
    ? state.staff.find((person) => person.id === roster.dutyStaffId)
    : undefined;
  if (dutyPerson && state.settings.dutyFatiguePoints > 0) {
    records.push({
      id: createId("history"),
      date,
      flightNo: "轮值",
      position: "值班人员",
      staffId: dutyPerson.id,
      staffName: dutyPerson.name,
      startTime: "",
      endTime: "",
      workHours: 0,
      fatiguePoints: state.settings.dutyFatiguePoints,
      remark: "月度轮值",
    });
  }
  return records;
}

export function replaceHistoryForDate(
  state: AppState,
  date: string,
  records: HistoryRecord[]
): void {
  state.history = [
    ...state.history.filter((item) => item.date !== date),
    ...records,
  ];
}

export function clearHistory(state: AppState): void {
  state.history = [];
}

export function deleteHistory(state: AppState, id: string): void {
  state.history = state.history.filter((item) => item.id !== id);
}
