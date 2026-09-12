import type { Assignment, ScheduleResult } from "../../model";
import type { ScheduleGuardContext } from "./schedule-guard";

export interface ScheduleSafetyCredential {
  readonly kind: "schedule-safety-credential";
  readonly phase: "final";
  readonly date: string;
  readonly assignmentsFingerprint: string;
  readonly contextFingerprint: string;
  readonly integrityFingerprint: string;
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function contextFingerprint(context: ScheduleGuardContext): string {
  const halfRest = context.halfRestFacts;
  return fingerprint({
    phase: context.phase,
    halfRestFacts: halfRest
      ? {
          requestedStaffIds: [...halfRest.requestedStaffIds],
          activeStaffIds: [...halfRest.activeStaffIds].sort(),
          minimumWorkStaffIds: [...halfRest.minimumWorkStaffIds].sort(),
          ignoredWarnings: [...halfRest.ignoredWarnings],
          modesByStaffId: [...halfRest.modesByStaffId.entries()].sort(
            ([a], [b]) => a.localeCompare(b)
          ),
          earlyFinishStaffIds: [...halfRest.earlyFinishStaffIds].sort(),
          lateStartStaffIds: [...halfRest.lateStartStaffIds].sort(),
        }
      : undefined,
  });
}

export function createScheduleSafetyCredential(options: {
  date: string;
  assignments: readonly Assignment[];
  context: ScheduleGuardContext;
}): ScheduleSafetyCredential {
  if (options.context.phase !== "final") {
    throw new Error("安全凭证只能由 final 阶段生成");
  }
  return Object.freeze({
    kind: "schedule-safety-credential" as const,
    phase: "final" as const,
    date: options.date,
    assignmentsFingerprint: fingerprint(options.assignments),
    contextFingerprint: contextFingerprint(options.context),
    integrityFingerprint: fingerprint({
      kind: "schedule-safety-credential",
      phase: "final",
      date: options.date,
      assignmentsFingerprint: fingerprint(options.assignments),
      contextFingerprint: contextFingerprint(options.context),
    }),
  });
}

export function assertScheduleSafetyCredential(options: {
  date: string;
  result: ScheduleResult;
}): void {
  const credential = options.result.safetyCredential;
  if (!credential) throw new Error("排班结果缺少安全凭证，拒绝安装");
  if (
    credential.kind !== "schedule-safety-credential" ||
    credential.phase !== "final" ||
    credential.date !== options.date ||
    credential.assignmentsFingerprint !==
      fingerprint(options.result.assignments) ||
    !credential.contextFingerprint ||
    credential.integrityFingerprint !==
      fingerprint({
        kind: credential.kind,
        phase: credential.phase,
        date: credential.date,
        assignmentsFingerprint: credential.assignmentsFingerprint,
        contextFingerprint: credential.contextFingerprint,
      })
  ) {
    throw new Error("排班结果安全凭证无效或上下文不一致，拒绝安装");
  }
}
