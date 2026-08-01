import { afterEach, describe, expect, it, vi } from "vitest";

const pluginRuntime = vi.hoisted(() => {
  const releaseProxy = Symbol("releaseProxy");
  return {
    releaseProxy,
    release: vi.fn(),
    terminate: vi.fn(),
    load: vi.fn(() => new Promise<never>(() => undefined)),
  };
});

vi.mock("comlink", () => ({
  releaseProxy: pluginRuntime.releaseProxy,
  wrap: () => ({
    load: pluginRuntime.load,
    [pluginRuntime.releaseProxy]: pluginRuntime.release,
  }),
}));

import { loadPluginSource } from "../../src/infrastructure/plugin-host";

class PendingPluginWorker {
  terminate = pluginRuntime.terminate;
}

describe("plugin timeout safeguard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("terminates an unresponsive worker without retaining a partial plugin", async () => {
    vi.stubGlobal("Worker", PendingPluginWorker);
    const started = performance.now();

    await expect(
      loadPluginSource(
        "export default { apiVersion: 1, id: 'slow.plugin', name: '慢规则', rules: [] };",
        "slow-plugin.js",
        { timeoutMs: 20 }
      )
    ).rejects.toThrow("插件加载超过 20ms，已终止");

    expect(performance.now() - started).toBeLessThan(500);
    expect(pluginRuntime.release).toHaveBeenCalledOnce();
    expect(pluginRuntime.terminate).toHaveBeenCalledOnce();
  });
});
