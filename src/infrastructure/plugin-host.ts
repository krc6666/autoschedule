import { releaseProxy, wrap, type Remote } from "comlink";

import type { PluginRuntimeApi } from "./plugin-runtime.worker";
import { validatePluginSource, type PluginManifest } from "./plugin-protocol";

export interface LoadedPlugin {
  fileName: string;
  manifest: PluginManifest;
  enabled: boolean;
}

export interface PluginLoadOptions {
  timeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`插件加载超过 ${timeoutMs}ms，已终止`)),
      timeoutMs
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function loadPluginSource(
  source: string,
  fileName: string,
  options: PluginLoadOptions = {}
): Promise<LoadedPlugin> {
  await validatePluginSource(source);
  if (typeof Worker === "undefined")
    throw new Error("当前环境不支持隔离 Worker，不能加载插件");
  const worker = new Worker(
    new URL("./plugin-runtime.worker.ts", import.meta.url),
    { type: "module", name: "autoschedule-plugin-sandbox" }
  );
  const remote: Remote<PluginRuntimeApi> = wrap(worker);
  try {
    const manifest = await withTimeout(
      remote.load(source),
      options.timeoutMs ?? 1500
    );
    return { fileName, manifest, enabled: true };
  } finally {
    remote[releaseProxy]();
    worker.terminate();
  }
}

export async function loadPluginFile(
  file: File,
  options?: PluginLoadOptions
): Promise<LoadedPlugin> {
  if (!file.name.toLowerCase().endsWith(".js"))
    throw new Error("只允许加载 .js 插件文件");
  if (file.size > 256 * 1024) throw new Error("插件文件不能超过 256KB");
  return loadPluginSource(await file.text(), file.name, options);
}
