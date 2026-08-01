import type { SchedulingPluginConfiguration } from "../model";
import type { PluginManifest } from "./plugin-protocol";
import { loadPluginFile, type LoadedPlugin } from "./plugin-host";

export class PluginSession {
  private readonly loaded = new Map<string, LoadedPlugin>();

  async load(file: File): Promise<LoadedPlugin> {
    const plugin = await loadPluginFile(file);
    this.loaded.set(plugin.manifest.id, plugin);
    return plugin;
  }

  install(plugin: LoadedPlugin): void {
    this.loaded.set(plugin.manifest.id, plugin);
  }

  remove(id: string): void {
    this.loaded.delete(id);
  }

  manifests(
    configurations: readonly SchedulingPluginConfiguration[]
  ): PluginManifest[] {
    return [...configurations]
      .sort((left, right) => left.order - right.order)
      .flatMap((configuration) => {
        if (!configuration.enabled || configuration.status !== "loaded")
          return [];
        const loaded = this.loaded.get(configuration.id);
        if (!loaded) return [];
        const sourceRules = new Map(
          loaded.manifest.rules.map((rule) => [rule.id, rule])
        );
        const rules = configuration.rules.flatMap((configuredRule) => {
          const source = sourceRules.get(configuredRule.id);
          return source ? [{ ...source, enabled: configuredRule.enabled }] : [];
        });
        return [{ ...loaded.manifest, rules }];
      });
  }
}
