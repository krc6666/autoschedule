import { createDefaultState } from "../../../src/defaults";
import type { AppState } from "../../../src/model";

function clockTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function createScheduleScaleState(positionCount: number): AppState {
  const state = createDefaultState();
  const positionsPerFlight = 4;
  const flightCount = Math.ceil(positionCount / positionsPerFlight);
  const staffCount = Math.max(32, Math.ceil((positionCount * 1.5) / 12) + 4);
  const baseStaff = state.staff[0]!;
  state.staff = Array.from({ length: staffCount }, (_, index) => ({
    ...baseStaff,
    id: `scale-staff-${index + 1}`,
    name: `规模人员${index + 1}`,
    status: "正常" as const,
    staffType: "常规" as const,
    teamLeader: false,
    cxPreflightQualified: false,
    dutyQualified: false,
    nightShift: true,
  }));
  const qualifiedStaffIds = state.staff.map((person) => person.id);
  const baseRule = state.positionRules[0]!;
  state.flights = Array.from({ length: flightCount }, (_, flightIndex) => {
    const start = 6 * 60 + flightIndex * 15;
    const firstPositionIndex = flightIndex * positionsPerFlight;
    const ownPositionCount = Math.min(
      positionsPerFlight,
      positionCount - firstPositionIndex
    );
    return {
      id: `scale-flight-${flightIndex + 1}`,
      flightNo: `SC${String(flightIndex + 1).padStart(3, "0")}`,
      startTime: clockTime(start),
      endTime: clockTime(start + 90),
      bookedPassengers: 200,
      positions: Array.from(
        { length: ownPositionCount },
        (_, positionIndex) => `G${String(positionIndex + 1).padStart(2, "0")}`
      ),
      remark: "",
    };
  });
  state.positionRules = state.flights.flatMap((flight) =>
    flight.positions.map((position, positionIndex) => ({
      ...baseRule,
      id: `${flight.id}-position-${positionIndex + 1}`,
      flightNo: flight.flightNo,
      name: position,
      category: "常规" as const,
      remark: positionIndex === 0 ? "一号" : "",
      qualifiedStaffIds,
      manual: false,
      fatiguePoints: positionIndex === 0 ? 4 : 2,
      minPassengers: 0,
      earlyReleaseMinutes: 0,
    }))
  );
  state.history = [];
  state.dutyRosterOverrides = [];
  state.settings.positionTransitionPolicies = [];
  state.settings.maxDailyHours = 12;
  return state;
}
