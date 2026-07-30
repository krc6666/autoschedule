import type { AppState, Assignment, Staff } from "../model";
import {
  comparePositionFrequency,
  consecutivePositionAssignments,
  createScheduleFrequencyFacts,
  samePositionFrequencyProfile,
  type ScheduleFrequencyFacts,
} from "./schedule-frequency";
import { assignmentRule } from "./schedule-position-rules";
import { eligibleStaffForRule } from "./assignment-eligibility";
import {
  applyRotationCycleStaff,
  isRotationLocked,
  reassignmentSafetyReasons,
  rotationCandidateAssignments,
} from "./rotation-review-safety";
import {
  isHighFatigueOrdinaryRotationPosition,
  isPriorityRotationPosition,
} from "./position-rotation-policy";
import { schedulingDecision } from "../schedule-rule-contract";
import type { ScheduleRunFacts } from "./schedule-run-facts";
import { historyFatigue } from "./fatigue";
import { countedWorkloadAssignments } from "./workload-accounting";
import {
  comparePreviousWorkdayLoad,
  createPreviousWorkdayLoadFacts,
  previousWorkdayLoadForStaff,
} from "./previous-workday-load";
import { reviewKe166GroupRotation } from "./ke166-rotation-review";
import {
  rebuildAutomaticAssignmentEvidence,
  replaceAssignmentDecisions,
} from "./assignment-evidence";
import type { OpenRotationChain } from "./rotation-open-chain-search";
import { isInFinalLateBatch } from "./cross-day-recovery";
import { findConsecutiveRotationPlan } from "./consecutive-rotation-plan";
import { applyConfiguredEarlyReleases } from "./assignment-timing";

function configuredForAssignment(
  state: AppState,
  assignment: Assignment,
  staffId: string
): boolean {
  return (
    assignmentRule(state, assignment)?.qualifiedStaffIds.includes(staffId) ??
    false
  );
}

type RotationKind = "priority" | "high-fatigue" | "ordinary";

function rotationKind(state: AppState, assignment: Assignment): RotationKind {
  const rule = assignmentRule(state, assignment)!;
  if (isPriorityRotationPosition(rule)) return "priority";
  return isHighFatigueOrdinaryRotationPosition(
    rule,
    state.settings.highLoadFatigueThreshold
  )
    ? "high-fatigue"
    : "ordinary";
}

function rotationKindOrder(kind: RotationKind): number {
  if (kind === "priority") return 0;
  if (kind === "high-fatigue") return 1;
  return 2;
}

function targetStaffOrder(
  state: AppState,
  assignments: Assignment[],
  primary: Assignment,
  date: string,
  facts?: ScheduleRunFacts,
  frequencyFacts?: ScheduleFrequencyFacts
): (leftId: string, rightId: string) => number {
  const countedAssignments = countedWorkloadAssignments(state, assignments);
  const previousLoadFacts =
    facts?.previousWorkdayLoad ?? createPreviousWorkdayLoadFacts(state, date);
  const loadByStaffId = new Map(
    state.staff.map((person) => {
      const ownAssignments = countedAssignments.filter(
        (assignment) => assignment.staffId === person.id
      );
      return [
        person.id,
        {
          historyFatigue: historyFatigue(
            state.history,
            person.id,
            date,
            state.settings
          ),
          todayWorkHours: ownAssignments.reduce(
            (sum, assignment) => sum + assignment.workHours,
            0
          ),
          todayFatigue:
            ownAssignments.reduce(
              (sum, assignment) => sum + assignment.fatiguePoints,
              0
            ) +
            (facts?.currentDutyStaffId === person.id
              ? state.settings.dutyFatiguePoints
              : 0),
        },
      ];
    })
  );
  return (leftId, rightId) => {
    const leftLoad = loadByStaffId.get(leftId)!;
    const rightLoad = loadByStaffId.get(rightId)!;
    return (
      comparePreviousWorkdayLoad(
        previousWorkdayLoadForStaff(previousLoadFacts, leftId),
        previousWorkdayLoadForStaff(previousLoadFacts, rightId)
      ) ||
      comparePositionFrequency(
        samePositionFrequencyProfile(
          state,
          leftId,
          primary.flightNo,
          primary.position,
          date,
          frequencyFacts
        ),
        samePositionFrequencyProfile(
          state,
          rightId,
          primary.flightNo,
          primary.position,
          date,
          frequencyFacts
        )
      ) ||
      leftLoad.historyFatigue - rightLoad.historyFatigue ||
      leftLoad.todayWorkHours - rightLoad.todayWorkHours ||
      leftLoad.todayFatigue - rightLoad.todayFatigue ||
      state.staff.findIndex((person) => person.id === leftId) -
        state.staff.findIndex((person) => person.id === rightId) ||
      leftId.localeCompare(rightId, undefined, { numeric: true })
    );
  };
}

function applyDirectRotation(
  state: AppState,
  assignments: Assignment[],
  primary: Assignment,
  staffId: string,
  staffName: string,
  runs: number
): void {
  const originalName = primary.staffName;
  const message = `${originalName}已连续${runs === 1 ? "一" : "两"}个工作班承担${primary.flightNo}/${primary.position}，本班已由该时段空闲的合格人员${staffName}直接接替；原人员仍有其他实际岗位，岗位完整性及全部安全约束验证通过。`;
  primary.staffId = staffId;
  primary.staffName = staffName;
  applyConfiguredEarlyReleases(assignments, state, new Set([staffId]));
  rebuildAutomaticAssignmentEvidence(primary, [
    schedulingDecision("position-rotation", "selected", message),
  ]);
}

function applyConsecutiveRotationCycle(
  state: AppState,
  assignments: Assignment[],
  cycle: Assignment[],
  previousRuns: number[],
  fatigueRelief = false,
  recoveryFallbackMessage?: string
): void {
  const originalPrimaryFatigue = cycle[0]!.fatiguePoints;
  const reliefAssignment = cycle[cycle.length - 1]!;
  const original = applyRotationCycleStaff(cycle);
  applyConfiguredEarlyReleases(
    assignments,
    state,
    new Set(
      cycle.flatMap((assignment) =>
        assignment.staffId ? [assignment.staffId] : []
      )
    )
  );
  const primary = original[0]!;
  const route =
    cycle.length === 2
      ? `已与${original[1]!.staffName}的${original[1]!.flightNo}/${original[1]!.position}交换`
      : `已通过${original.map((item) => `${item.staffName}:${item.flightNo}/${item.position}`).join(" → ")}的${cycle.length}个岗位闭环交换`;
  const message = fatigueRelief
    ? `${primary.staffName}已连续${previousRuns[0] === 1 ? "一" : "两"}个工作班承担${primary.flightNo}/${primary.position}，无法彻底退出晚班时，本班${route}，从${originalPrimaryFatigue}点重点岗位换到${reliefAssignment.fatiguePoints}点普通岗位；跨工作日恢复和次班截止仅对这次明确降疲劳改善让步，其余安全约束与岗位完整性验证通过。`
    : `${primary.staffName}已连续${previousRuns[0] === 1 ? "一" : "两"}个工作班承担${primary.flightNo}/${primary.position}，本班${route}；双方岗位资质、岗位完整性及全部安全约束验证通过。`;
  cycle.forEach((assignment) => {
    rebuildAutomaticAssignmentEvidence(assignment, [
      schedulingDecision("position-rotation", "selected", message),
      ...(recoveryFallbackMessage
        ? [
            schedulingDecision(
              "late-shift-recovery",
              "fallback",
              recoveryFallbackMessage
            ),
          ]
        : []),
    ]);
  });
}

function applyOpenRotation(
  state: AppState,
  assignments: Assignment[],
  primary: Assignment,
  source: Assignment,
  replacement: Staff,
  releaseWorker: Staff,
  runs: number
): void {
  const originalName = primary.staffName;
  const sourceName = source.staffName;
  const message = `${originalName}已连续${runs === 1 ? "一" : "两"}个工作班承担${primary.flightNo}/${primary.position}，本班由${sourceName}接替目标岗位、${releaseWorker.name}接替${source.flightNo}/${source.position}；原人员仍有其他实际岗位，三人重排通过岗位资质、岗位完整性及全部安全约束验证。`;
  primary.staffId = replacement.id;
  primary.staffName = replacement.name;
  source.staffId = releaseWorker.id;
  source.staffName = releaseWorker.name;
  applyConfiguredEarlyReleases(
    assignments,
    state,
    new Set([replacement.id, releaseWorker.id])
  );
  rebuildAutomaticAssignmentEvidence(primary, [
    schedulingDecision("position-rotation", "selected", message),
  ]);
  rebuildAutomaticAssignmentEvidence(source, [
    schedulingDecision("position-rotation", "selected", message),
  ]);
}

function applyOpenRotationChain(
  state: AppState,
  assignments: Assignment[],
  chain: OpenRotationChain,
  runs: number,
  recoveryFallbackMessage?: string
): void {
  const original = chain.roles.map((role) => ({
    staffId: role.staffId,
    staffName: role.staffName,
    assignment: role.assignments[0]!,
  }));
  const endpoint = state.staff.find(
    (person) => person.id === chain.endpointStaffId
  )!;
  const primary = original[0]!;
  const route = chain.roles
    .map((role, index) => {
      const incomingName = original[index + 1]?.staffName ?? endpoint.name;
      const assignment = role.assignments[0]!;
      return `${incomingName}接${assignment.flightNo}/${assignment.position}`;
    })
    .join(" → ");
  const message = `${primary.staffName}已连续${runs === 1 ? "一" : "两"}个工作班承担${primary.assignment.flightNo}/${primary.assignment.position}，本班已通过${chain.roles.length + 1}人开放式连续腾挪解除：${route}；最后空位由该时段空闲的合格人员${endpoint.name}补齐，岗位完整性及全部安全约束验证通过。`;

  chain.roles.forEach((role, index) => {
    const incoming = original[index + 1] ?? {
      staffId: endpoint.id,
      staffName: endpoint.name,
    };
    role.assignments.forEach((assignment) => {
      assignment.staffId = incoming.staffId;
      assignment.staffName = incoming.staffName;
    });
  });
  applyConfiguredEarlyReleases(
    assignments,
    state,
    new Set(
      chain.roles.flatMap((role) =>
        role.assignments.flatMap((assignment) =>
          assignment.staffId ? [assignment.staffId] : []
        )
      )
    )
  );
  chain.roles.forEach((role) => {
    role.assignments.forEach((assignment) => {
      rebuildAutomaticAssignmentEvidence(assignment, [
        schedulingDecision("position-rotation", "selected", message),
        ...(recoveryFallbackMessage
          ? [
              schedulingDecision(
                "late-shift-recovery",
                "fallback",
                recoveryFallbackMessage
              ),
            ]
          : []),
      ]);
    });
  });
}

export function reviewConsecutivePositionRotation(
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts?: ScheduleRunFacts
): string[] {
  if (!state.settings.positionRotationEnabled) return [];
  const frequencyFacts =
    facts?.scheduleFrequency ?? createScheduleFrequencyFacts(state, date);
  const ke166Review = reviewKe166GroupRotation(
    state,
    assignments,
    date,
    lockedAssignmentIds,
    facts
  );
  const reviewed = new Set(ke166Review.reviewedAssignmentIds);
  const warnings: string[] = [...ke166Review.warnings];
  const primaryAssignments = assignments
    .filter(
      (assignment) => !isRotationLocked(state, assignment, lockedAssignmentIds)
    )
    .map((assignment) => ({
      assignment,
      kind: rotationKind(state, assignment),
      runs: consecutivePositionAssignments(
        state,
        assignment.staffId!,
        assignment.flightNo,
        assignment.position,
        date,
        frequencyFacts
      ),
    }))
    .filter((item) =>
      item.kind === "ordinary" ? item.runs >= 2 : item.runs > 0
    )
    .sort(
      (left, right) =>
        rotationKindOrder(left.kind) - rotationKindOrder(right.kind) ||
        right.runs - left.runs ||
        right.assignment.fatiguePoints - left.assignment.fatiguePoints ||
        left.assignment.flightNo.localeCompare(right.assignment.flightNo) ||
        left.assignment.position.localeCompare(right.assignment.position)
    );

  for (const { assignment: primary, runs, kind } of primaryAssignments) {
    if (reviewed.has(primary.id)) continue;
    const compareStaff = targetStaffOrder(
      state,
      assignments,
      primary,
      date,
      facts,
      frequencyFacts
    );
    const originalStaffHasOtherWork = assignments.some(
      (assignment) =>
        assignment.id !== primary.id &&
        assignment.staffId === primary.staffId &&
        assignment.status === "assigned" &&
        assignment.workHours > 0
    );
    const directCandidates = originalStaffHasOtherWork
      ? state.staff
          .filter(
            (person) =>
              person.id !== primary.staffId &&
              person.status === "正常" &&
              person.staffType === "常规" &&
              configuredForAssignment(state, primary, person.id)
          )
          .sort((left, right) => compareStaff(left.id, right.id))
      : [];
    const attemptedReasons: string[] = [];
    let directReplacement = false;
    for (const person of directCandidates) {
      const reasons = reassignmentSafetyReasons({
        kind: "plan",
        state,
        assignments,
        changes: [{ assignmentId: primary.id, staffId: person.id }],
        primaryAssignmentId: primary.id,
        date,
        review: "consecutive",
        facts,
        frequencyFacts,
      });
      if (!reasons.length) {
        applyDirectRotation(
          state,
          assignments,
          primary,
          person.id,
          person.name,
          runs
        );
        reviewed.add(primary.id);
        directReplacement = true;
        break;
      }
      attemptedReasons.push(...reasons);
    }
    if (directReplacement) continue;
    const availableAssignments = rotationCandidateAssignments(
      assignments,
      primary,
      state,
      lockedAssignmentIds
    )
      .filter((candidate) => !reviewed.has(candidate.id))
      .filter((candidate) => {
        const candidateKind = rotationKind(state, candidate);
        if (kind === "priority") return true;
        if (kind === "high-fatigue") return candidateKind !== "priority";
        return candidateKind === "ordinary";
      })
      .sort(
        kind === "ordinary"
          ? () => 0
          : (left, right) => compareStaff(left.staffId!, right.staffId!)
      );
    const candidates = availableAssignments
      .filter((candidate) =>
        Boolean(
          candidate.staffId &&
          configuredForAssignment(state, primary, candidate.staffId)
        )
      )
      .sort(
        kind === "ordinary"
          ? () => 0
          : (left, right) => compareStaff(left.staffId!, right.staffId!)
      );
    const latePriorityReliefApplies = Boolean(
      kind === "priority" &&
      primary.staffId &&
      isInFinalLateBatch(primary, state.flights, state)
    );
    let openRotationResolved = false;
    const tryThreePersonOpenRotation = (): void => {
      if (!originalStaffHasOtherWork) return;
      for (const source of candidates) {
        const sourceRule = assignmentRule(state, source);
        const sourceFlight = state.flights.find(
          (flight) => flight.id === source.flightId
        );
        const replacement = source.staffId
          ? state.staff.find((person) => person.id === source.staffId)
          : undefined;
        if (!sourceRule || !sourceFlight || !replacement || !primary.staffId)
          continue;
        const compareReleaseStaff = targetStaffOrder(
          state,
          assignments,
          source,
          date,
          facts,
          frequencyFacts
        );
        const releaseCandidates = eligibleStaffForRule(
          state,
          sourceFlight,
          sourceRule
        )
          .filter(
            (person) =>
              person.id !== primary.staffId && person.id !== replacement.id
          )
          .sort((left, right) => compareReleaseStaff(left.id, right.id));
        for (const releaseWorker of releaseCandidates) {
          const reasons = reassignmentSafetyReasons({
            kind: "plan",
            state,
            assignments,
            changes: [
              { assignmentId: primary.id, staffId: replacement.id },
              { assignmentId: source.id, staffId: releaseWorker.id },
            ],
            primaryAssignmentId: primary.id,
            date,
            review: "consecutive",
            facts,
            frequencyFacts,
          });
          if (!reasons.length) {
            applyOpenRotation(
              state,
              assignments,
              primary,
              source,
              replacement,
              releaseWorker,
              runs
            );
            reviewed.add(primary.id);
            reviewed.add(source.id);
            openRotationResolved = true;
            return;
          }
          attemptedReasons.push(...reasons);
        }
      }
    };
    if (latePriorityReliefApplies) {
      tryThreePersonOpenRotation();
      if (openRotationResolved) continue;
    }
    let cycle: Assignment[] | null = null;
    let fatigueReliefCycle = false;
    let protectedReplacementFallback = false;
    if (!latePriorityReliefApplies) {
      for (const candidate of candidates) {
        const direct = [primary, candidate];
        const reasons = reassignmentSafetyReasons({
          kind: "cycle",
          state,
          assignments,
          cycle: direct,
          date,
          review: "consecutive",
          facts,
          frequencyFacts,
        });
        if (!reasons.length) {
          cycle = direct;
          break;
        }
        attemptedReasons.push(...reasons);
      }
    }
    if (!cycle && !latePriorityReliefApplies) {
      tryThreePersonOpenRotation();
    }
    if (openRotationResolved) continue;
    if (!cycle && latePriorityReliefApplies) {
      const search = findConsecutiveRotationPlan({
        state,
        assignments,
        primary,
        availableAssignments,
        date,
        originalStaffHasOtherWork,
        compareStaff,
        facts,
        frequencyFacts,
      });
      attemptedReasons.push(...search.attemptedReasons);
      if (search.plan?.kind === "open") {
        const incomingStaffId =
          search.plan.chain.roles[1]?.staffId ??
          search.plan.chain.endpointStaffId;
        const incoming = state.staff.find(
          (person) => person.id === incomingStaffId
        );
        const fallbackMessage = search.plan.protectedReplacementFallback
          ? `跨工作日恢复保护软约束已让步：${incoming?.name ?? "接替人员"}属于上一工作班末班重点岗位人员；其他不移动受保护人员的安全方案均已穷尽，本班允许其接替${primary.flightNo}/${primary.position}并让${primary.staffName}彻底退出晚班，请复核现场恢复情况。`
          : undefined;
        applyOpenRotationChain(
          state,
          assignments,
          search.plan.chain,
          runs,
          fallbackMessage
        );
        search.plan.chain.roles.forEach((role) => {
          role.assignments.forEach((assignment) => reviewed.add(assignment.id));
        });
        if (fallbackMessage) warnings.push(fallbackMessage);
        continue;
      }
      if (search.plan?.kind === "cycle") {
        cycle = search.plan.cycle;
        fatigueReliefCycle = search.plan.fatigueRelief;
        protectedReplacementFallback = search.plan.protectedReplacementFallback;
      }
    }
    if (!cycle && !latePriorityReliefApplies) {
      const search = findConsecutiveRotationPlan({
        state,
        assignments,
        primary,
        availableAssignments,
        date,
        originalStaffHasOtherWork,
        compareStaff,
        facts,
        frequencyFacts,
      });
      attemptedReasons.push(...search.attemptedReasons);
      if (search.plan?.kind === "open") {
        applyOpenRotationChain(state, assignments, search.plan.chain, runs);
        search.plan.chain.roles.forEach((role) => {
          role.assignments.forEach((assignment) => reviewed.add(assignment.id));
        });
        continue;
      }
      if (search.plan?.kind === "cycle") {
        cycle = search.plan.cycle;
        fatigueReliefCycle = search.plan.fatigueRelief;
      }
    }
    if (openRotationResolved) continue;
    if (cycle) {
      const previousRuns = cycle.map((item) =>
        consecutivePositionAssignments(
          state,
          item.staffId!,
          item.flightNo,
          item.position,
          date,
          frequencyFacts
        )
      );
      const recoveryFallbackMessage = protectedReplacementFallback
        ? `跨工作日恢复保护软约束已让步：${cycle[1]!.staffName}属于上一工作班末班重点岗位人员；其他不移动受保护人员的安全方案均已穷尽，本班允许其接替${cycle[0]!.flightNo}/${cycle[0]!.position}，请复核现场恢复情况。`
        : undefined;
      applyConsecutiveRotationCycle(
        state,
        assignments,
        cycle,
        previousRuns,
        fatigueReliefCycle,
        recoveryFallbackMessage
      );
      cycle.forEach((item) => reviewed.add(item.id));
      if (recoveryFallbackMessage) warnings.push(recoveryFallbackMessage);
      continue;
    }
    reviewed.add(primary.id);
    const details = [...new Set(attemptedReasons)].slice(0, 3);
    const reason = details.length
      ? details.join("；")
      : candidates.length
        ? "没有满足全部安全约束的交换人员"
        : "没有可交换的常规岗位人员";
    const message =
      kind === "priority" && runs === 1
        ? `重点岗位连续轮岗未落实：${primary.staffName}上一工作班已承担${primary.flightNo}/${primary.position}，本班再次承担；${reason}；为保证岗位完整性，本班异常保留。`
        : kind === "high-fatigue" && runs === 1
          ? `高负荷普通岗位连续轮岗未落实：${primary.staffName}上一工作班已承担${primary.flightNo}/${primary.position}，本班再次承担；${reason}；为保证岗位完整性，本班异常保留。`
          : `连续轮岗未落实：${primary.staffName}已连续两个工作班承担${primary.flightNo}/${primary.position}；${reason}；为保证岗位完整性，本班异常保留该人员，形成第三次连续安排。`;
    replaceAssignmentDecisions(primary, "position-rotation", [
      schedulingDecision("position-rotation", "fallback", message),
    ]);
    warnings.push(message);
  }
  return warnings;
}
