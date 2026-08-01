import { expose } from "comlink";

import {
  parsePluginManifest,
  validatePluginSource,
  type PluginManifest,
} from "./plugin-protocol";

export interface PluginRuntimeApi {
  load(source: string): Promise<PluginManifest>;
}

function blockNetworkApis(): void {
  const blocked = (): never => {
    throw new Error("插件运行环境禁止网络访问");
  };
  for (const key of [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "Worker",
    "SharedWorker",
  ]) {
    Object.defineProperty(globalThis, key, {
      value: blocked,
      configurable: false,
      writable: false,
    });
  }
}

const runtime: PluginRuntimeApi = {
  async load(source) {
    await validatePluginSource(source);
    blockNetworkApis();
    const moduleUrl = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" })
    );
    try {
      const module = (await import(/* @vite-ignore */ moduleUrl)) as {
        default?: unknown;
      };
      return parsePluginManifest(module.default);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  },
};

expose(runtime);
