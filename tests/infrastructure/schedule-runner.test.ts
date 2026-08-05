import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultState } from "../../src/defaults";
import { runScheduleInBackground } from "../../src/infrastructure/schedule-runner";
import type { ScheduleWorkerResponse } from "../../src/infrastructure/schedule-worker-protocol";

afterEach(() => vi.unstubAllGlobals());

describe("background schedule runner", () => {
  it("terminates every worker across repeated calculations", async () => {
    const workers: SuccessfulWorker[] = [];
    class SuccessfulWorker {
      onmessage:
        ((event: MessageEvent<ScheduleWorkerResponse>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      readonly terminate = vi.fn();

      constructor() {
        workers.push(this);
      }

      postMessage(): void {
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              type: "result",
              result: { assignments: [], warnings: [], unfilledCount: 0 },
            },
          } as unknown as MessageEvent<ScheduleWorkerResponse>)
        );
      }
    }
    vi.stubGlobal("Worker", SuccessfulWorker);

    for (let run = 0; run < 20; run += 1) {
      await expect(
        runScheduleInBackground(
          createDefaultState(),
          "2026-08-01",
          () => undefined
        )
      ).resolves.toMatchObject({ unfilledCount: 0 });
    }

    expect(workers).toHaveLength(20);
    expect(
      workers.every((worker) => worker.terminate.mock.calls.length === 1)
    ).toBe(true);
  });

  it("terminates the worker when posting schedule data fails", async () => {
    const terminate = vi.fn();
    class PostingFailureWorker {
      onmessage:
        ((event: MessageEvent<ScheduleWorkerResponse>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      terminate = terminate;

      postMessage(): void {
        throw new DOMException("无法复制排班数据", "DataCloneError");
      }
    }
    vi.stubGlobal("Worker", PostingFailureWorker);

    await expect(
      runScheduleInBackground(
        createDefaultState(),
        "2026-08-01",
        () => undefined
      )
    ).rejects.toThrow("无法复制排班数据");
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("explains how to recover when the worker file cannot be loaded", async () => {
    const terminate = vi.fn();
    class LoadingFailureWorker {
      onmessage:
        ((event: MessageEvent<ScheduleWorkerResponse>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      terminate = terminate;

      postMessage(): void {
        queueMicrotask(() => this.onerror?.({ message: "" } as ErrorEvent));
      }
    }
    vi.stubGlobal("Worker", LoadingFailureWorker);

    await expect(
      runScheduleInBackground(
        createDefaultState(),
        "2026-08-01",
        () => undefined
      )
    ).rejects.toThrow("排班后台线程无法启动，请刷新页面后重试");
    expect(terminate).toHaveBeenCalledOnce();
  });
});
