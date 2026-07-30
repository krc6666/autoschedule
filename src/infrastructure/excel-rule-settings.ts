import type * as XLSX from "xlsx-js-style";

import {
  SCHEDULE_SETTING_DEFINITIONS,
  type ScalarScheduleSettingKey,
} from "../domain/schedule-settings";
import { normalizeTime } from "../domain/time";
import type { AppState, ScheduleSettings } from "../model";
import type {
  DutyPositionPriority,
  LateShiftRecoveryPositionRule,
  MobileSupervisorCoverageRule,
  NextWorkdayRecoveryTarget,
  PositionTransitionPolicy,
} from "../structured-policy-contract";
import { createId, normalizeText, splitList } from "../utils";
import {
  append,
  headerIndex,
  normalizePosition,
  rows,
  type Row,
} from "./excel-worksheet";

const SETTING_DESCRIPTORS = SCHEDULE_SETTING_DEFINITIONS;

const RULE_SHEET_NAMES = {
  transitions: "岗位衔接规则",
  dutyPriorities: "值班岗位优先",
  recoveryTargets: "次班恢复目标",
  lateShiftPositions: "末班重点岗位",
  supervisorCoverage: "机动督导范围",
} as const;

interface ParsedRuleSheet<T> {
  present: boolean;
  value?: T[];
  warnings: string[];
}

export interface ParsedScheduleRuleSettings {
  settings?: Partial<ScheduleSettings>;
  warnings: string[];
  recognized: boolean;
}

function parseBoolean(value: unknown): boolean | undefined {
  const normalized = normalizeText(value).toLowerCase();
  if (["是", "启用", "true", "1", "yes", "y"].includes(normalized)) return true;
  if (["否", "停用", "false", "0", "no", "n"].includes(normalized))
    return false;
  return undefined;
}

function parseScalarSettings(workbook: XLSX.WorkBook): {
  present: boolean;
  settings?: Partial<ScheduleSettings>;
  warnings: string[];
} {
  if (!workbook.SheetNames.includes("规则参数"))
    return { present: false, warnings: [] };
  const data = rows(workbook, "规则参数");
  const header = data[0] ?? [];
  const keyIndex = headerIndex(header, ["参数代码"], 0);
  const valueIndex = headerIndex(header, ["值"], 2);
  const descriptors = new Map(
    SETTING_DESCRIPTORS.map((descriptor) => [descriptor.key, descriptor])
  );
  const settings: Partial<ScheduleSettings> = {};
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const [rowOffset, row] of data.slice(1).entries()) {
    if (row.every((value) => !normalizeText(value))) continue;
    const excelRow = rowOffset + 2;
    const key = normalizeText(row[keyIndex]) as ScalarScheduleSettingKey;
    const descriptor = descriptors.get(key);
    if (!descriptor) {
      warnings.push(
        `规则参数第${excelRow}行：未知参数代码“${key || "空白"}”，该行未导入`
      );
      continue;
    }
    if (seen.has(key)) {
      delete (settings as Record<string, unknown>)[key];
      warnings.push(
        `规则参数第${excelRow}行：参数代码“${key}”重复，该参数未覆盖当前设置`
      );
      continue;
    }
    seen.add(key);
    const raw = row[valueIndex];
    let value: boolean | number | string | undefined;
    if (descriptor.type === "boolean") {
      value = parseBoolean(raw);
    } else if (descriptor.type === "time") {
      value = normalizeTime(normalizeText(raw)) || undefined;
    } else {
      const parsed = Number(raw);
      value = Number.isFinite(parsed) ? parsed : undefined;
      if (
        typeof value === "number" &&
        descriptor.integer &&
        !Number.isInteger(value)
      )
        value = undefined;
      if (
        typeof value === "number" &&
        descriptor.min !== undefined &&
        value < descriptor.min
      )
        value = undefined;
      if (
        typeof value === "number" &&
        descriptor.max !== undefined &&
        value > descriptor.max
      )
        value = undefined;
    }
    if (value === undefined) {
      warnings.push(
        `规则参数第${excelRow}行：${descriptor.label}的值无效，该参数未覆盖当前设置`
      );
      continue;
    }
    (settings as Record<string, unknown>)[key] = value;
  }
  return { present: true, settings, warnings };
}

function parseRuleSheet<T>(
  workbook: XLSX.WorkBook,
  sheetName: string,
  parser: (
    row: Row,
    header: Row,
    excelRow: number
  ) => { value?: T; errors: string[] }
): ParsedRuleSheet<T> {
  if (!workbook.SheetNames.includes(sheetName))
    return { present: false, warnings: [] };
  const data = rows(workbook, sheetName);
  const header = data[0] ?? [];
  const value: T[] = [];
  const warnings: string[] = [];
  for (const [rowOffset, row] of data.slice(1).entries()) {
    if (row.every((item) => !normalizeText(item))) continue;
    const excelRow = rowOffset + 2;
    const parsed = parser(row, header, excelRow);
    if (parsed.errors.length)
      warnings.push(
        ...parsed.errors.map((error) => `${sheetName}第${excelRow}行：${error}`)
      );
    else if (parsed.value) value.push(parsed.value);
  }
  return warnings.length
    ? { present: true, warnings }
    : { present: true, value, warnings: [] };
}

function cell(
  row: Row,
  header: Row,
  candidates: string[],
  fallback: number
): string {
  return normalizeText(row[headerIndex(header, candidates, fallback)]);
}

function ruleId(value: string, prefix: string): string {
  return value || createId(prefix);
}

function parseTransitionPolicies(
  workbook: XLSX.WorkBook
): ParsedRuleSheet<PositionTransitionPolicy> {
  return parseRuleSheet(
    workbook,
    RULE_SHEET_NAMES.transitions,
    (row, header) => {
      const enabled = parseBoolean(cell(row, header, ["启用"], 2));
      const modeText = cell(row, header, ["模式"], 8).toLowerCase();
      const mode =
        modeText === "forbid" || modeText === "禁止" || modeText === "强保护"
          ? "forbid"
          : modeText === "prefer" ||
              modeText === "优先" ||
              modeText === "软保护"
            ? "prefer"
            : undefined;
      const minimumGapMinutes = Number(cell(row, header, ["最小间隔"], 7));
      const errors = [
        enabled === undefined ? "启用值必须填写是或否" : "",
        !mode ? "模式必须填写 prefer/优先 或 forbid/禁止" : "",
        !Number.isFinite(minimumGapMinutes) ||
        minimumGapMinutes < 0 ||
        minimumGapMinutes > 1440
          ? "最小间隔分钟必须是0至1440"
          : "",
      ].filter(Boolean);
      if (errors.length || enabled === undefined || !mode) return { errors };
      return {
        errors: [],
        value: {
          id: ruleId(
            cell(row, header, ["规则ID", "ID"], 0),
            "transition-policy"
          ),
          name: cell(row, header, ["规则名称", "名称"], 1),
          enabled,
          sourceFlightNo: cell(row, header, ["来源航班"], 3).toUpperCase(),
          sourcePositions: splitList(cell(row, header, ["来源岗位"], 4)).map(
            normalizePosition
          ),
          targetFlightNo: cell(row, header, ["目标航班"], 5).toUpperCase(),
          targetPosition: normalizePosition(cell(row, header, ["目标岗位"], 6)),
          minimumGapMinutes,
          mode,
        },
      };
    }
  );
}

function parseDutyPriorities(
  workbook: XLSX.WorkBook
): ParsedRuleSheet<DutyPositionPriority> {
  return parseRuleSheet(
    workbook,
    RULE_SHEET_NAMES.dutyPriorities,
    (row, header) => {
      const enabled = parseBoolean(cell(row, header, ["启用"], 3));
      if (enabled === undefined) return { errors: ["启用值必须填写是或否"] };
      return {
        errors: [],
        value: {
          id: ruleId(cell(row, header, ["规则ID", "ID"], 0), "duty-priority"),
          flightNo: cell(row, header, ["航班号"], 1).toUpperCase(),
          positionKeyword: cell(row, header, ["岗位关键词"], 2),
          enabled,
        },
      };
    }
  );
}

function parseRecoveryTargets(
  workbook: XLSX.WorkBook
): ParsedRuleSheet<NextWorkdayRecoveryTarget> {
  return parseRuleSheet(
    workbook,
    RULE_SHEET_NAMES.recoveryTargets,
    (row, header) => {
      const enabled = parseBoolean(cell(row, header, ["启用"], 3));
      if (enabled === undefined) return { errors: ["启用值必须填写是或否"] };
      return {
        errors: [],
        value: {
          id: ruleId(cell(row, header, ["规则ID", "ID"], 0), "recovery-target"),
          flightNo: cell(row, header, ["航班号"], 1).toUpperCase(),
          positionKeyword: cell(row, header, ["岗位关键词"], 2),
          enabled,
        },
      };
    }
  );
}

function parseLateShiftPositions(
  workbook: XLSX.WorkBook
): ParsedRuleSheet<LateShiftRecoveryPositionRule> {
  return parseRuleSheet(
    workbook,
    RULE_SHEET_NAMES.lateShiftPositions,
    (row, header) => {
      const enabled = parseBoolean(cell(row, header, ["启用"], 1));
      const fieldText = cell(row, header, ["匹配字段"], 3).toLowerCase();
      const matchField =
        fieldText === "position" ||
        fieldText === "岗位名称" ||
        fieldText === "岗位"
          ? "position"
          : fieldText === "remark" ||
              fieldText === "岗位备注" ||
              fieldText === "备注"
            ? "remark"
            : undefined;
      const cutoff = cell(row, header, ["次班截止时间", "截止时间"], 5);
      const errors = [
        enabled === undefined ? "启用值必须填写是或否" : "",
        !matchField
          ? "匹配字段必须填写 position/岗位名称 或 remark/岗位备注"
          : "",
        cutoff && !normalizeTime(cutoff)
          ? "次班截止时间必须是有效时间或留空"
          : "",
      ].filter(Boolean);
      if (errors.length || enabled === undefined || !matchField)
        return { errors };
      return {
        errors: [],
        value: {
          id: ruleId(
            cell(row, header, ["规则ID", "ID"], 0),
            "late-recovery-position"
          ),
          enabled,
          flightNo: cell(row, header, ["航班号"], 2).toUpperCase(),
          matchField,
          keyword: cell(row, header, ["关键词"], 4),
          nextWorkdayCutoffTime: cutoff ? normalizeTime(cutoff) : "",
        },
      };
    }
  );
}

function parseSupervisorCoverage(
  workbook: XLSX.WorkBook
): ParsedRuleSheet<MobileSupervisorCoverageRule> {
  return parseRuleSheet(
    workbook,
    RULE_SHEET_NAMES.supervisorCoverage,
    (row, header) => {
      const enabled = parseBoolean(cell(row, header, ["启用"], 1));
      const fieldText = cell(row, header, ["匹配字段"], 3).toLowerCase();
      const matchField =
        fieldText === "position" ||
        fieldText === "岗位名称" ||
        fieldText === "岗位"
          ? "position"
          : fieldText === "remark" ||
              fieldText === "岗位备注" ||
              fieldText === "备注"
            ? "remark"
            : undefined;
      const modeText = cell(row, header, ["模式"], 5).toLowerCase();
      const mode =
        modeText === "allow" || modeText === "允许"
          ? "allow"
          : modeText === "forbid" || modeText === "禁止"
            ? "forbid"
            : undefined;
      const errors = [
        enabled === undefined ? "启用值必须填写是或否" : "",
        !matchField
          ? "匹配字段必须填写 position/岗位名称 或 remark/岗位备注"
          : "",
        !mode ? "模式必须填写 allow/允许 或 forbid/禁止" : "",
      ].filter(Boolean);
      if (errors.length || enabled === undefined || !matchField || !mode)
        return { errors };
      return {
        errors: [],
        value: {
          id: ruleId(
            cell(row, header, ["规则ID", "ID"], 0),
            "supervisor-coverage"
          ),
          enabled,
          flightNo: cell(row, header, ["航班号"], 2).toUpperCase(),
          matchField,
          keyword: cell(row, header, ["关键词"], 4),
          mode,
        },
      };
    }
  );
}

export function parseScheduleRuleSettings(
  workbook: XLSX.WorkBook
): ParsedScheduleRuleSettings {
  const scalar = parseScalarSettings(workbook);
  const transitions = parseTransitionPolicies(workbook);
  const dutyPriorities = parseDutyPriorities(workbook);
  const recoveryTargets = parseRecoveryTargets(workbook);
  const lateShiftPositions = parseLateShiftPositions(workbook);
  const supervisorCoverage = parseSupervisorCoverage(workbook);
  const recognized =
    scalar.present ||
    transitions.present ||
    dutyPriorities.present ||
    recoveryTargets.present ||
    lateShiftPositions.present ||
    supervisorCoverage.present;
  const hasImportableSettings =
    Boolean(scalar.settings && Object.keys(scalar.settings).length) ||
    transitions.value !== undefined ||
    dutyPriorities.value !== undefined ||
    recoveryTargets.value !== undefined ||
    lateShiftPositions.value !== undefined ||
    supervisorCoverage.value !== undefined;
  const settings: Partial<ScheduleSettings> | undefined = hasImportableSettings
    ? { ...(scalar.settings ?? {}) }
    : undefined;
  if (settings && transitions.value)
    settings.positionTransitionPolicies = transitions.value;
  if (settings && dutyPriorities.value)
    settings.dutyPositionPriorities = dutyPriorities.value;
  if (settings && recoveryTargets.value)
    settings.nextWorkdayRecoveryTargets = recoveryTargets.value;
  if (settings && lateShiftPositions.value)
    settings.lateShiftRecoveryPositionRules = lateShiftPositions.value;
  if (settings && supervisorCoverage.value)
    settings.mobileSupervisorCoverageRules = supervisorCoverage.value;
  return {
    settings,
    recognized,
    warnings: [
      ...scalar.warnings,
      ...transitions.warnings,
      ...dutyPriorities.warnings,
      ...recoveryTargets.warnings,
      ...lateShiftPositions.warnings,
      ...supervisorCoverage.warnings,
    ],
  };
}

export function appendScheduleRuleSheets(
  workbook: XLSX.WorkBook,
  state: AppState
): void {
  append(
    workbook,
    "规则参数",
    [
      ["参数代码", "参数名称", "值", "说明"],
      ...SETTING_DESCRIPTORS.map((descriptor) => [
        descriptor.key,
        descriptor.label,
        descriptor.type === "boolean"
          ? state.settings[descriptor.key]
            ? "是"
            : "否"
          : state.settings[descriptor.key],
        descriptor.description,
      ]),
    ],
    [34, 24, 18, 48]
  );
  append(
    workbook,
    RULE_SHEET_NAMES.transitions,
    [
      [
        "规则ID",
        "规则名称",
        "启用",
        "来源航班",
        "来源岗位（逗号分隔）",
        "目标航班",
        "目标岗位",
        "最小间隔分钟",
        "模式",
      ],
      ...state.settings.positionTransitionPolicies.map((rule) => [
        rule.id,
        rule.name,
        rule.enabled ? "是" : "否",
        rule.sourceFlightNo,
        rule.sourcePositions.join(","),
        rule.targetFlightNo,
        rule.targetPosition,
        rule.minimumGapMinutes,
        rule.mode,
      ]),
    ],
    [30, 24, 10, 14, 36, 14, 18, 18, 14]
  );
  append(
    workbook,
    RULE_SHEET_NAMES.dutyPriorities,
    [
      ["规则ID", "航班号", "岗位关键词", "启用"],
      ...state.settings.dutyPositionPriorities.map((rule) => [
        rule.id,
        rule.flightNo,
        rule.positionKeyword,
        rule.enabled ? "是" : "否",
      ]),
    ],
    [30, 14, 24, 10]
  );
  append(
    workbook,
    RULE_SHEET_NAMES.recoveryTargets,
    [
      ["规则ID", "航班号", "岗位关键词", "启用"],
      ...state.settings.nextWorkdayRecoveryTargets.map((rule) => [
        rule.id,
        rule.flightNo,
        rule.positionKeyword,
        rule.enabled ? "是" : "否",
      ]),
    ],
    [30, 14, 24, 10]
  );
  append(
    workbook,
    RULE_SHEET_NAMES.lateShiftPositions,
    [
      [
        "规则ID",
        "启用",
        "航班号（空白表示全部）",
        "匹配字段",
        "关键词",
        "次班截止时间（可留空）",
      ],
      ...state.settings.lateShiftRecoveryPositionRules.map((rule) => [
        rule.id,
        rule.enabled ? "是" : "否",
        rule.flightNo,
        rule.matchField,
        rule.keyword,
        rule.nextWorkdayCutoffTime,
      ]),
    ],
    [32, 10, 24, 16, 24, 24]
  );
  append(
    workbook,
    RULE_SHEET_NAMES.supervisorCoverage,
    [
      [
        "规则ID",
        "启用",
        "航班号（空白表示全部）",
        "匹配字段",
        "关键词",
        "模式",
      ],
      ...state.settings.mobileSupervisorCoverageRules.map((rule) => [
        rule.id,
        rule.enabled ? "是" : "否",
        rule.flightNo,
        rule.matchField,
        rule.keyword,
        rule.mode,
      ]),
    ],
    [32, 10, 24, 16, 24, 14]
  );
}
