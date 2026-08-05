import * as XLSX from "xlsx-js-style";

import {
  getMonthlyDutyRoster,
  monthlyDutyDates,
} from "../domain/duty-roster/roster";
import { addIsoDays } from "../domain/shared/time";
import type { AppState, Staff } from "../model";
import { normalizeText } from "../utils";

type Row = unknown[];

export interface ImportedDutyRosterRow {
  date: string;
  standbyDate: string;
  dutyStaffId: string | null;
  standbyStaffIds: [string | null, string | null];
  dutyIncluded?: boolean;
  standbyIncluded?: boolean;
}

export interface DutyRosterImportPreview {
  month: string;
  referenceDate: string;
  rows: ImportedDutyRosterRow[];
  recognizedAssignments: number;
  canApply: boolean;
  warnings: string[];
  errors: string[];
}

function compact(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function parseHeaderDate(value: unknown, targetMonth: string): string | null {
  const text = compact(value);
  if (!text) return null;
  const full = /^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})日?$/.exec(text);
  const monthDay = /^(\d{1,2})[-/.月]?(\d{1,2})日?$/.exec(text);
  const digits = text.replace(/\D/g, "");
  let year = Number(targetMonth.slice(0, 4));
  let month = Number(targetMonth.slice(5, 7));
  let day = 0;
  if (full) {
    year = Number(full[1]);
    month = Number(full[2]);
    day = Number(full[3]);
  } else if (digits.length === 8) {
    year = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    day = Number(digits.slice(6, 8));
  } else if (monthDay) {
    month = Number(monthDay[1]);
    day = Number(monthDay[2]);
  } else if (digits.length === 4) {
    month = Number(digits.slice(0, 2));
    day = Number(digits.slice(2, 4));
  } else if (digits.length === 3) {
    month = Number(digits.slice(0, 1));
    day = Number(digits.slice(1, 3));
  } else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function marker(value: unknown): "duty" | "standby" | "empty" | "unknown" {
  const text = compact(value).toUpperCase();
  if (!text || ["休", "休息"].includes(text)) return "empty";
  if (["24", "24H", "24小时", "值班"].includes(text)) return "duty";
  if (text === "备勤") return "standby";
  return "unknown";
}

function sameDutyCycle(referenceDate: string, date: string): boolean {
  const reference = Date.parse(`${referenceDate}T00:00:00Z`);
  const candidate = Date.parse(`${date}T00:00:00Z`);
  return (
    Number.isFinite(reference) &&
    Number.isFinite(candidate) &&
    Math.abs(Math.round((candidate - reference) / 86_400_000)) % 2 === 0
  );
}

function sheetRows(workbook: XLSX.WorkBook): Row[] | null {
  const sheetName =
    workbook.SheetNames.find(
      (name) => name.includes("值班") && name.includes("备勤")
    ) ??
    workbook.SheetNames.find(
      (name) => name.includes("值班") || name.includes("备勤")
    );
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  return worksheet
    ? XLSX.utils.sheet_to_json<Row>(worksheet, {
        header: 1,
        raw: false,
        defval: "",
      })
    : null;
}

export function parseDutyRosterWorkbook(
  workbook: XLSX.WorkBook,
  staff: Staff[],
  referenceDate: string
): DutyRosterImportPreview {
  const month = referenceDate.slice(0, 7);
  const workDates = monthlyDutyDates(referenceDate);
  const rowsByDate = new Map<string, ImportedDutyRosterRow>(
    workDates.map((date) => [
      date,
      {
        date,
        standbyDate: addIsoDays(date, 1),
        dutyStaffId: null,
        standbyStaffIds: [null, null] as [string | null, string | null],
        dutyIncluded: false,
        standbyIncluded: false,
      },
    ])
  );
  const errors: string[] = [];
  const warnings: string[] = [];
  const data = sheetRows(workbook);
  if (!data) {
    return {
      month,
      referenceDate,
      rows: [...rowsByDate.values()],
      recognizedAssignments: 0,
      canApply: false,
      warnings,
      errors: ["未找到名称包含“值班”或“备勤”的工作表"],
    };
  }

  const headerCandidates = data.slice(0, 20).map((row, rowIndex) => ({
    rowIndex,
    dates: row
      .map((value, columnIndex) => ({
        columnIndex,
        date: parseHeaderDate(value, month),
      }))
      .filter((item): item is { columnIndex: number; date: string } =>
        Boolean(item.date)
      ),
  }));
  const header = headerCandidates.sort(
    (left, right) => right.dates.length - left.dates.length
  )[0];
  if (!header || header.dates.length < 2) {
    return {
      month,
      referenceDate,
      rows: [...rowsByDate.values()],
      recognizedAssignments: 0,
      canApply: false,
      warnings,
      errors: ["未识别到横向日期表头，请使用 MMDD、YYYY-MM-DD 或“月/日”格式"],
    };
  }
  const headerDateSet = new Set(header.dates.map((item) => item.date));
  rowsByDate.forEach((row) => {
    row.dutyIncluded = headerDateSet.has(row.date);
    row.standbyIncluded = headerDateSet.has(row.standbyDate);
  });
  const nameLocation = data
    .slice(0, header.rowIndex + 1)
    .flatMap((row, rowIndex) =>
      row.map((value, columnIndex) => ({
        rowIndex,
        columnIndex,
        value: compact(value),
      }))
    )
    .find((cell) => cell.value.includes("姓名"));
  const nameIndex =
    nameLocation?.columnIndex ?? Math.max(0, header.dates[0]!.columnIndex - 1);
  const staffByName = new Map<string, Staff[]>();
  staff.forEach((person) => {
    const name = compact(person.name);
    staffByName.set(name, [...(staffByName.get(name) ?? []), person]);
  });

  let recognizedAssignments = 0;
  const unknownMarkers: string[] = [];
  for (
    let rowIndex = header.rowIndex + 1;
    rowIndex < data.length;
    rowIndex += 1
  ) {
    const row = data[rowIndex] ?? [];
    const assignments = header.dates
      .map(({ columnIndex, date }) => ({
        date,
        kind: marker(row[columnIndex]),
      }))
      .filter((item) => item.kind === "duty" || item.kind === "standby");
    header.dates.forEach(({ columnIndex, date }) => {
      if (marker(row[columnIndex]) === "unknown")
        unknownMarkers.push(`${date}“${compact(row[columnIndex])}”`);
    });
    if (!assignments.length) continue;
    const name = compact(row[nameIndex]);
    const matches = staffByName.get(name) ?? [];
    if (!name || matches.length !== 1) {
      errors.push(
        matches.length > 1
          ? `姓名“${name}”匹配到多名人员`
          : `未匹配人员“${name || `第${rowIndex + 1}行`}”`
      );
      continue;
    }
    const person = matches[0]!;
    if (person.staffType !== "常规" || person.status !== "正常") {
      errors.push(`${person.name}不是状态正常的常规人员，不能导入值班或备勤`);
      continue;
    }
    for (const assignment of assignments) {
      const workDate =
        assignment.kind === "duty"
          ? assignment.date
          : addIsoDays(assignment.date, -1);
      if (!sameDutyCycle(referenceDate, workDate)) {
        errors.push(
          `${assignment.date}的${assignment.kind === "duty" ? "值班" : "备勤"}不属于当前班组 ${month} 的有效轮值日期`
        );
        continue;
      }
      let target = rowsByDate.get(workDate);
      if (!target) {
        target = {
          date: workDate,
          standbyDate: addIsoDays(workDate, 1),
          dutyStaffId: null,
          standbyStaffIds: [null, null],
          dutyIncluded: headerDateSet.has(workDate),
          standbyIncluded: headerDateSet.has(addIsoDays(workDate, 1)),
        };
        rowsByDate.set(workDate, target);
      }
      if (assignment.kind === "duty") {
        if (!person.dutyQualified) {
          errors.push(
            `${person.name}不具备值班资质，不能安排 ${assignment.date} 值班`
          );
          continue;
        }
        if (target.dutyStaffId && target.dutyStaffId !== person.id) {
          errors.push(`${assignment.date}存在多名值班人员`);
          continue;
        }
        target.dutyStaffId = person.id;
      } else {
        if (!person.standbyQualified) {
          errors.push(
            `${person.name}不具备备勤资质，不能安排 ${assignment.date} 备勤`
          );
          continue;
        }
        const standby = target.standbyStaffIds.filter(Boolean);
        if (standby.includes(person.id)) {
          errors.push(`${assignment.date}重复安排 ${person.name} 备勤`);
          continue;
        }
        const emptyIndex = target.standbyStaffIds.findIndex((id) => !id);
        if (emptyIndex < 0) {
          errors.push(`${assignment.date}超过两名备勤人员`);
          continue;
        }
        target.standbyStaffIds[emptyIndex] = person.id;
      }
      recognizedAssignments += 1;
    }
  }
  for (const row of rowsByDate.values()) {
    if (row.dutyStaffId && row.standbyStaffIds.includes(row.dutyStaffId)) {
      const person = staff.find((item) => item.id === row.dutyStaffId);
      errors.push(
        `${row.date}值班与${row.standbyDate}次日备勤不能由同一人${person ? `（${person.name}）` : ""}承担`
      );
    }
  }
  if (unknownMarkers.length)
    warnings.push(
      `忽略未识别标记：${unknownMarkers.slice(0, 5).join("、")}${unknownMarkers.length > 5 ? "等" : ""}`
    );
  const rowValues = [...rowsByDate.values()]
    .filter((row) => row.dutyIncluded || row.standbyIncluded)
    .sort((left, right) => left.date.localeCompare(right.date));
  const missingDuty = rowValues.filter(
    (row) => row.dutyIncluded && !row.dutyStaffId
  ).length;
  const missingStandby = rowValues.filter(
    (row) =>
      row.standbyIncluded && row.standbyStaffIds.filter(Boolean).length < 2
  ).length;
  if (missingDuty) warnings.push(`本月 ${missingDuty} 个工作日未配置值班人员`);
  if (missingStandby)
    warnings.push(`本月 ${missingStandby} 个次日备勤未满两人`);
  return {
    month,
    referenceDate,
    rows: rowValues,
    recognizedAssignments,
    canApply: recognizedAssignments > 0 && !errors.length,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
  };
}

export async function importDutyRosterWorkbook(
  file: File,
  staff: Staff[],
  referenceDate: string
): Promise<DutyRosterImportPreview> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: false,
  });
  return parseDutyRosterWorkbook(workbook, staff, referenceDate);
}

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function buildDutyRosterTemplateWorkbook(
  state: AppState,
  referenceDate: string
): XLSX.WorkBook {
  const year = Number(referenceDate.slice(0, 4));
  const month = Number(referenceDate.slice(5, 7));
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates = Array.from({ length: dayCount }, (_, index) => index + 1);
  const workDateSet = new Set(monthlyDutyDates(referenceDate));
  const regularStaff = state.staff.filter(
    (person) => person.staffType === "常规"
  );
  const monthlyRoster = getMonthlyDutyRoster(state, referenceDate);
  const dutyStaffByDate = new Map(
    monthlyRoster.map((row) => [row.date, row.dutyStaffId])
  );
  const standbyStaffByDate = new Map(
    monthlyRoster.map((row) => [addIsoDays(row.date, 1), row.standbyStaffIds])
  );
  const data: unknown[][] = [
    [
      `国际值机${year}年${month}月排班、值班、备勤表（本组）`,
      ...Array.from({ length: dayCount + 1 }, () => ""),
    ],
    [
      "序号",
      "姓名",
      ...dates.map(
        (day) => weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
      ),
    ],
    [
      "",
      "",
      ...dates.map(
        (day) =>
          `${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`
      ),
    ],
    ...regularStaff.map((person, index) => [
      index + 1,
      person.name,
      ...dates.map((day) => {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (dutyStaffByDate.get(date) === person.id) return "24";
        if (standbyStaffByDate.get(date)?.includes(person.id)) return "备勤";
        return workDateSet.has(date) ? "" : "休";
      }),
    ]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(data);
  worksheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: dayCount + 1 } },
    { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
    { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },
  ];
  worksheet["!cols"] = [
    { wch: 6 },
    { wch: 12 },
    ...dates.map(() => ({ wch: 6 })),
  ];
  worksheet["!rows"] = [
    { hpt: 28 },
    { hpt: 22 },
    { hpt: 22 },
    ...regularStaff.map(() => ({ hpt: 24 })),
  ];
  const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1");
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const cell =
        worksheet[address] ?? (worksheet[address] = { t: "s", v: "" });
      const value = compact(cell.v);
      const isTitle = row === 0;
      const isHeader = row === 1 || row === 2;
      const isStandby = value === "备勤";
      const isDuty = value === "24" || value === "值班";
      const isRest = value === "休";
      cell.s = {
        font: {
          bold: isTitle || isHeader || column < 2,
          sz: isTitle ? 15 : 10,
          color: { rgb: isDuty ? "C00000" : "1F2328" },
        },
        fill: {
          fgColor: {
            rgb: isStandby
              ? "F8CBAD"
              : isRest
                ? "EAF3F3"
                : isHeader
                  ? "F2F2F2"
                  : "FFFFFF",
          },
        },
        alignment: { vertical: "center", horizontal: "center", wrapText: true },
        border: {
          top: { style: "thin", color: { rgb: "808080" } },
          bottom: { style: "thin", color: { rgb: "808080" } },
          left: { style: "thin", color: { rgb: "808080" } },
          right: { style: "thin", color: { rgb: "808080" } },
        },
      };
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "值班备勤表");
  return workbook;
}
