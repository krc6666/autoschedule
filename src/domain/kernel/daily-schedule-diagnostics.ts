import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { diagnoseBaseAssignmentEligibility } from "../candidates/assignment-eligibility";
import { isStrictNextWorkdayRecoveryTarget } from "../reviews/cross-day-recovery";
import type { AssignmentTask } from "../flights/schedule-tasks";
import type { LinearConstraint } from "../solver/solver-port";
import type { DailyScheduleModel } from "./daily-schedule-model";
import type { SchedulePreparation } from "./schedule-preparation";

export interface DailyScheduleFailureDiagnosticsOptions {
  state: ScheduleGenerationFacts;
  preparation: SchedulePreparation;
  model: DailyScheduleModel;
}

function taskLabel(task: AssignmentTask): string {
  return `${task.flight.flightNo}/${task.rule.name}`;
}

function isPairBlocked(
  constraints: readonly LinearConstraint[],
  leftId: string,
  rightId: string
): boolean {
  return constraints.some(
    (constraint) =>
      constraint.upperBound === 1 &&
      constraint.terms.some((term) => term.variableId === leftId) &&
      constraint.terms.some((term) => term.variableId === rightId)
  );
}

function strictTaskDiagnostics({
  state,
  preparation,
  model,
}: DailyScheduleFailureDiagnosticsOptions): string[] {
  const protectedStaffIds =
    preparation.runFacts.crossDayRecovery.previousWorkday.protectedStaffIds;
  const strictTasks = preparation.tasks.filter((task) =>
    isStrictNextWorkdayRecoveryTarget(state, {
      flightNo: task.flight.flightNo,
      position: task.rule.name,
      remark: task.rule.remark,
    })
  );
  const diagnostics: string[] = [];
  const choicesByTask = new Map(
    strictTasks.map((task) => [
      task.key,
      model.staffChoices.filter((choice) => choice.task.key === task.key),
    ])
  );

  for (const task of strictTasks) {
    const baseEligible = state.staff.filter(
      (person) =>
        diagnoseBaseAssignmentEligibility(state, task.flight, task.rule, person)
          .eligible
    );
    const choices = choicesByTask.get(task.key) ?? [];
    if (choices.length > 0) continue;
    const protectedCount = baseEligible.filter((person) =>
      protectedStaffIds.has(person.id)
    ).length;
    const reason =
      baseEligible.length === 0
        ? "没有人员同时满足在岗状态、岗位资质和夜班能力"
        : protectedCount === baseEligible.length
          ? `基础合格的 ${baseEligible.length} 人全部被上一班末班重点岗位避让排除`
          : `基础合格 ${baseEligible.length} 人，但严格恢复过滤后剩余 0 人`;
    diagnostics.push(
      `${taskLabel(task)}：严格次班恢复禁止空缺，${reason}。可检查“次班重点岗位避让”的目标航班/岗位、严格/优先模式，或上一班末班重点岗位记录。`
    );
  }

  const blockingConstraints = model.problem.constraints.filter(
    (constraint) =>
      constraint.upperBound === 1 &&
      (constraint.id.startsWith("overlap:") ||
        constraint.id.startsWith("minimum-transition:") ||
        constraint.id.startsWith("same-flight:"))
  );
  for (let leftIndex = 0; leftIndex < strictTasks.length; leftIndex += 1) {
    const left = strictTasks[leftIndex]!;
    const leftChoices = choicesByTask.get(left.key) ?? [];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < strictTasks.length;
      rightIndex += 1
    ) {
      const right = strictTasks[rightIndex]!;
      const rightChoices = choicesByTask.get(right.key) ?? [];
      if (!leftChoices.length || !rightChoices.length) continue;
      const compatiblePair = leftChoices.some((leftChoice) =>
        rightChoices.some(
          (rightChoice) =>
            leftChoice.person.id !== rightChoice.person.id ||
            !isPairBlocked(blockingConstraints, leftChoice.id, rightChoice.id)
        )
      );
      if (compatiblePair) continue;
      diagnostics.push(
        `${taskLabel(left)} 与 ${taskLabel(right)}：严格恢复都禁止空缺，但现有候选无法同时承担，疑似时间冲突、最小航班衔接不足或同航班重复占位。可检查这两个航班的时段、最小衔接分钟和岗位资质配置。`
      );
    }
  }

  return diagnostics;
}

function strictCapacityDiagnostics({
  state,
  preparation,
  model,
}: DailyScheduleFailureDiagnosticsOptions): string[] {
  const strictTasks = preparation.tasks.filter((task) =>
    isStrictNextWorkdayRecoveryTarget(state, {
      flightNo: task.flight.flightNo,
      position: task.rule.name,
      remark: task.rule.remark,
    })
  );
  const diagnostics: string[] = [];
  for (const person of state.staff) {
    const choices = strictTasks.flatMap((task) =>
      model.staffChoices.filter(
        (choice) =>
          choice.task.key === task.key && choice.person.id === person.id
      )
    );
    if (
      choices.length < 2 ||
      choices.some(
        (choice) =>
          model.staffChoices.filter(
            (candidate) => candidate.task.key === choice.task.key
          ).length !== 1
      )
    )
      continue;
    const totalHours = choices.reduce(
      (sum, choice) => sum + choice.workHours,
      0
    );
    if (totalHours <= state.settings.maxDailyHours) continue;
    const labels = [
      ...new Set(choices.map((choice) => taskLabel(choice.task))),
    ];
    diagnostics.push(
      `${labels.join("、")}：严格恢复候选集中只有${person.name}可用，合计 ${totalHours.toFixed(2)} 小时会超过每日 ${state.settings.maxDailyHours} 小时上限。可增加对应岗位合格人员、调整航班/岗位时段，或核对每日工时上限配置。`
    );
  }
  return diagnostics;
}

export function diagnoseDailyScheduleFailure(
  options: DailyScheduleFailureDiagnosticsOptions
): string[] {
  const diagnostics = [
    ...strictTaskDiagnostics(options),
    ...strictCapacityDiagnostics(options),
  ];
  if (diagnostics.length) return [...new Set(diagnostics)].slice(0, 4);

  const taskWithNoBaseCandidate = options.preparation.tasks.find(
    (task) => (options.preparation.eligibleCounts.get(task.key) ?? 0) === 0
  );
  if (taskWithNoBaseCandidate) {
    return [
      `${taskLabel(taskWithNoBaseCandidate)}：没有人员同时满足在岗状态、岗位资质和夜班能力；普通岗位允许显示空缺，但请检查人员状态、岗位资质和夜班能力配置。`,
    ];
  }
  return [
    "未定位到单个岗位的直接阻塞项，可能是多个岗位的时间冲突、最小航班衔接或组合容量共同造成；请优先检查同一人员被安排的重叠航班、最小衔接分钟和每日工时上限。",
  ];
}
