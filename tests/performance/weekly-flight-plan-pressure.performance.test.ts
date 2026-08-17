import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx-js-style";

import {
  flightNumbersForDate,
  replaceWeeklyFlightPlan,
} from "../../src/domain/flights/weekly-flight-plan";
import { parseWorkbook } from "../../src/infrastructure/excel";
import {
  currentScheduleHistory,
  replaceHistoryForDate,
} from "../../src/app/history-actions";
import type { AppState } from "../../src/model";
import { createScheduleScaleState } from "./fixtures/schedule-scale";
import { generateSchedule } from "../helpers/generate-schedule";

interface PressureFailure {
  round: number;
  date: string;
  weekday: number;
  flights: string[];
  kind: "exception" | "incomplete" | "duplicate";
  message: string;
}

function dateForRoundAndWeekday(round: number, weekday: number): string {
  const date = new Date(Date.UTC(2026, 7, 17 + round * 7 + weekday - 1));
  return date.toISOString().slice(0, 10);
}

function createPressureState(): AppState {
  const state = createScheduleScaleState(40);
  const configPath = process.env.AUTOSCHEDULE_PRESSURE_CONFIG;
  if (!configPath) return state;

  const imported = parseWorkbook(XLSX.readFile(configPath), state.staff);
  if (imported.staff?.length) state.staff = imported.staff;
  if (imported.flights?.length) state.flights = imported.flights;
  if (imported.templates?.length) state.templates = imported.templates;
  if (imported.positionRules?.length)
    state.positionRules = imported.positionRules;
  if (imported.history) state.history = imported.history;
  if (imported.weeklyFlightPlans) {
    state.weeklyFlightPlans = imported.weeklyFlightPlans;
  }
  state.settings = { ...state.settings, ...imported.settings };
  return state;
}

describe("weekly flight plan pressure", () => {
  it(
    "continues after individual generation failures and reports all affected presets",
    async () => {
      const state = createPressureState();
      const allFlights = state.flights.map((flight) => structuredClone(flight));
      const allFlightNos = allFlights.map((flight) => flight.flightNo);
      if (!process.env.AUTOSCHEDULE_PRESSURE_CONFIG) {
        const plans = [
          allFlightNos,
          allFlightNos.filter((_, index) => index % 2 === 0),
          allFlightNos.filter((_, index) => index % 2 === 1),
          allFlightNos.slice(0, 8),
          allFlightNos.slice(2),
          allFlightNos.filter((_, index) => index !== 1 && index !== 8),
          allFlightNos,
        ];
        state.weeklyFlightPlans = plans.reduce(
          (current, flightNos, index) =>
            replaceWeeklyFlightPlan(
              current,
              (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
              flightNos
            ),
          state.weeklyFlightPlans
        );
      }

      const failures: PressureFailure[] = [];
      const timings: Array<{
        round: number;
        weekday: number;
        elapsedMs: number;
      }> = [];
      const configuredRounds = Number(process.env.AUTOSCHEDULE_PRESSURE_ROUNDS);
      const rounds =
        Number.isInteger(configuredRounds) && configuredRounds > 0
          ? configuredRounds
          : 3;
      for (let round = 0; round < rounds; round += 1) {
        for (let weekday = 1; weekday <= 7; weekday += 1) {
          const date = dateForRoundAndWeekday(round, weekday);
          const flightNos = flightNumbersForDate(state.weeklyFlightPlans, date);
          state.flights = allFlights.filter((flight) =>
            flightNos.includes(flight.flightNo)
          );
          const started = performance.now();
          try {
            const result = await generateSchedule(state, date);
            const elapsedMs = Math.round(performance.now() - started);
            timings.push({ round, weekday, elapsedMs });
            if (result.unfilledCount > 0) {
              failures.push({
                round,
                date,
                weekday,
                flights: flightNos,
                kind: "incomplete",
                message: `unfilled=${result.unfilledCount}, assignments=${result.assignments.length}`,
              });
            }
            const ids = result.assignments.map((assignment) => assignment.id);
            if (new Set(ids).size !== ids.length) {
              failures.push({
                round,
                date,
                weekday,
                flights: flightNos,
                kind: "duplicate",
                message: "assignment ids are duplicated",
              });
            }
            state.assignments = result.assignments;
            state.activeScheduleDate = date;
            replaceHistoryForDate(
              state,
              date,
              currentScheduleHistory(state, date)
            );
          } catch (error) {
            timings.push({
              round,
              weekday,
              elapsedMs: Math.round(performance.now() - started),
            });
            failures.push({
              round,
              date,
              weekday,
              flights: flightNos,
              kind: "exception",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      expect(failures, JSON.stringify({ failures, timings }, null, 2)).toEqual(
        []
      );
    },
    Number(process.env.AUTOSCHEDULE_PRESSURE_TIMEOUT_MS) || 600_000
  );
});
