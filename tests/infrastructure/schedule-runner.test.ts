import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultState } from "../../src/defaults";
import type { AppState } from "../../src/model";
import { runScheduleInBackground } from "../../src/infrastructure/schedule-runner";
import type { ScheduleWorkerResponse } from "../../src/infrastructure/schedule-worker-protocol";

afterEach(() => vi.unstubAllGlobals());

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<ScheduleWorkerResponse>) => void) | null =
    null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly terminate = vi.fn();
  readonly postMessage = vi.fn();

  constructor() {
    ControlledWorker.instances.push(this);
  }

  emit(message: ScheduleWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<ScheduleWorkerResponse>);
  }
}

function createRun(halfRestStaffIds: string[] = []) {
  vi.stubGlobal("Worker", ControlledWorker);
  const run = runScheduleInBackground(
    createDefaultState(),
    "2026-08-01",
    () => undefined,
    () => undefined,
    { halfRestStaffIds }
  );
  return { run, worker: ControlledWorker.instances.at(-1)! };
}

describe("background schedule runner", () => {
  it("projects application state to schedule-generation facts before posting", () => {
    const state = createDefaultState();
    const selectedId = state.staff.find(
      (person) => person.status === "正常" && person.staffType === "常规"
    )!.id;
    vi.stubGlobal("Worker", ControlledWorker);
    const run = runScheduleInBackground(
      state,
      "2026-08-01",
      () => undefined,
      () => undefined,
      {
        halfRestStaffIds: [selectedId],
        halfRestModes: { [selectedId]: "late-start" },
      }
    );
    const worker = ControlledWorker.instances.at(-1)!;

    expect(worker.postMessage).toHaveBeenCalledOnce();
    const request = worker.postMessage.mock.calls[0]![0];
    expect(request.state).toMatchObject({
      staff: expect.any(Array),
      flights: expect.any(Array),
      positionRules: expect.any(Array),
      settings: expect.any(Object),
    });
    expect(request.state).not.toHaveProperty("version");
    expect(request.state).not.toHaveProperty("weeklyFlightPlans");
    expect(request.state).not.toHaveProperty("activeScheduleDate");
    expect(request.state).not.toHaveProperty("schedulePolicyStale");
    expect(request.state).not.toHaveProperty("updatedAt");
    expect(request.preferences).toEqual({
      halfRestStaffIds: [selectedId],
      halfRestModes: { [selectedId]: "late-start" },
    });
    run.stopWithoutResult();
  });

  it("stops immediately without exposing a calculated result", async () => {
    const { run, worker } = createRun();

    expect(run.stopWithoutResult()).toBe(true);

    await expect(run.result).resolves.toEqual({
      kind: "stopped-without-result",
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("refuses to adopt a result until a complete safe snapshot exists", () => {
    const { run, worker } = createRun();

    expect(run.hasLatestSafeResult()).toBe(false);
    expect(run.stopWithLatestResult()).toBe(false);
    expect(worker.terminate).not.toHaveBeenCalled();
    run.stopWithoutResult();
  });

  it("adopts the latest complete safe snapshot and terminates further work", async () => {
    const { run, worker } = createRun();
    const safeResult = { assignments: [], warnings: [], unfilledCount: 0 };
    worker.emit({ type: "safe-result", result: safeResult });

    expect(run.hasLatestSafeResult()).toBe(true);
    expect(run.stopWithLatestResult()).toBe(true);

    await expect(run.result).resolves.toEqual({
      kind: "stopped-with-result",
      result: safeResult,
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates every worker across repeated completed calculations", async () => {
    const workers: ControlledWorker[] = [];
    for (let index = 0; index < 20; index += 1) {
      const { run, worker } = createRun();
      workers.push(worker);
      worker.emit({
        type: "result",
        result: { assignments: [], warnings: [], unfilledCount: 0 },
      });
      await expect(run.result).resolves.toMatchObject({ kind: "completed" });
    }
    expect(
      workers.every((worker) => worker.terminate.mock.calls.length === 1)
    ).toBe(true);
  });

  it("falls back to the main thread when posting schedule data fails", async () => {
    const terminate = vi.fn();
    class PostingFailureWorker extends ControlledWorker {
      override terminate = terminate;
      override postMessage = vi.fn(() => {
        throw new DOMException("无法复制排班数据", "DataCloneError");
      });
    }
    vi.stubGlobal("Worker", PostingFailureWorker);

    const run = runScheduleInBackground(
      createDefaultState(),
      "2026-08-01",
      () => undefined,
      () => undefined
    );
    const outcome = await run.result;
    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") throw new Error("expected completed run");
    expect(outcome.result.assignments.length).toBeGreaterThan(0);
    expect(terminate).toHaveBeenCalledOnce();
  }, 60_000);

  it("falls back to the main thread when the worker file cannot be loaded", async () => {
    const { run, worker } = createRun();
    queueMicrotask(() => worker.onerror?.({ message: "" } as ErrorEvent));

    const outcome = await run.result;
    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") throw new Error("expected completed run");
    expect(outcome.result.assignments.length).toBeGreaterThan(0);
    expect(worker.terminate).toHaveBeenCalledOnce();
  }, 60_000);

  it("retries on the main thread when the worker returns an error", async () => {
    const { run, worker } = createRun();

    worker.emit({ type: "error", message: "worker failed" });

    const outcome = await run.result;

    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") throw new Error("expected completed run");
    expect(outcome.result.assignments.length).toBeGreaterThan(0);
    expect(worker.terminate).toHaveBeenCalledOnce();
  }, 60_000);

  it("retries on the main thread when the worker raises a runtime error", async () => {
    const { run, worker } = createRun();

    worker.onerror?.({ message: "worker crashed" } as ErrorEvent);

    const outcome = await run.result;

    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") throw new Error("expected completed run");
    expect(outcome.result.assignments.length).toBeGreaterThan(0);
    expect(worker.terminate).toHaveBeenCalledOnce();
  }, 60_000);

  it("rejects only after the main-thread retry also fails", async () => {
    const brokenState = {
      ...createDefaultState(),
      flights: null,
    } as unknown as AppState;
    vi.stubGlobal("Worker", ControlledWorker);
    const run = runScheduleInBackground(
      brokenState,
      "2026-08-01",
      () => undefined,
      () => undefined
    );
    const worker = ControlledWorker.instances.at(-1)!;
    worker.emit({ type: "error", message: "worker failed" });

    let error: unknown;
    try {
      await run.result;
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(String(error)).toContain("worker failed");
  }, 30_000);

  it("preserves an onerror reason when the main-thread retry also fails", async () => {
    const brokenState = {
      ...createDefaultState(),
      flights: null,
    } as unknown as AppState;
    vi.stubGlobal("Worker", ControlledWorker);
    const run = runScheduleInBackground(
      brokenState,
      "2026-08-01",
      () => undefined,
      () => undefined
    );
    const worker = ControlledWorker.instances.at(-1)!;
    worker.onerror?.({ message: "worker crashed" } as ErrorEvent);

    let error: unknown;
    try {
      await run.result;
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();
    expect(String(error)).toContain("worker crashed");
    expect(String(error)).toContain("state.flights is not iterable");
  }, 30_000);

  it("does not expose a new result when stopped during the main-thread retry", async () => {
    const { run, worker } = createRun();
    worker.emit({ type: "error", message: "worker failed" });

    expect(run.stopWithoutResult()).toBe(true);
    await expect(run.result).resolves.toEqual({
      kind: "stopped-without-result",
    });
  }, 30_000);
});
