import type { Flight, PositionRule } from "../../model";
import { timeToMinutes } from "../shared/time";

export interface AssignmentTask {
  key: string;
  flight: Flight;
  rule: PositionRule;
}

const PRE_NOON_CUTOFF_MINUTES = 12 * 60;

export function isPreNoonFlight(target: Pick<Flight, "startTime">): boolean {
  const start = timeToMinutes(target.startTime);
  return Number.isFinite(start) && start < PRE_NOON_CUTOFF_MINUTES;
}

export function mustAutoFillPreNoon(
  flight: Flight,
  rule: PositionRule
): boolean {
  return (
    isPreNoonFlight(flight) &&
    rule.category === "常规" &&
    (rule.minPassengers ?? 0) <= flight.bookedPassengers
  );
}

export function isKe166MobileSupervisor(
  flight: Flight,
  rule: PositionRule
): boolean {
  return (
    flight.flightNo
      .trim()
      .toUpperCase()
      .replaceAll(/[^A-Z0-9]/g, "") === "KE166" && rule.category === "机动督导"
  );
}

export function isNumberedRegularPosition(rule: PositionRule): boolean {
  return rule.category === "常规" && /\d/.test(rule.name);
}

export function shouldAutoAssign(flight: Flight, rule: PositionRule): boolean {
  if (isKe166MobileSupervisor(flight, rule)) return true;
  if (mustAutoFillPreNoon(flight, rule)) return true;
  return (
    !["引导", "行政支援"].includes(rule.category) &&
    !rule.manual &&
    (rule.minPassengers ?? 0) <= flight.bookedPassengers
  );
}
