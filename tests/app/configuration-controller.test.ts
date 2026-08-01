import { describe, expect, it, vi } from "vitest";

import type { ApplicationContext } from "../../src/app/application-context";
import { ConfigurationController } from "../../src/app/controllers/configuration-controller";
import { createAutoscheduleStore } from "../../src/app/store/autoschedule-store";
import { createDefaultState } from "../../src/defaults";
import { STORAGE_KEY } from "../../src/infrastructure/storage";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("configuration controller", () => {
  it("persists a staff status change when background rescheduling fails", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const initial = createDefaultState();
    const person = initial.staff.find((item) => item.status === "正常")!;
    initial.activeScheduleDate = "2026-08-01";
    const store = createAutoscheduleStore(initial);
    const toast = vi.fn();
    const context = {
      store,
      scheduleRunner: {
        calculate: vi.fn().mockRejectedValue(new Error("worker failed")),
      },
      preferences: {
        loadScheduleDate: () => null,
        saveScheduleDate: vi.fn(),
        loadScheduleZoom: () => null,
        saveScheduleZoom: vi.fn(),
      },
      view: () => ({ date: "2026-08-01" }),
      model: () => store.getState().model,
      updateView: vi.fn(),
      commit: () => store.getState().persist(),
      toast,
      confirm: () => true,
    } as unknown as ApplicationContext;

    await new ConfigurationController(context).handle({
      type: "update-configuration",
      entity: "staff",
      id: person.id,
      field: "status",
      value: "病假",
    });

    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? "null")).toMatchObject({
      staff: expect.arrayContaining([
        expect.objectContaining({ id: person.id, status: "病假" }),
      ]),
    });
    expect(toast).toHaveBeenCalledWith(
      "人员状态已更新，但排班重新计算失败：worker failed",
      "danger"
    );
  });
});
