import type { AppState, HistoryRecord } from "../model";
import { recentArchivedWorkdays } from "./fatigue";
import type {
  PreviousWorkdayLoad,
  PreviousWorkdayLoadFacts,
} from "./previous-workday-load-model";
import { isPriorityRotationPosition } from "./position-rotation-policy";
import { timeToMinutes } from "./time";

export type {
  PreviousWorkdayLoad,
  PreviousWorkdayLoadFacts,
} from "./previous-workday-load-model";

const EMPTY_PREVIOUS_WORKDAY_LOAD: PreviousWorkdayLoad = {
  fatiguePoints: 0,
  latestEndMinutes: 0,
  workHours: 0,
  priorityPositionCount: 0,
};

function recordEndMinutes(record: HistoryRecord): number {
  const start = timeToMinutes(record.startTime);
  let end = timeToMinutes(record.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end <= start) end += 24 * 60;
  return end;
}

export function createPreviousWorkdayLoadFacts(
  state: AppState,
  date: string
): PreviousWorkdayLoadFacts {
  const records = recentArchivedWorkdays(state.history, date, 1);
  const previousDate = records[0]?.date ?? null;
  const byStaffId = new Map<string, PreviousWorkdayLoad>();
  for (const record of records) {
    const current = byStaffId.get(record.staffId) ?? {
      ...EMPTY_PREVIOUS_WORKDAY_LOAD,
    };
    current.fatiguePoints += record.fatiguePoints;
    current.latestEndMinutes = Math.max(
      current.latestEndMinutes,
      recordEndMinutes(record)
    );
    current.workHours += record.workHours;
    if (
      isPriorityRotationPosition({
        category: "常规",
        name: record.position,
        remark: record.remark,
      })
    ) {
      current.priorityPositionCount += 1;
    }
    byStaffId.set(record.staffId, current);
  }
  return { date: previousDate, byStaffId };
}

export function previousWorkdayLoadForStaff(
  facts: PreviousWorkdayLoadFacts,
  staffId: string
): PreviousWorkdayLoad {
  return facts.byStaffId.get(staffId) ?? EMPTY_PREVIOUS_WORKDAY_LOAD;
}

export function comparePreviousWorkdayLoad(
  left: PreviousWorkdayLoad,
  right: PreviousWorkdayLoad
): number {
  return (
    left.fatiguePoints - right.fatiguePoints ||
    left.latestEndMinutes - right.latestEndMinutes ||
    left.workHours - right.workHours ||
    left.priorityPositionCount - right.priorityPositionCount
  );
}
