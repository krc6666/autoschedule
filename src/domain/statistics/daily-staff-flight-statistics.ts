import type { SchedulingFacts } from "../shared/scheduling-facts";

export interface DailyStaffFlightRow {
  staffId: string;
  staffName: string;
  flightNumbers: string[];
}

export interface DailyStaffFlightStatistics {
  date: string;
  source: "current" | "history" | "partial-history" | "none";
  rows: DailyStaffFlightRow[];
  assignedStaffCount: number;
  unassignedStaffCount: number;
}

interface StaffFlightEntry {
  staffId: string;
  flightNo: string;
  startTime: string;
}

function normalizedFlightNumber(value: string): string {
  return value.trim().replaceAll(/\s+/g, "").toUpperCase();
}

function rowsFromEntries(
  state: Pick<SchedulingFacts, "staff">,
  entries: readonly StaffFlightEntry[]
): DailyStaffFlightRow[] {
  const regularStaff = state.staff.filter(
    (person) => person.staffType === "常规"
  );
  const regularStaffIds = new Set(regularStaff.map((person) => person.id));
  const flightsByStaffId = new Map<string, Map<string, string>>();

  for (const entry of entries) {
    if (!regularStaffIds.has(entry.staffId)) continue;
    const flightNo = normalizedFlightNumber(entry.flightNo);
    if (!flightNo || flightNo === "轮值") continue;
    const flights = flightsByStaffId.get(entry.staffId) ?? new Map();
    const previousStart = flights.get(flightNo);
    if (previousStart === undefined || entry.startTime < previousStart)
      flights.set(flightNo, entry.startTime);
    flightsByStaffId.set(entry.staffId, flights);
  }

  return regularStaff.flatMap((person): DailyStaffFlightRow[] => {
    const flights = flightsByStaffId.get(person.id);
    if (!flights?.size) return [];
    const flightNumbers = [...flights.entries()]
      .sort(
        ([leftFlight, leftStart], [rightFlight, rightStart]) =>
          leftStart.localeCompare(rightStart) ||
          leftFlight.localeCompare(rightFlight)
      )
      .map(([flightNo]) => flightNo);
    return [
      {
        staffId: person.id,
        staffName: person.name,
        flightNumbers,
      },
    ];
  });
}

export function buildDailyStaffFlightStatistics(
  state: Pick<
    SchedulingFacts,
    "staff" | "assignments" | "activeScheduleDate" | "history"
  >,
  date: string
): DailyStaffFlightStatistics {
  const regularStaffCount = state.staff.filter(
    (person) => person.staffType === "常规"
  ).length;
  let source: DailyStaffFlightStatistics["source"] = "none";
  let rows: DailyStaffFlightRow[] = [];

  if (state.activeScheduleDate === date && state.assignments.length) {
    source = "current";
    rows = rowsFromEntries(
      state,
      state.assignments
        .filter(
          (assignment) =>
            assignment.status !== "unfilled" && Boolean(assignment.staffId)
        )
        .map((assignment) => ({
          staffId: assignment.staffId!,
          flightNo: assignment.flightNo,
          startTime: assignment.startTime,
        }))
    );
  } else {
    const records = state.history.filter((record) => record.date === date);
    if (
      records.some((record) => record.historyCoverage === "late-priority-only")
    ) {
      source = "partial-history";
    } else if (records.length) {
      source = "history";
      rows = rowsFromEntries(
        state,
        records.map((record) => ({
          staffId: record.staffId,
          flightNo: record.flightNo,
          startTime: record.startTime,
        }))
      );
    }
  }

  return {
    date,
    source,
    rows,
    assignedStaffCount: rows.length,
    unassignedStaffCount:
      source === "current" || source === "history"
        ? regularStaffCount - rows.length
        : 0,
  };
}
