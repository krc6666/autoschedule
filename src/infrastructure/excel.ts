import * as XLSX from "xlsx-js-style";

import type {
  AppState,
  Assignment,
  Flight,
  FlightTemplate,
  HistoryRecord,
  LatePriorityFrequencyAdjustment,
  PositionRule,
  ScheduleSettings,
  Staff,
  WeeklyFlightPlanEntry,
} from "../model";
import {
  combinedAssignmentRemark,
  assignmentWarningRemark,
  createId,
  normalizeText,
  orderPositionRules,
  splitList,
} from "../utils";
import { durationHours, normalizeTime } from "../domain/shared/time";
import { mergeLatePriorityFrequencyAdjustments } from "../domain/statistics/late-priority-frequency-adjustment";
import {
  createEmptyWeeklyFlightPlans,
  replaceWeeklyFlightPlan,
} from "../domain/flights/weekly-flight-plan";
import {
  appendScheduleRuleSheets,
  parseScheduleRuleSettings,
} from "./excel-rule-settings";
import {
  parseLegacyScheduleWorkbook,
  type LegacyScheduleImportPreview,
  type LegacyScheduleParseOptions,
} from "./legacy-schedule-excel";
import {
  append,
  findSheet,
  headerIndex,
  normalizePosition,
  rows,
  sheet,
} from "./excel-worksheet";

export interface WorkbookImport {
  staff?: Staff[];
  flights?: Flight[];
  templates?: FlightTemplate[];
  weeklyFlightPlans?: WeeklyFlightPlanEntry[];
  positionRules?: PositionRule[];
  history?: HistoryRecord[];
  settings?: Partial<ScheduleSettings>;
  latePriorityFrequencyAdjustments?: LatePriorityFrequencyAdjustment[];
  legacySchedule?: LegacyScheduleImportPreview;
  warnings: string[];
}

function parseLatePriorityFrequencyAdjustments(
  workbook: XLSX.WorkBook
): LatePriorityFrequencyAdjustment[] | undefined {
  if (!workbook.SheetNames.includes("末班重点次数修正")) return undefined;
  const data = rows(workbook, "末班重点次数修正");
  const header = data[0] ?? [];
  const index = (names: string[], fallback: number) =>
    headerIndex(header, names, fallback);
  const kindIndex = index(["类别", "岗位类别"], 3);
  const kinds = new Set([
    "supervisor",
    "number-one",
    "declaration",
    "delivery",
  ]);
  return mergeLatePriorityFrequencyAdjustments(
    data.slice(1).flatMap((row): LatePriorityFrequencyAdjustment[] => {
      const month = normalizeText(row[index(["月份"], 0)]);
      const staffId = normalizeText(row[index(["人员编号", "编号"], 1)]);
      const flightNo = normalizeText(row[index(["航班号"], 2)]).toUpperCase();
      const kind = normalizeText(row[kindIndex]);
      const delta = Number(row[index(["修正次数", "修正值"], 4)]);
      if (
        !/^\d{4}-\d{2}$/.test(month) ||
        !staffId ||
        !flightNo ||
        !kinds.has(kind) ||
        !Number.isFinite(delta) ||
        !Number.isInteger(delta) ||
        delta === 0
      )
        return [];
      return [
        {
          month,
          staffId,
          flightNo,
          kind: kind as LatePriorityFrequencyAdjustment["kind"],
          delta,
        },
      ];
    })
  );
}

export interface WorkbookImportOptions {
  legacySchedule?: LegacyScheduleParseOptions;
}

function sheetHasDataRows(
  workbook: XLSX.WorkBook,
  candidates: string[]
): boolean {
  const sheetName = findSheet(workbook, candidates);
  if (!sheetName) return false;
  return rows(workbook, sheetName)
    .slice(1)
    .some((row) => row.some((value) => normalizeText(value)));
}

function parseStaff(workbook: XLSX.WorkBook): Staff[] | undefined {
  const sheetName = findSheet(workbook, ["人员信息", "员工信息"]);
  if (!sheetName) return undefined;
  const data = rows(workbook, sheetName);
  const header = data[0] ?? [];
  const idIndex = headerIndex(header, ["编号", "员工号"], 0);
  const nameIndex = headerIndex(header, ["姓名"], 1);
  const nightIndex = headerIndex(header, ["夜班"], 2);
  const statusIndex = headerIndex(header, ["状态"], 3);
  const remarkIndex = headerIndex(header, ["备注"], 4);
  const staffTypeIndex = headerIndex(
    header,
    ["人员类型", "人员分类", "类型"],
    5
  );
  const cxPreflightIndex = headerIndex(
    header,
    ["CX航前资质", "CX航前", "航前资质"],
    6
  );
  const dutyIndex = header.findIndex((cell) =>
    ["值班资质", "值班人员资质"].some((candidate) =>
      normalizeText(cell).includes(candidate)
    )
  );
  const standbyIndex = header.findIndex((cell) =>
    ["备勤资质", "备勤人员资质"].some((candidate) =>
      normalizeText(cell).includes(candidate)
    )
  );
  const teamLeaderIndex = header.findIndex((cell) =>
    ["是否为分队长", "分队长"].some((candidate) =>
      normalizeText(cell).includes(candidate)
    )
  );
  return data.slice(1).flatMap((row) => {
    const id = normalizeText(row[idIndex]);
    const name = normalizeText(row[nameIndex]);
    if (!id || !name) return [];
    const rawStatus = normalizeText(row[statusIndex]);
    const status: Staff["status"] =
      rawStatus === "病假" || rawStatus === "休假" ? rawStatus : "正常";
    const staffType: Staff["staffType"] = normalizeText(
      row[staffTypeIndex]
    ).includes("行政")
      ? "行政支援"
      : "常规";
    return [
      {
        id,
        name,
        staffType,
        teamLeader:
          staffType === "常规" &&
          teamLeaderIndex >= 0 &&
          ["是", "有", "true", "1"].includes(
            normalizeText(row[teamLeaderIndex]).toLowerCase()
          ),
        cxPreflightQualified:
          staffType === "常规" &&
          ["是", "有", "true", "1"].includes(
            normalizeText(row[cxPreflightIndex]).toLowerCase()
          ),
        dutyQualified:
          staffType === "常规" &&
          (dutyIndex < 0 ||
            !["否", "无", "false", "0"].includes(
              normalizeText(row[dutyIndex]).toLowerCase()
            )),
        standbyQualified:
          staffType === "常规" &&
          (standbyIndex < 0 ||
            !["否", "无", "false", "0"].includes(
              normalizeText(row[standbyIndex]).toLowerCase()
            )),
        nightShift: !["否", "不可以", "false", "0"].includes(
          normalizeText(row[nightIndex]).toLowerCase()
        ),
        status,
        remark: normalizeText(row[remarkIndex]),
      },
    ];
  });
}

function parseFlights(workbook: XLSX.WorkBook): Flight[] | undefined {
  const sheetName = findSheet(workbook, ["航班计划"]);
  if (!sheetName) return undefined;
  const data = rows(workbook, sheetName);
  const header = data[0] ?? [];
  const flightIndex = headerIndex(header, ["航班号"], 0);
  const startIndex = headerIndex(header, ["开始时间"], 1);
  const endIndex = headerIndex(header, ["结束时间"], 2);
  const passengerIndex = headerIndex(
    header,
    ["预定人数", "旅客人数", "运力人数"],
    3
  );
  const positionIndex = headerIndex(header, ["涉及岗位", "岗位"], 4);
  const remarkIndex = headerIndex(header, ["备注"], 5);
  return data.slice(1).flatMap((row) => {
    const flightNo = normalizeText(row[flightIndex]).toUpperCase();
    const startTime = normalizeTime(normalizeText(row[startIndex]));
    const endTime = normalizeTime(normalizeText(row[endIndex]));
    if (!flightNo || !startTime || !endTime) return [];
    return [
      {
        id: createId("flight"),
        flightNo,
        startTime,
        endTime,
        bookedPassengers: Number(row[passengerIndex]) || 0,
        positions: splitList(row[positionIndex]).map(normalizePosition),
        remark: normalizeText(row[remarkIndex]),
      },
    ];
  });
}

function parseTemplates(workbook: XLSX.WorkBook): FlightTemplate[] | undefined {
  const sheetName = findSheet(workbook, ["航班配置", "航班模板"]);
  if (!sheetName) return undefined;
  const data = rows(workbook, sheetName);
  const header = data[0] ?? [];
  const flightIndex = headerIndex(header, ["航班号"], 0);
  const startIndex = headerIndex(header, ["开始时间"], 1);
  const endIndex = headerIndex(header, ["结束时间"], 2);
  const positionIndex = headerIndex(header, ["涉及岗位", "岗位"], 3);
  const remarkIndex = headerIndex(header, ["备注"], 4);
  return data.slice(1).flatMap((row) => {
    const flightNo = normalizeText(row[flightIndex]).toUpperCase();
    const startTime = normalizeTime(normalizeText(row[startIndex]));
    const endTime = normalizeTime(normalizeText(row[endIndex]));
    if (!flightNo || !startTime || !endTime) return [];
    return [
      {
        id: createId("template"),
        flightNo,
        startTime,
        endTime,
        positions: splitList(row[positionIndex]).map(normalizePosition),
        remark: normalizeText(row[remarkIndex]),
      },
    ];
  });
}

function parseWeeklyFlightPlans(
  workbook: XLSX.WorkBook
): WeeklyFlightPlanEntry[] | undefined {
  const sheetName = findSheet(workbook, ["每周航班计划"]);
  if (!sheetName) return undefined;
  const data = rows(workbook, sheetName);
  let plans = createEmptyWeeklyFlightPlans();
  const weekdayByLabel = new Map<string, number>([
    ["星期一", 1],
    ["周一", 1],
    ["星期二", 2],
    ["周二", 2],
    ["星期三", 3],
    ["周三", 3],
    ["星期四", 4],
    ["周四", 4],
    ["星期五", 5],
    ["周五", 5],
    ["星期六", 6],
    ["周六", 6],
    ["星期日", 7],
    ["星期天", 7],
    ["周日", 7],
    ["周天", 7],
  ]);
  for (const row of data.slice(1)) {
    const rawWeekday = normalizeText(row[0]);
    const numericWeekday = Number(rawWeekday);
    const weekday =
      weekdayByLabel.get(rawWeekday) ??
      (Number.isInteger(numericWeekday) &&
      numericWeekday >= 1 &&
      numericWeekday <= 7
        ? numericWeekday
        : undefined);
    if (!weekday) continue;
    plans = replaceWeeklyFlightPlan(
      plans,
      weekday as WeeklyFlightPlanEntry["weekday"],
      splitList(row[1])
    );
  }
  return plans;
}

function parseFatigueMap(workbook: XLSX.WorkBook): Map<string, number> {
  const sheetName = findSheet(workbook, ["岗位疲劳度", "疲劳度计算"]);
  const result = new Map<string, number>();
  if (!sheetName) return result;
  const data = rows(workbook, sheetName);
  let currentFlight = "";
  for (const row of data.slice(1)) {
    currentFlight = normalizeText(row[1]).toUpperCase() || currentFlight;
    const position = normalizePosition(row[5]);
    const points = Number(row[7]);
    if (currentFlight && position && Number.isFinite(points))
      result.set(`${currentFlight}|${position}`, points);
  }
  return result;
}

function parsePositions(workbook: XLSX.WorkBook): PositionRule[] | undefined {
  const sheetName = findSheet(workbook, ["岗位配置"]);
  if (!sheetName) return undefined;
  const fatigueMap = parseFatigueMap(workbook);
  const data = rows(workbook, sheetName);
  const header = data[0] ?? [];
  const flightIndex = headerIndex(header, ["航班号"], 0);
  const categoryIndex = headerIndex(header, ["项目分类", "分类"], 1);
  const nameIndex = headerIndex(header, ["岗位名称"], 2);
  const remarkIndex = headerIndex(header, ["备注"], 3);
  const qualifiedIndex = headerIndex(header, ["可胜任人员"], 4);
  const fatiguePointsIndex = headerIndex(header, ["疲劳点数"], 5);
  const minPassengersIndex = headerIndex(
    header,
    ["启用旅客人数", "最少旅客人数", "运力阈值"],
    fatiguePointsIndex + 1
  );
  const earlyReleaseIndex = headerIndex(
    header,
    ["提前撤岗分钟", "提前撤岗", "分流分钟"],
    minPassengersIndex + 1
  );
  const result: PositionRule[] = [];
  let currentFlight = "";
  for (const row of data.slice(1)) {
    currentFlight =
      normalizeText(row[flightIndex]).toUpperCase() || currentFlight;
    const name = normalizePosition(row[nameIndex]);
    if (!currentFlight || !name) continue;
    const rawQualified = normalizeText(row[qualifiedIndex]);
    const categoryText = normalizeText(row[categoryIndex]);
    if (categoryText.includes("支援") && !categoryText.includes("行政支援"))
      continue;
    const category: PositionRule["category"] = categoryText.includes("督导补位")
      ? "常规"
      : categoryText.includes("机动督导")
        ? "机动督导"
        : categoryText.includes("行政支援")
          ? "行政支援"
          : categoryText.includes("引导")
            ? "引导"
            : categoryText.includes("分流")
              ? "分流"
              : "常规";
    result.push({
      id: createId("position"),
      flightNo: currentFlight,
      name,
      category,
      remark: normalizeText(row[remarkIndex]),
      qualifiedStaffIds: splitList(rawQualified),
      manual: rawQualified.includes("手动输入"),
      fatiguePoints:
        fatigueMap.get(`${currentFlight}|${name}`) ??
        (Number(row[fatiguePointsIndex]) || 1),
      minPassengers: Number(row[minPassengersIndex]) || 0,
      earlyReleaseMinutes: Number(row[earlyReleaseIndex]) || 0,
    });
  }
  const unique = new Map(
    result.map((rule) => [
      `${rule.flightNo}|${rule.name}|${rule.category}`,
      rule,
    ])
  );
  return orderPositionRules([...unique.values()]);
}

function staffIdByName(staff: Staff[], name: string): string {
  return staff.find((person) => person.name === name)?.id ?? "";
}

function parseHistory(
  workbook: XLSX.WorkBook,
  staff: Staff[]
): HistoryRecord[] | undefined {
  const sheetName = findSheet(workbook, ["历史排班", "排班结果"]);
  if (!sheetName) return undefined;
  const data = rows(workbook, sheetName);
  const header = data[0] ?? [];
  const dateIndex = headerIndex(header, ["日期"], 0);
  const flightIndex = headerIndex(header, ["航班号"], -1);
  const positionIndex = headerIndex(header, ["岗位"], 1);
  const nameIndex = headerIndex(header, ["姓名"], 2);
  const startIndex = headerIndex(header, ["开始时间"], -1);
  const endIndex = headerIndex(header, ["结束时间"], -1);
  const hoursIndex = headerIndex(header, ["工作时长"], 3);
  const fatigueIndex = headerIndex(header, ["疲劳点"], -1);
  const remarkIndex = headerIndex(header, ["备注"], 4);
  return data.slice(1).flatMap((row) => {
    const date = normalizeText(row[dateIndex]).slice(0, 10);
    const staffName = normalizeText(row[nameIndex]);
    const position = normalizePosition(row[positionIndex]);
    if (!date || !staffName || !position) return [];
    const startTime =
      startIndex >= 0 ? normalizeTime(normalizeText(row[startIndex])) : "";
    const endTime =
      endIndex >= 0 ? normalizeTime(normalizeText(row[endIndex])) : "";
    const hours = Number(row[hoursIndex]) || durationHours(startTime, endTime);
    return [
      {
        id: createId("history"),
        date,
        flightNo:
          flightIndex >= 0 ? normalizeText(row[flightIndex]).toUpperCase() : "",
        position,
        staffId: staffIdByName(staff, staffName),
        staffName,
        startTime,
        endTime,
        workHours: hours,
        fatiguePoints:
          fatigueIndex >= 0 ? Number(row[fatigueIndex]) || hours : hours,
        remark: normalizeText(row[remarkIndex]),
      },
    ];
  });
}

export function parseWorkbook(
  workbook: XLSX.WorkBook,
  currentStaff: Staff[],
  options: WorkbookImportOptions = {}
): WorkbookImport {
  const staff = parseStaff(workbook);
  const effectiveStaff = staff !== undefined ? staff : currentStaff;
  const flights = parseFlights(workbook);
  const templates = parseTemplates(workbook);
  const weeklyFlightPlans = parseWeeklyFlightPlans(workbook);
  const positionRules = parsePositions(workbook);
  const history = parseHistory(workbook, effectiveStaff);
  const parsedRules = parseScheduleRuleSettings(workbook);
  const latePriorityFrequencyAdjustments =
    parseLatePriorityFrequencyAdjustments(workbook);
  const warnings = [...parsedRules.warnings];
  const hasStandardSheet = Boolean(
    staff ||
    flights ||
    templates ||
    weeklyFlightPlans ||
    positionRules ||
    history ||
    parsedRules.recognized ||
    latePriorityFrequencyAdjustments !== undefined
  );
  const legacySchedule = hasStandardSheet
    ? undefined
    : parseLegacyScheduleWorkbook(workbook, effectiveStaff, {
        year: new Date().getFullYear(),
        ...options.legacySchedule,
      });
  if (legacySchedule?.recognizedSheets)
    warnings.push(
      `识别到旧版横向排班：${legacySchedule.recognizedSheets} 个工作日、${legacySchedule.readyRecords} 条可导入、${legacySchedule.reviewRecords} 条待确认`
    );
  if (
    staff?.length === 0 &&
    sheetHasDataRows(workbook, ["人员信息", "员工信息"])
  )
    warnings.push("人员信息工作表没有有效数据");
  if (flights?.length === 0 && sheetHasDataRows(workbook, ["航班计划"]))
    warnings.push("航班计划工作表没有有效数据");
  if (
    templates?.length === 0 &&
    sheetHasDataRows(workbook, ["航班配置", "航班模板"])
  )
    warnings.push("航班配置工作表没有有效数据");
  if (positionRules?.length === 0 && sheetHasDataRows(workbook, ["岗位配置"]))
    warnings.push("岗位配置工作表没有有效数据");
  if (
    !staff &&
    !flights &&
    !templates &&
    !weeklyFlightPlans &&
    !positionRules &&
    !history &&
    !parsedRules.recognized &&
    latePriorityFrequencyAdjustments === undefined &&
    !legacySchedule?.recognizedSheets
  )
    warnings.push("未识别到受支持的工作表");
  return {
    staff,
    flights,
    templates,
    weeklyFlightPlans,
    positionRules,
    history,
    legacySchedule,
    settings: parsedRules.settings,
    latePriorityFrequencyAdjustments,
    warnings,
  };
}

export async function importWorkbook(
  file: File,
  currentStaff: Staff[],
  options: WorkbookImportOptions = {}
): Promise<WorkbookImport> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: false,
  });
  return parseWorkbook(workbook, currentStaff, options);
}

export function buildConfigWorkbook(state: AppState): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  append(
    workbook,
    "人员信息",
    [
      [
        "编号",
        "姓名",
        "是否可上夜班",
        "状态",
        "备注",
        "人员类型",
        "CX航前资质",
        "值班资质",
        "备勤资质",
        "是否为分队长",
      ],
      ...state.staff.map((person) => [
        person.id,
        person.name,
        person.nightShift ? "是" : "否",
        person.status,
        person.remark,
        person.staffType,
        person.cxPreflightQualified ? "是" : "否",
        person.dutyQualified ? "是" : "否",
        person.standbyQualified ? "是" : "否",
        person.teamLeader ? "是" : "否",
      ]),
    ],
    [10, 14, 16, 10, 24, 14, 14, 14, 14, 16]
  );
  append(
    workbook,
    "航班计划",
    [
      [
        "航班号",
        "开始时间",
        "结束时间",
        "预定人数（当天填写）",
        "涉及岗位（用逗号分隔）",
        "备注",
      ],
      ...state.flights.map((flight) => [
        flight.flightNo,
        flight.startTime,
        flight.endTime,
        flight.bookedPassengers,
        flight.positions.join(","),
        flight.remark,
      ]),
    ],
    [12, 12, 12, 12, 48, 24]
  );
  append(
    workbook,
    "航班配置",
    [
      ["航班号", "开始时间", "结束时间", "涉及岗位（用逗号分隔）", "备注"],
      ...state.templates.map((template) => [
        template.flightNo,
        template.startTime,
        template.endTime,
        template.positions.join(","),
        template.remark,
      ]),
    ],
    [12, 12, 12, 48, 24]
  );
  append(
    workbook,
    "每周航班计划",
    [
      ["星期", "航班号（用逗号分隔）"],
      ...state.weeklyFlightPlans.map((entry) => [
        `星期${["一", "二", "三", "四", "五", "六", "日"][entry.weekday - 1]}`,
        entry.flightNos.join(","),
      ]),
    ],
    [12, 48]
  );
  append(
    workbook,
    "岗位配置",
    [
      [
        "航班号",
        "项目分类",
        "岗位名称",
        "备注",
        "可胜任人员（用逗号分隔）",
        "疲劳点数",
        "启用旅客人数",
        "提前撤岗分钟",
      ],
      ...state.positionRules.map((rule) => [
        rule.flightNo,
        rule.category,
        rule.name,
        rule.remark,
        rule.manual ? "手动输入项" : rule.qualifiedStaffIds.join(","),
        rule.fatiguePoints,
        rule.minPassengers,
        rule.earlyReleaseMinutes,
      ]),
    ],
    [12, 18, 16, 24, 48, 12, 18, 18]
  );
  appendScheduleRuleSheets(workbook, state);
  append(
    workbook,
    "末班重点次数修正",
    [
      ["月份", "人员编号", "航班号", "类别", "修正次数"],
      ...state.latePriorityFrequencyAdjustments.map((item) => [
        item.month,
        item.staffId,
        item.flightNo,
        item.kind,
        item.delta,
      ]),
    ],
    [12, 14, 14, 16, 12]
  );
  return workbook;
}

export function buildScheduleWorkbook(
  assignments: Assignment[],
  date: string
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const flights = [...new Set(assignments.map((item) => item.flightNo))];
  const grouped = flights.map((flightNo) =>
    assignments.filter((item) => item.flightNo === flightNo)
  );
  const maxPositions = Math.max(0, ...grouped.map((items) => items.length));
  const matrix: unknown[][] = [
    flights.flatMap((flightNo, index) => {
      const first = grouped[index]?.[0];
      return [
        `${date}\n岗位`,
        `${flightNo}\n${first?.startTime ?? ""}-${first?.endTime ?? ""}`,
      ];
    }),
  ];
  for (let row = 0; row < maxPositions; row += 1) {
    matrix.push(
      grouped.flatMap((items) => {
        const item = items[row];
        if (!item) return ["", ""];
        const remark = combinedAssignmentRemark(item.remark, item.manualRemark);
        const staff =
          item.staffName || (item.status === "manual" ? "" : "待补位");
        return [item.position, [staff, remark].filter(Boolean).join("\n")];
      })
    );
  }
  const matrixSheet = sheet(
    matrix,
    flights.flatMap(() => [20, 22])
  );
  const range = XLSX.utils.decode_range(matrixSheet["!ref"] ?? "A1");
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell = matrixSheet[address];
      if (!cell) continue;
      cell.s = {
        font: {
          bold: row === 0 || column % 2 === 0,
          color: { rgb: row === 0 ? "FFFFFF" : "1F2328" },
        },
        fill: {
          fgColor: {
            rgb: row === 0 ? "B4232D" : column % 2 === 0 ? "F3F4F6" : "FFFFFF",
          },
        },
        alignment: { vertical: "center", horizontal: "center", wrapText: true },
        border: {
          top: { style: "thin", color: { rgb: "D8DEE4" } },
          bottom: { style: "thin", color: { rgb: "D8DEE4" } },
          left: { style: "thin", color: { rgb: "D8DEE4" } },
          right: { style: "thin", color: { rgb: "D8DEE4" } },
        },
      };
    }
  }
  matrixSheet["!rows"] = [
    { hpt: 42 },
    ...Array.from({ length: maxPositions }, () => ({ hpt: 26 })),
  ];
  XLSX.utils.book_append_sheet(workbook, matrixSheet, "保障明细");
  append(
    workbook,
    "排班结果",
    [
      [
        "日期",
        "航班号",
        "岗位",
        "姓名",
        "开始时间",
        "结束时间",
        "工作时长(小时)",
        "疲劳点数",
        "备注",
        "状态",
      ],
      ...assignments.map((item) => [
        date,
        item.flightNo,
        item.position,
        item.staffName,
        item.startTime,
        item.endTime,
        item.workHours,
        item.fatiguePoints,
        assignmentWarningRemark(
          item.remark,
          item.manualRemark,
          item.manualOverrideWarnings
        ),
        item.status === "assigned"
          ? "已排"
          : item.status === "manual"
            ? "可留空"
            : "待补位",
      ]),
    ],
    [12, 12, 16, 14, 12, 12, 16, 12, 24, 12]
  );
  const people = new Map<string, Assignment[]>();
  assignments
    .filter((item) => item.staffId)
    .forEach((item) =>
      people.set(item.staffName, [...(people.get(item.staffName) ?? []), item])
    );
  append(
    workbook,
    "人员排班",
    [
      [
        "日期",
        "姓名",
        "航班号",
        "岗位",
        "开始时间",
        "结束时间",
        "工作时长(小时)",
      ],
      ...[...people.entries()].flatMap(([name, items]) =>
        items.map((item) => [
          date,
          name,
          item.flightNo,
          item.position,
          item.startTime,
          item.endTime,
          item.workHours,
        ])
      ),
    ],
    [12, 14, 12, 18, 12, 12, 16]
  );
  return workbook;
}

export function writeWorkbook(workbook: XLSX.WorkBook, fileName: string): void {
  XLSX.writeFile(workbook, fileName, { compression: true });
}
