import type { SolverTermination } from "./solver-port";

export function dailyScheduleFailureMessage(
  termination: SolverTermination,
  diagnostics: readonly string[] = []
): string {
  if (termination === "timed-out")
    return "当天排班计算超过允许时间（最长5分钟），请重试";
  if (termination === "infeasible" && diagnostics.length)
    return `当天无法生成完整班表。${diagnostics.join(" ")}`;
  if (termination === "infeasible")
    return "当天无法生成完整班表，请检查人员状态、岗位资质、夜班能力、时间冲突和工时上限";
  return "当天排班计算未完成，请重试";
}
