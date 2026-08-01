import { z } from "zod";

import type { SchedulingPluginConfiguration } from "../model";

const pluginRuleConfigurationSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    label: z.string().trim().min(1).max(80),
    stage: z.enum(["protection", "stable-order"]),
    enabled: z.boolean(),
  })
  .strict();

const pluginConfigurationSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(80),
    fileName: z.string().trim().min(1).max(260),
    apiVersion: z.number().int().positive(),
    enabled: z.boolean(),
    order: z.number().int().nonnegative(),
    status: z.enum(["loaded", "needs-reload"]),
    rules: z.array(pluginRuleConfigurationSchema).max(64),
  })
  .strict();

export function restorePluginConfigurations(
  value: unknown
): SchedulingPluginConfiguration[] {
  if (!Array.isArray(value)) return [];
  const restored = value.flatMap((item) => {
    const parsed = pluginConfigurationSchema.safeParse(item);
    return parsed.success
      ? [{ ...parsed.data, status: "needs-reload" as const }]
      : [];
  });
  const unique = new Map(
    restored
      .sort((left, right) => left.order - right.order)
      .map((plugin) => [plugin.id, plugin])
  );
  return [...unique.values()].map((plugin, order) => ({ ...plugin, order }));
}
