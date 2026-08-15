import type { Flight, FlightTemplate } from "../../model";
import { normalizeWeeklyFlightNo } from "./weekly-flight-plan";

export interface NextWorkdayFlightCandidate {
  id: string;
  flightNo: string;
  startTime: string;
  endTime: string;
  positions: string[];
  remark: string;
  selectedByDefault: boolean;
}

export function buildNextWorkdayFlightCandidates(
  templates: readonly FlightTemplate[],
  defaultFlightNos: readonly string[]
): NextWorkdayFlightCandidate[] {
  const selectedFlightNos = new Set(
    defaultFlightNos.map(normalizeWeeklyFlightNo)
  );
  const candidates = new Map<string, NextWorkdayFlightCandidate>();

  for (const template of templates) {
    const flightNo = normalizeWeeklyFlightNo(template.flightNo);
    if (!flightNo || candidates.has(flightNo)) continue;
    candidates.set(flightNo, {
      id: `template:${template.id}`,
      flightNo,
      startTime: template.startTime,
      endTime: template.endTime,
      positions: [...template.positions],
      remark: template.remark,
      selectedByDefault: selectedFlightNos.has(flightNo),
    });
  }

  return [...candidates.values()].sort((left, right) =>
    left.flightNo.localeCompare(right.flightNo, "en", { numeric: true })
  );
}

export function materializeNextWorkdayFlights(
  candidates: readonly NextWorkdayFlightCandidate[],
  selectedIds: readonly string[]
): Flight[] {
  const selected = new Set(selectedIds);
  return candidates
    .filter((candidate) => selected.has(candidate.id))
    .map((candidate) => ({
      id: `next-${candidate.flightNo.toLowerCase()}`,
      flightNo: candidate.flightNo,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      bookedPassengers: 0,
      positions: [...candidate.positions],
      remark: candidate.remark,
    }));
}
