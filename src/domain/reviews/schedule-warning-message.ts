import type { Assignment } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import { assignmentRule } from "../flights/schedule-position-rules";
import { previousWorkdayLateProtection } from "./cross-day-recovery";

export interface AssignmentWarningMessageOptions {
  staffName: string;
  fact: string;
  reasons: readonly string[];
  decision?: string;
  result?: string;
  attempt?: string;
}

export const FAIRNESS_TIME_LIMITED_WARNING =
  "班表已满足全部硬性要求和核心排班规则；人员恢复与公平已在可用时间内尽量优化，仍可能存在小幅改善空间。";

export const FAIRNESS_GAP_LIMITED_WARNING =
  "班表已满足全部硬性要求和核心排班规则；人员恢复与公平已优化到允许的小幅差距内。";

export const FAIRNESS_USER_STOPPED_WARNING =
  "班表已满足全部硬性要求和核心排班规则；人员恢复与公平只采用了停止时已经完成的优化结果。";

export function scheduleOptimizationWarning(
  quality:
    | "all-objectives-optimal"
    | "fairness-gap-limited"
    | "fairness-time-limited"
    | "fairness-user-stopped"
): string | null {
  if (quality === "fairness-user-stopped") return FAIRNESS_USER_STOPPED_WARNING;
  if (quality === "fairness-time-limited") return FAIRNESS_TIME_LIMITED_WARNING;
  if (quality === "fairness-gap-limited") return FAIRNESS_GAP_LIMITED_WARNING;
  return null;
}

function mappedReason(reason: string): string | null {
  const normalized = reason.trim();
  if (!normalized) return null;
  if (/求解目标|结束状态|infeasible|changed-assignment-count/i.test(normalized))
    return null;
  if (/人工调整/.test(normalized)) return "人工调整后仍连续承担";
  if (/时间上限|timed-out/i.test(normalized)) return "换人计算时间不足";
  if (/半休/.test(normalized)) return "其他资质人员已安排半休";
  if (/唯一合格|无其他具备.*资质|没有具备连续腾挪岗位资质/.test(normalized))
    return "唯一合格人员";
  if (/双向岗位资质|完整资质|不具备.*资质|资质/.test(normalized))
    return "其他人员资质不匹配";
  if (/状态为|病假|休假|不在岗/.test(normalized)) return "其他人员不在岗";
  if (/行政支援|常规人员/.test(normalized)) return "其他常规人员不可用";
  if (/夜班/.test(normalized)) return "其他人员不能上夜班";
  if (/时间冲突|该时段已有排班/.test(normalized)) return "其他人员时间冲突";
  if (/工时/.test(normalized) && /疲劳差|扩大/.test(normalized))
    return "换人会扩大工时或疲劳差";
  if (/工时/.test(normalized)) return "其他人员会超过工时上限";
  if (/值班上午/.test(normalized)) return "值班上午上岗要求优先";
  if (/值班晚撤/.test(normalized)) return "值班晚撤岗位必须保留";
  if (/值班.*KE166|KE166.*值班/.test(normalized))
    return "其他人员承担值班或KE166固定岗位";
  if (/值班/.test(normalized)) return "值班安排必须保留";
  if (/没有其他.*机动督导/.test(normalized)) return "没有其他合格的机动督导";
  if (/KE166|机动督导/.test(normalized)) return "KE166固定岗位必须保留";
  if (/衔接/.test(normalized)) return "其他人员岗位衔接不满足要求";
  if (/恢复|疲劳保护|受保护/.test(normalized)) return "其他人员处于恢复保护";
  if (/频率/.test(normalized)) return "换人会破坏其他重点岗位轮换";
  if (/连续轮岗问题转移|连续承担/.test(normalized))
    return "换人会让其他人员连续承担";
  if (/岗位空缺|岗位完整|新空缺|不可替代/.test(normalized))
    return "换人会造成其他岗位空缺";
  if (/参与|人数/.test(normalized)) return "需要调整的人员过多";
  if (/下班时间没有提前/.test(normalized)) return "换人后仍不能提前下班";
  if (/前序排班安排优先|未能改由最低频人员/.test(normalized))
    return "前序排班安排优先";
  if (/没有满足全部安全约束|完整重排方案|整体重排方案/.test(normalized))
    return "没有可安全接替的人员";
  return null;
}

export function conciseAssignmentWarningReason(
  reasons: readonly string[]
): string {
  const readable = [
    ...new Set(
      reasons
        .map(mappedReason)
        .filter((reason): reason is string => Boolean(reason))
    ),
  ];
  const specific =
    readable.length > 1
      ? readable.filter((reason) => reason !== "唯一合格人员")
      : readable;
  return specific.length
    ? specific.slice(0, 2).join("、")
    : "没有可安全接替的人员";
}

export function assignmentWarningMessage({
  staffName,
  fact,
  reasons,
  decision = "岗位完整性优先",
  result = "保留原安排",
  attempt = "本次尝试换人但无替代人选",
}: AssignmentWarningMessageOptions): string {
  return `${staffName} ${fact}，${attempt}（${conciseAssignmentWarningReason(reasons)}）。${decision}，${result}。`;
}
export interface RotationWarningCandidate {
  staffName: string;
  reasons: readonly string[];
  previousLateWork?: { date: string; flightNo: string };
}

export function rotationWarningCandidates(
  state: ScheduleGenerationFacts,
  primary: Assignment,
  date: string,
  rejections: readonly { staffId: string; reasons: readonly string[] }[],
  facts?: ScheduleRunFacts
): RotationWarningCandidate[] {
  const rule = assignmentRule(state, primary);
  if (!rule) return [];
  const protectedRecords = (
    facts?.crossDayRecovery.previousWorkday ??
    previousWorkdayLateProtection(state, date)
  ).protectedRecords;
  return state.staff
    .filter(
      (person) =>
        person.id !== primary.staffId &&
        rule.qualifiedStaffIds.includes(person.id)
    )
    .map((person) => ({
      staffName: person.name,
      reasons:
        person.status !== "正常" || person.staffType !== "常规"
          ? [
              `该人员今天${person.status !== "正常" ? person.status : "不是常规人员"}`,
            ]
          : rejections
              .filter((item) => item.staffId === person.id)
              .flatMap((item) => item.reasons),
      previousLateWork: protectedRecords.find(
        (record) => record.staffId === person.id
      ),
    }));
}

function plainRotationReason(
  candidate: RotationWarningCandidate,
  targetFlightNo: string,
  timedOut: boolean
): string {
  const reason = candidate.reasons[0];
  if (!reason)
    return timedOut
      ? "这次还没算出完整换法，不能确定是否能接"
      : "单看这个岗位可以尝试，但没找到不影响其他岗位的完整换法";
  if (/严格跨工作日恢复/.test(reason)) {
    const record = candidate.previousLateWork;
    if (record) {
      const [, month, day] = record.date.match(/^\d{4}-(\d{2})-(\d{2})$/) ?? [];
      const date =
        month && day ? `${Number(month)}/${Number(day)}` : record.date;
      return `${date} 做过 ${record.flightNo} 末班岗，下一班不能接 ${targetFlightNo}`;
    }
    return `上一班做过末班岗，下一班不能接 ${targetFlightNo}`;
  }
  if (/夜班/.test(reason)) return "不能上夜班";
  if (/不具备.*资质|资质不匹配/.test(reason)) return "没有这个岗位所需的资质";
  if (/病假|休假|不在岗|不是常规/.test(reason)) return "今天不在可安排人员中";
  if (/时间冲突|该时段|已有排班/.test(reason)) return "这个时段已经有别的班";
  if (/工时/.test(reason)) return "换上后当天工时会超出上限";
  if (/半休/.test(reason)) return "今天的半休时段不能上这个岗位";
  if (/值班|锁定/.test(reason)) return "今天已经承担不能移动的岗位";
  if (/连续/.test(reason)) return "换上后仍会连续做这个岗位";
  if (/衔接/.test(reason)) return "与前后岗位的间隔不够";
  if (/恢复|截止/.test(reason)) return "上一班较晚结束，这班需要休息";
  return "这次换岗会影响其他岗位的安排";
}

export function rotationCandidateWarningMessage({
  staffName,
  fact,
  targetFlightNo,
  candidates,
  timedOut,
}: {
  staffName: string;
  fact: string;
  targetFlightNo: string;
  candidates: readonly RotationWarningCandidate[];
  timedOut: boolean;
}): string {
  const lines = candidates.map(
    (candidate) =>
      `${candidate.staffName} —— ${plainRotationReason(candidate, targetFlightNo, timedOut)}`
  );
  const conclusion = timedOut
    ? "这次自动排班没来得及算出完整换法，原安排保留。"
    : candidates.length === 0
      ? "当前没有第二位具备这个岗位资质的人，原安排保留。"
      : "这次自动排班没有找到能完成的换人办法，原安排保留。";
  return [`${staffName} ${fact}。`, ...lines, conclusion].join("\n");
}

export function plainSwapAnalysisReason(reason: string): string {
  if (/跨工作日.*恢复|恢复保护/.test(reason))
    return "上一班做过较晚结束的岗位，手工换岗后要留意休息时间";
  if (/候选排除/.test(reason)) return "这个岗位目前找不到合适的换岗人员";
  if (/连续轮岗|连续承担/.test(reason))
    return "换完后可能让另一人连续做同一岗位";
  if (/频率均衡|同岗频率/.test(reason))
    return "换完后同一岗位的承担次数可能更不均匀";
  if (/跨工作班负荷互补|扩大工时或疲劳差/.test(reason))
    return "换完后有人可能更累，或当天工时差更大";
  if (/高负荷疲劳保护|滚动负荷保护/.test(reason))
    return "换完后有人可能连续承担较累的岗位";
  if (/本月已承担2次TR121一号/.test(reason))
    return "这名人员本月已做过两次 TR121 一号";
  if (/双向岗位资质|不具备.*资质/.test(reason))
    return "交换双方都需要有对方岗位的资质";
  if (/衔接/.test(reason)) return "前后航班间隔不够";
  if (/工时/.test(reason)) return "换完后有人可能超过当天的工时上限";
  return reason;
}
