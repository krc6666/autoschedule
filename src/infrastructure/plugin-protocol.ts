import { z } from "zod";
import { init, parse } from "es-module-lexer";

import type { SchedulingRuleStage } from "../domain/rules/schedule-rule-contract";

export const PLUGIN_API_VERSION = 1 as const;
export const PLUGIN_ALLOWED_STAGES = [
  "protection",
  "stable-order",
] as const satisfies readonly SchedulingRuleStage[];

const pluginMatchSchema = z
  .object({
    flightNo: z.string().trim().min(1).max(32).optional(),
    positionKeyword: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const pluginRuleSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{1,63}$/),
    label: z.string().trim().min(1).max(80),
    stage: z.enum(PLUGIN_ALLOWED_STAGES),
    enabled: z.boolean().default(true),
    match: pluginMatchSchema,
    preferredStaffIds: z
      .array(z.string())
      .max(256)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();

const pluginManifestSchema = z
  .object({
    apiVersion: z.literal(PLUGIN_API_VERSION, {
      error: `插件 API 版本不兼容：需要 ${PLUGIN_API_VERSION}`,
    }),
    id: z
      .string()
      .trim()
      .max(80)
      .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/),
    name: z.string().trim().min(1).max(80),
    rules: z.array(pluginRuleSchema).max(64),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      new Set(manifest.rules.map((rule) => rule.id)).size <
      manifest.rules.length
    )
      context.addIssue({
        code: "custom",
        path: ["rules"],
        message: "插件规则 ID 重复",
      });
  });

export type PluginRuleMatch = z.infer<typeof pluginMatchSchema>;
export type PluginCandidatePreference = z.infer<typeof pluginRuleSchema>;
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function parsePluginManifest(value: unknown): PluginManifest {
  const parsed = pluginManifestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const protectedStage = parsed.error.issues.some(
    (issue) => issue.path[0] === "rules" && issue.path.at(-1) === "stage"
  );
  if (protectedStage) throw new Error("插件规则不能注册到受保护阶段");
  const apiVersion = parsed.error.issues.some(
    (issue) => issue.path[0] === "apiVersion"
  );
  if (apiVersion)
    throw new Error(`插件 API 版本不兼容：需要 ${PLUGIN_API_VERSION}`);
  throw new Error(
    parsed.error.issues.map((issue) => issue.message).join("；") ||
      "插件清单格式无效"
  );
}

export async function validatePluginSource(source: string): Promise<void> {
  if (!source.trim()) throw new Error("插件文件为空");
  if (new TextEncoder().encode(source).byteLength > 256 * 1024)
    throw new Error("插件文件不能超过 256KB");
  await init;
  const [imports, exports] = parse(source);
  if (imports.length) throw new Error("插件必须自包含，禁止导入其他模块");
  if (!exports.some((item) => item.n === "default"))
    throw new Error("插件必须提供 default export");
}
