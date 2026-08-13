import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultState } from "../../src/defaults";
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

function createRun() {
  vi.stubGlobal("Worker", ControlledWorker);
  const run = runScheduleInBackground(
    createDefaultState(),
    "2026-08-01",
    () => undefined,
    () => undefined
  );
  return { run, worker: ControlledWorker.instances.at(-1)! };
}

describe("background schedule runner", () => {
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

  it("terminates the worker when posting schedule data fails", async () => {
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
    await expect(run.result).rejects.toThrow("无法复制排班数据");
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("explains how to recover when the worker file cannot be loaded", async () => {
    const { run, worker } = createRun();
    queueMicrotask(() => worker.onerror?.({ message: "" } as ErrorEvent));

    await expect(run.result).rejects.toThrow(
      "排班后台线程无法启动，请刷新页面后重试"
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
