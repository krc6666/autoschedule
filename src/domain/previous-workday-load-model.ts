export interface PreviousWorkdayLoad {
  fatiguePoints: number;
  latestEndMinutes: number;
  workHours: number;
  priorityPositionCount: number;
}

export interface PreviousWorkdayLoadFacts {
  date: string | null;
  byStaffId: ReadonlyMap<string, PreviousWorkdayLoad>;
}
