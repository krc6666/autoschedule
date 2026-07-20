import { describe, expect, it } from "vitest";

import { addIsoDays, durationHours, intervalsOverlap, isNightInterval, normalizeTime, timeToMinutes } from "./time";

describe("time domain", () => {
  it("advances to the next duty day after one rest day", () => {
    expect(addIsoDays("2026-07-18", 2)).toBe("2026-07-20");
  });

  it("parses and normalizes valid clock values", () => {
    expect(timeToMinutes("08:30")).toBe(510);
    expect(normalizeTime("8:30:00")).toBe("08:30");
    expect(normalizeTime("25:00")).toBe("");
  });

  it("calculates shifts that cross midnight", () => {
    expect(durationHours("22:30", "01:00")).toBe(2.5);
  });

  it("detects overlap without treating adjacent shifts as conflicts", () => {
    expect(intervalsOverlap("08:00", "10:00", "09:59", "11:00")).toBe(true);
    expect(intervalsOverlap("08:00", "10:00", "10:00", "11:00")).toBe(false);
    expect(intervalsOverlap("23:00", "01:00", "00:30", "02:00")).toBe(true);
  });

  it("recognizes the configured night window", () => {
    expect(isNightInterval("21:55", "23:55")).toBe(true);
    expect(isNightInterval("08:30", "10:30")).toBe(false);
  });
});
