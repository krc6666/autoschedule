import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { AppState, HistoryRecord } from "../../src/model";
import { generateSchedule } from "../helpers/generate-schedule";

interface ScaleSpec {
  staffCount: number;
  flightCount: number;
  positionCount: number;
  historyCount: number;
  positionsPerFlight: number;
}

interface RunRecord {
  run: number;
  status: "success" | "failure";
  elapsedMs: number;
  detail: string;
}

function clockTime(totalMinutes: number): string {
  const normalized = totalMinutes % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function createScaleState(spec: ScaleSpec): AppState {
  const state = createDefaultState();
  const baseStaff = state.staff[0]!;
  const baseRule = state.positionRules[0]!;

  state.staff = Array.from({ length: spec.staffCount }, (_, index) => ({
    ...baseStaff,
    id: `scale-staff-${index + 1}`,
    name: `脱敏人员${String(index + 1).padStart(2, "0")}`,
    status: "正常" as const,
    staffType: "常规" as const,
    teamLeader: false,
    cxPreflightQualified: false,
    dutyQualified: false,
    standbyQualified: false,
    nightShift: true,
  }));

  const qualifiedStaffIds = state.staff.map((person) => person.id);
  state.flights = Array.from({ length: spec.flightCount }, (_, flightIndex) => {
    const start = 5 * 60 + flightIndex * 90;
    const positionCount =
      flightIndex === 0
        ? spec.positionCount - spec.positionsPerFlight * (spec.flightCount - 1)
        : spec.positionsPerFlight;
    return {
      id: `scale-flight-${flightIndex + 1}`,
      flightNo: `SC${String(flightIndex + 1).padStart(3, "0")}`,
      startTime: clockTime(start),
      endTime: clockTime(start + 45),
      bookedPassengers: 200,
      positions: Array.from(
        { length: positionCount },
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
      remark: "",
      qualifiedStaffIds,
      manual: false,
      fatiguePoints: 1,
      minPassengers: 0,
      earlyReleaseMinutes: 0,
    }))
  );

  state.templates = [];
  state.assignments = [];
  state.dutyRosterOverrides = [];
  state.latePriorityFrequencyAdjustments = [];
  state.settings.positionTransitionPolicies = [];
  state.settings.latePriorityFlightNumbers = [];
  state.settings.maxDailyHours = 12;
  state.settings.highLoadProtectionEnabled = false;
  state.settings.rollingLoadProtectionEnabled = false;
  state.settings.workloadBalanceEnabled = false;

  state.history = Array.from({ length: spec.historyCount }, (_, index) => {
    const person = state.staff[index % state.staff.length]!;
    const rule = state.positionRules[index % state.positionRules.length]!;
    const flight = state.flights.find(
      (item) => item.flightNo === rule.flightNo
    )!;
    const archivedDate = new Date(
      Date.UTC(2026, 5, 30 - Math.floor(index / spec.positionCount))
    )
      .toISOString()
      .slice(0, 10);
    const record: HistoryRecord = {
      id: `scale-history-${index + 1}`,
      date: archivedDate,
      flightNo: flight.flightNo,
      position: rule.name,
      staffId: person.id,
      staffName: person.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      workHours: 0.75,
      fatiguePoints: rule.fatiguePoints,
      remark: rule.remark,
      historyCoverage: "complete",
    };
    return record;
  });

  return state;
}

function runSummary(records: readonly RunRecord[]): string {
  const elapsed = records.map((record) => record.elapsedMs);
  return JSON.stringify(
    {
      success: records.filter((record) => record.status === "success").length,
      failure: records.filter((record) => record.status === "failure").length,
      minMs: Math.min(...elapsed),
      maxMs: Math.max(...elapsed),
      averageMs: Math.round(
        elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length
      ),
      runs: records,
    },
    null,
    2
  );
}

async function runRepeatedSchedules(
  state: AppState,
  rounds: number,
  date: string
): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (let run = 1; run <= rounds; run += 1) {
    state.assignments = [];
    const started = performance.now();
    try {
      const result = await generateSchedule(state, date);
      const elapsedMs = Math.round(performance.now() - started);
      const detail = `assignments=${result.assignments.length}, unfilled=${result.unfilledCount}`;
      records.push({
        run,
        status:
          result.unfilledCount === 0 &&
          result.assignments.length === state.positionRules.length
            ? "success"
            : "failure",
        elapsedMs,
        detail,
      });
    } catch (error) {
      records.push({
        run,
        status: "failure",
        elapsedMs: Math.round(performance.now() - started),
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return records;
}

describe("schedule scale contracts", () => {
  it("generates every 15-person, 8-flight, 57-position schedule with archived history", async () => {
    const state = createScaleState({
      staffCount: 15,
      flightCount: 8,
      positionCount: 57,
      positionsPerFlight: 7,
      historyCount: 1_200,
    });

    expect(state.staff).toHaveLength(15);
    expect(state.flights).toHaveLength(8);
    expect(state.positionRules).toHaveLength(57);
    expect(state.history).toHaveLength(1_200);

    const records = await runRepeatedSchedules(state, 3, "2026-09-18");
    console.info("realistic schedule scale", runSummary(records));
    expect(
      records.every((record) => record.status === "success"),
      runSummary(records)
    ).toBe(true);
  }, 180_000);

  it("records repeated success, failure, and elapsed time at the pressure limit", async () => {
    const state = createScaleState({
      staffCount: 30,
      flightCount: 15,
      positionCount: 105,
      positionsPerFlight: 7,
      historyCount: 12_000,
    });

    expect(state.staff).toHaveLength(30);
    expect(state.flights).toHaveLength(15);
    expect(state.positionRules.length).toBeGreaterThan(100);
    expect(state.history).toHaveLength(12_000);

    const records = await runRepeatedSchedules(state, 5, "2026-09-19");
    console.info("pressure schedule scale", runSummary(records));
    expect(
      records.every((record) => record.status === "success"),
      runSummary(records)
    ).toBe(true);
  }, 300_000);
});
