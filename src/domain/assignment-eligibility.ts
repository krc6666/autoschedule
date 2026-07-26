import type { AppState, Flight, PositionRule, Staff } from "../model";
import { isNightInterval } from "./time";

export function eligibleStaffForRule(state: AppState, flight: Flight, rule: PositionRule): Staff[] {
  return state.staff
    .filter((person) => person.status === "正常" && person.staffType !== "行政支援")
    .filter((person) => rule.qualifiedStaffIds.includes(person.id))
    .filter((person) => !isNightInterval(
      flight.startTime,
      flight.endTime,
      state.settings.nightStart,
      state.settings.nightEnd
    ) || person.nightShift);
}
