// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { generateSchedule } from "../helpers/generate-schedule";
import {
  buildShareDocument,
  buildShareSheet,
} from "../../src/infrastructure/share";

describe("share export projection", () => {
  it("builds HTML and PNG input from the same structured DOM sheet", async () => {
    const state = createDefaultState();
    state.assignments = (
      await generateSchedule(state, "2026-07-18")
    ).assignments;
    const sheet = buildShareSheet(
      state,
      "2026-07-18",
      document,
      new Date("2026-07-18T12:00:00Z")
    );

    expect(sheet.querySelectorAll(".flight")).toHaveLength(
      state.flights.length
    );
    expect(sheet.textContent).toContain("国际航班保障排班");
    expect(sheet.textContent).toContain("人员排班一览");
    expect(sheet.querySelectorAll("table")).toHaveLength(
      state.flights.length + 1
    );
  }, 30_000);

  it("serializes text as text instead of executable markup", () => {
    const state = createDefaultState();
    state.flights[0]!.remark = "<script>broken()</script>";
    const serialized = buildShareDocument(state, "2026-07-18");

    expect(serialized).toContain("&lt;script&gt;broken()&lt;/script&gt;");
    expect(serialized).not.toContain("<script>broken()</script>");
    expect(serialized).toContain("<style>");
  });
});
