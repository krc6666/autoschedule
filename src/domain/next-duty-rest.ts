import type { AppState, PositionRule } from "../model";
import { getDutyRosterForDate } from "./duty-roster";
import {
  isPriorityRotationPosition,
  PRIORITY_ROTATION_POSITION_KEYWORDS,
} from "./position-rotation-policy";
import { addIsoDays } from "./time";

export interface NextDutyRestProtection {
  nextWorkdayDate: string;
  dutyStaffId: string | null;
}

export function nextDutyRestProtection(
  state: AppState,
  date: string
): NextDutyRestProtection {
  const nextWorkdayDate = addIsoDays(date, 2);
  return {
    nextWorkdayDate,
    dutyStaffId: state.settings.nextDutyRestProtectionEnabled
      ? getDutyRosterForDate(state, nextWorkdayDate).dutyStaffId
      : null,
  };
}

export function isNextDutyRestConflict(
  state: AppState,
  staffId: string,
  rule: Pick<PositionRule, "category" | "name" | "remark">,
  date: string,
  protection?: NextDutyRestProtection
): boolean {
  const resolvedProtection = protection ?? nextDutyRestProtection(state, date);
  return Boolean(
    resolvedProtection.dutyStaffId === staffId &&
    isNextDutyRestPriorityPosition(rule)
  );
}

export function isNextDutyRestPriorityPosition(
  rule: Pick<PositionRule, "category" | "name" | "remark">
): boolean {
  if (isPriorityRotationPosition(rule)) return true;
  if (rule.category !== "机动督导") return false;
  const searchable = `${rule.name} ${rule.remark}`;
  return PRIORITY_ROTATION_POSITION_KEYWORDS.some((keyword) =>
    searchable.includes(keyword)
  );
}
