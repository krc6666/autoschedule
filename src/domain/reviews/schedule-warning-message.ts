export interface AssignmentWarningMessageOptions {
  staffName: string;
  fact: string;
  reasons: readonly string[];
  decision?: string;
  result?: string;
  attempt?: string;
}

function mappedReason(reason: string): string | null {
  const normalized = reason.trim();
  if (!normalized) return null;
  if (/求解目标|结束状态|infeasible|changed-assignment-count/i.test(normalized))
    return null;
  if (/人工调整/.test(normalized)) return "人工调整后仍连续承担";
  if (/时间上限|timed-out/i.test(normalized)) return "换人计算时间不足";
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
  if (/下个工作班值班人员/.test(normalized))
    return "下个工作班值班人员需要预休";
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
