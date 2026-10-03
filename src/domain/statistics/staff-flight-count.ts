export interface StaffFlightEntry {
  staffId: string;
  flightNo: string;
}

export function normalizeStaffFlightNumber(value: string): string {
  return value.trim().replaceAll(/\s+/g, "").toUpperCase();
}

export function groupStaffFlightsByNormalizedNumber<T extends StaffFlightEntry>(
  entries: readonly T[]
): Map<string, Map<string, T[]>> {
  const grouped = new Map<string, Map<string, T[]>>();
  for (const entry of entries) {
    const flightNo = normalizeStaffFlightNumber(entry.flightNo);
    if (!flightNo || flightNo === "轮值") continue;
    const flights = grouped.get(entry.staffId) ?? new Map<string, T[]>();
    const sameFlight = flights.get(flightNo) ?? [];
    sameFlight.push(entry);
    flights.set(flightNo, sameFlight);
    grouped.set(entry.staffId, flights);
  }
  return grouped;
}
