import type { AssignmentTask } from "../flights/schedule-tasks";

export interface DutyTargetTracker {
  readonly allTaskKeys: ReadonlySet<string>;
  activeTaskKeys(): ReadonlySet<string>;
  activeLateTaskKey(): string | null;
  assignedLateTaskKey(): string | null;
  isTarget(taskKey: string): boolean;
  shouldReserveForPendingTarget(taskKey: string): boolean;
  settle(taskKey: string, selectedStaffId: string | null): void;
  markLateTaskAssigned(taskKey: string): void;
  hasAssignedLateTask(): boolean;
}

export interface DutyTargetTrackerOptions {
  dutyStaffId: string | null;
  morningTaskKey: string | null;
  lateTaskCandidates: readonly AssignmentTask[];
  processedTaskKeys: ReadonlySet<string>;
}

export function createDutyTargetTracker({
  dutyStaffId,
  morningTaskKey,
  lateTaskCandidates,
  processedTaskKeys,
}: DutyTargetTrackerOptions): DutyTargetTracker {
  let activeLateIndex = 0;
  let assignedLateKey: string | null = null;
  const allTaskKeys = new Set(
    [morningTaskKey, ...lateTaskCandidates.map((task) => task.key)].filter(
      (key): key is string => Boolean(key)
    )
  );
  const activeLateTaskKey = (): string | null =>
    assignedLateKey ?? lateTaskCandidates[activeLateIndex]?.key ?? null;
  const activeTaskKeys = (): ReadonlySet<string> =>
    new Set(
      [morningTaskKey, activeLateTaskKey()].filter((key): key is string =>
        Boolean(key)
      )
    );

  return Object.freeze({
    allTaskKeys,
    activeTaskKeys,
    activeLateTaskKey,
    assignedLateTaskKey: () => assignedLateKey,
    isTarget: (taskKey: string) =>
      Boolean(
        dutyStaffId &&
        (taskKey === morningTaskKey ||
          (!assignedLateKey && taskKey === activeLateTaskKey()))
      ),
    shouldReserveForPendingTarget: (taskKey: string) =>
      Boolean(
        dutyStaffId &&
        !assignedLateKey &&
        taskKey !== morningTaskKey &&
        !activeTaskKeys().has(taskKey) &&
        activeLateTaskKey() &&
        !processedTaskKeys.has(activeLateTaskKey()!)
      ),
    settle: (taskKey: string, selectedStaffId: string | null) => {
      if (assignedLateKey || taskKey !== activeLateTaskKey()) return;
      if (selectedStaffId === dutyStaffId) assignedLateKey = taskKey;
      else activeLateIndex += 1;
    },
    markLateTaskAssigned: (taskKey: string) => {
      assignedLateKey = taskKey;
    },
    hasAssignedLateTask: () => Boolean(assignedLateKey),
  });
}
