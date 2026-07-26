import { describe, expect, it } from "vitest";

import { createDefaultState } from "../defaults";
import { renderFlights } from "./flights-view";

describe("flights view", () => {
  it("provides an online query entry without removing the existing template and manual controls", () => {
    const html = renderFlights(createDefaultState());

    expect(html).toContain('data-action="open-online-flight-query"');
    expect(html).toContain("在线查询航班");
    expect(html).toContain('data-action="add-from-template"');
    expect(html).toContain('data-action="add-flight"');
  });
});
