// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { createDefaultState } from "../../src/defaults";
import "../../src/ui/components/app-dialog";
import { mountElement } from "./lit-test-helpers";

describe("application dialog", () => {
  it("gives online flight query content a constrained scrolling host", async () => {
    const element = await mountElement<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("autoschedule-app-dialog", {
      model: createDefaultState(),
      dialog: {
        kind: "flight-query",
        date: "2026-08-05",
        loading: false,
        reconciliation: null,
        fetchedAt: "",
        error: "",
      },
    });

    expect(
      element
        .querySelector("autoschedule-flight-query-dialog")
        ?.classList.contains("modal-content-stack")
    ).toBe(true);
  });
});
