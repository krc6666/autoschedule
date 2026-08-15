import type { IsoWeekday, WeeklyFlightPlanEntry } from "../../model";

export const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

const WEEKDAY_LABELS: Record<IsoWeekday, string> = {
  1: "星期一",
  2: "星期二",
  3: "星期三",
  4: "星期四",
  5: "星期五",
  6: "星期六",
  7: "星期日",
};

export function normalizeWeeklyFlightNo(value: string): string {
  return value.trim().replaceAll(/\s+/g, "").toUpperCase();
}

function normalizedFlightNos(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeWeeklyFlightNo).filter(Boolean))];
}

export function createEmptyWeeklyFlightPlans(): WeeklyFlightPlanEntry[] {
  return ISO_WEEKDAYS.map((weekday) => ({ weekday, flightNos: [] }));
}

export function replaceWeeklyFlightPlan(
  plans: readonly WeeklyFlightPlanEntry[],
  weekday: IsoWeekday,
  flightNos: readonly string[]
): WeeklyFlightPlanEntry[] {
  const byWeekday = new Map(
    plans.map((entry) => [entry.weekday, normalizedFlightNos(entry.flightNos)])
  );
  byWeekday.set(weekday, normalizedFlightNos(flightNos));
  return ISO_WEEKDAYS.map((day) => ({
    weekday: day,
    flightNos: [...(byWeekday.get(day) ?? [])],
  }));
}

export function replaceWeeklyFlightNumber(
  plans: readonly WeeklyFlightPlanEntry[],
  previousFlightNo: string,
  nextFlightNo: string
): WeeklyFlightPlanEntry[] {
  const previous = normalizeWeeklyFlightNo(previousFlightNo);
  const next = normalizeWeeklyFlightNo(nextFlightNo);
  return ISO_WEEKDAYS.reduce(
    (result, weekday) =>
      replaceWeeklyFlightPlan(
        result,
        weekday,
        (result.find((entry) => entry.weekday === weekday)?.flightNos ?? [])
          .map((flightNo) =>
            normalizeWeeklyFlightNo(flightNo) === previous ? next : flightNo
          )
          .filter(Boolean)
      ),
    [...plans]
  );
}

export function isoWeekdayForDate(date: string): IsoWeekday {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()))
    throw new Error(`无效日期：${date}`);
  const day = parsed.getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

export function weekdayLabel(weekday: IsoWeekday): string {
  return WEEKDAY_LABELS[weekday];
}

export function flightNumbersForDate(
  plans: readonly WeeklyFlightPlanEntry[],
  date: string
): string[] {
  const weekday = isoWeekdayForDate(date);
  return normalizedFlightNos(
    plans.find((entry) => entry.weekday === weekday)?.flightNos ?? []
  );
}
