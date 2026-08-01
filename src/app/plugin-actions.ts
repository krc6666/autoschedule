import type { AppState, SchedulingPluginConfiguration } from "../model";
import type { LoadedPlugin } from "../infrastructure/plugin-host";
import { markActiveScheduleStale } from "../domain/kernel/schedule-lifecycle";

function markMutation(state: AppState): void {
  markActiveScheduleStale(state);
}

export function registerLoadedPlugin(
  state: AppState,
  loaded: LoadedPlugin
): SchedulingPluginConfiguration {
  const existing = state.pluginConfigurations.find(
    (plugin) => plugin.id === loaded.manifest.id
  );
  const knownRuleIds = new Set(loaded.manifest.rules.map((rule) => rule.id));
  const existingRules = new Map(
    existing?.rules.map((rule) => [rule.id, rule]) ?? []
  );
  const sourceRules = new Map(
    loaded.manifest.rules.map((rule) => [rule.id, rule])
  );
  const ruleOrder = [
    ...(existing?.rules.map((rule) => rule.id) ?? []),
    ...loaded.manifest.rules.map((rule) => rule.id),
  ].filter(
    (id, index, ids) => knownRuleIds.has(id) && ids.indexOf(id) === index
  );
  const configuration: SchedulingPluginConfiguration = {
    id: loaded.manifest.id,
    name: loaded.manifest.name,
    fileName: loaded.fileName,
    apiVersion: loaded.manifest.apiVersion,
    enabled: existing?.enabled ?? true,
    order:
      existing?.order ??
      Math.max(
        -1,
        ...state.pluginConfigurations.map((plugin) => plugin.order)
      ) + 1,
    status: "loaded",
    rules: ruleOrder.map((id) => {
      const source = sourceRules.get(id)!;
      return {
        id,
        label: source.label,
        stage: source.stage,
        enabled: existingRules.get(id)?.enabled ?? source.enabled,
      };
    }),
  };
  state.pluginConfigurations = [
    ...state.pluginConfigurations.filter(
      (plugin) => plugin.id !== configuration.id
    ),
    configuration,
  ].sort((left, right) => left.order - right.order);
  state.pluginConfigurations.forEach((plugin, index) => {
    plugin.order = index;
  });
  markMutation(state);
  return configuration;
}

export function setPluginEnabled(
  state: AppState,
  id: string,
  enabled: boolean
): boolean {
  const plugin = state.pluginConfigurations.find((item) => item.id === id);
  if (!plugin) return false;
  if (plugin.enabled !== enabled) {
    plugin.enabled = enabled;
    markMutation(state);
  }
  return true;
}

export function setPluginRuleEnabled(
  state: AppState,
  pluginId: string,
  ruleId: string,
  enabled: boolean
): boolean {
  const rule = state.pluginConfigurations
    .find((plugin) => plugin.id === pluginId)
    ?.rules.find((item) => item.id === ruleId);
  if (!rule) return false;
  if (rule.enabled !== enabled) {
    rule.enabled = enabled;
    markMutation(state);
  }
  return true;
}

export function movePlugin(
  state: AppState,
  id: string,
  direction: -1 | 1
): boolean {
  const ordered = [...state.pluginConfigurations].sort(
    (left, right) => left.order - right.order
  );
  const index = ordered.findIndex((plugin) => plugin.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return false;
  [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
  ordered.forEach((plugin, order) => {
    plugin.order = order;
  });
  state.pluginConfigurations = ordered;
  markMutation(state);
  return true;
}

export function movePluginRule(
  state: AppState,
  pluginId: string,
  ruleId: string,
  direction: -1 | 1
): boolean {
  const plugin = state.pluginConfigurations.find(
    (item) => item.id === pluginId
  );
  if (!plugin) return false;
  const index = plugin.rules.findIndex((rule) => rule.id === ruleId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= plugin.rules.length) return false;
  if (plugin.rules[target]!.stage !== plugin.rules[index]!.stage) return false;
  [plugin.rules[index], plugin.rules[target]] = [
    plugin.rules[target]!,
    plugin.rules[index]!,
  ];
  markMutation(state);
  return true;
}

export function removePlugin(state: AppState, id: string): boolean {
  const before = state.pluginConfigurations.length;
  state.pluginConfigurations = state.pluginConfigurations.filter(
    (plugin) => plugin.id !== id
  );
  if (state.pluginConfigurations.length === before) return false;
  state.pluginConfigurations.forEach((plugin, index) => {
    plugin.order = index;
  });
  markMutation(state);
  return true;
}
