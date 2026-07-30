import type { AppState, Assignment, Flight, PositionRule } from "../model";
import { createId } from "../utils";
import { eligibleStaffForRule } from "./assignment-eligibility";
import { canMobileSupervisorCoverPosition } from "./mobile-supervisor-coverage";
import { assignmentRule } from "./schedule-position-rules";
import { totalFatiguePriority } from "./schedule-protection";
import {
  isKe166MobileSupervisor,
  isNumberedRegularPosition,
} from "./schedule-tasks";
import { durationHours } from "./time";
import { intervalsOverlap } from "./time";
import { isNextDutyRestConflict } from "./next-duty-rest";
import { consecutivePositionAssignments } from "./schedule-frequency";
import { schedulingDecision } from "../schedule-rule-contract";
import type { ScheduleRunFacts } from "./schedule-run-facts";
import { clearAutomaticAssignmentEvidence } from "./assignment-evidence";
import { canAssignStaff } from "./assignment-eligibility";
import { lateShiftRecoveryRisk } from "./schedule-protection";
import { reassignmentSafetyReasons } from "./rotation-review-safety";
import {
  findShortestRotationCycle,
  type RotationRole,
} from "./rotation-cycle-search";
import {
  findShortestOpenRotationChain,
  type OpenRotationChain,
} from "./rotation-open-chain-search";

interface CounterPlacementPlan {
  target: Assignment;
  changes: Array<{
    assignment: Assignment;
    staffId: string;
    staffName: string;
  }>;
  description: string;
}

export function compareKe166SupervisorRotation(
  state: AppState,
  flight: Flight,
  rule: PositionRule,
  date: string,
  leftStaffId: string,
  rightStaffId: string
): number {
  return (
    Number(
      consecutivePositionAssignments(
        state,
        leftStaffId,
        flight.flightNo,
        rule.name,
        date
      ) > 0
    ) -
    Number(
      consecutivePositionAssignments(
        state,
        rightStaffId,
        flight.flightNo,
        rule.name,
        date
      ) > 0
    )
  );
}

function canSafelyTakeCounter(
  assignments: Assignment[],
  counter: Assignment,
  staffId: string,
  state: AppState,
  flight: Flight
): boolean {
  const occupied = assignments.filter(
    (assignment) =>
      assignment.id !== counter.id &&
      assignment.status === "assigned" &&
      assignment.staffId === staffId &&
      assignment.workHours > 0 &&
      intervalsOverlap(
        assignment.startTime,
        assignment.endTime,
        flight.startTime,
        flight.endTime
      )
  );
  if (occupied.length) return false;
  const hours = assignments
    .filter(
      (assignment) =>
        assignment.id !== counter.id && assignment.staffId === staffId
    )
    .reduce((sum, assignment) => sum + assignment.workHours, 0);
  return (
    hours + durationHours(flight.startTime, flight.endTime) <=
    state.settings.maxDailyHours
  );
}

function isAutomaticRegularAssignment(
  state: AppState,
  assignment: Assignment
): boolean {
  const rule = assignmentRule(state, assignment);
  return Boolean(
    rule &&
    rule.category === "常规" &&
    !rule.manual &&
    assignment.positionRuleId &&
    assignment.staffId &&
    assignment.status === "assigned" &&
    assignment.workHours > 0
  );
}

function planIsSafe(
  state: AppState,
  assignments: Assignment[],
  changes: CounterPlacementPlan["changes"]
): boolean {
  const incomingById = new Map(
    changes.map((change) => [change.assignment.id, change])
  );
  const planned = assignments.map((assignment) => {
    const incoming = incomingById.get(assignment.id);
    return incoming
      ? {
          ...assignment,
          staffId: incoming.staffId,
          staffName: incoming.staffName,
        }
      : assignment;
  });
  const plannedState: AppState = { ...state, assignments: planned };
  return changes.every(
    (change) =>
      canAssignStaff(plannedState, change.assignment.id, change.staffId) ===
      null
  );
}

function roleChanges(
  state: AppState,
  roles: RotationRole[],
  endpointStaffId?: string
): CounterPlacementPlan["changes"] {
  const personById = new Map(
    state.staff.map((person) => [person.id, person.name])
  );
  return roles.flatMap((role, index) => {
    const incomingStaffId =
      roles[index + 1]?.staffId ?? endpointStaffId ?? roles[0]!.staffId;
    const incomingStaffName = personById.get(incomingStaffId) ?? "";
    return role.assignments.map((assignment) => ({
      assignment,
      staffId: incomingStaffId,
      staffName: incomingStaffName,
    }));
  });
}

function openRoleChanges(
  state: AppState,
  chain: OpenRotationChain
): CounterPlacementPlan["changes"] {
  return roleChanges(state, chain.roles, chain.endpointStaffId);
}

function eligibleSupervisorOrder(
  state: AppState,
  assignments: Assignment[],
  flight: Flight,
  rule: PositionRule,
  date: string,
  facts?: ScheduleRunFacts,
  requireNonRepeated = false
): string[] {
  return eligibleStaffForRule(state, flight, rule)
    .filter(
      (person) =>
        !requireNonRepeated ||
        consecutivePositionAssignments(
          state,
          person.id,
          flight.flightNo,
          rule.name,
          date
        ) === 0
    )
    .sort(
      (left, right) =>
        Number(
          consecutivePositionAssignments(
            state,
            left.id,
            flight.flightNo,
            rule.name,
            date
          ) > 0
        ) -
          Number(
            consecutivePositionAssignments(
              state,
              right.id,
              flight.flightNo,
              rule.name,
              date
            ) > 0
          ) ||
        Number(
          isNextDutyRestConflict(
            state,
            left.id,
            rule,
            date,
            facts?.nextDutyRest
          )
        ) -
          Number(
            isNextDutyRestConflict(
              state,
              right.id,
              rule,
              date,
              facts?.nextDutyRest
            )
          ) ||
        totalFatiguePriority(
          left,
          assignments,
          state,
          date,
          facts?.currentDutyStaffId
        ) -
          totalFatiguePriority(
            right,
            assignments,
            state,
            date,
            facts?.currentDutyStaffId
          ) ||
        left.id.localeCompare(right.id, undefined, { numeric: true })
    )
    .map((person) => person.id);
}

function findSupervisorCounterPlan(
  state: AppState,
  assignments: Assignment[],
  flight: Flight,
  supervisorRule: PositionRule,
  date: string,
  facts?: ScheduleRunFacts,
  lockedAssignmentIds: ReadonlySet<string> = new Set(),
  requireNonRepeated = false
): CounterPlacementPlan | null {
  const supervisorIds = eligibleSupervisorOrder(
    state,
    assignments,
    flight,
    supervisorRule,
    date,
    facts,
    requireNonRepeated
  );
  const personById = new Map(state.staff.map((person) => [person.id, person]));
  const targets = assignments
    .filter(
      (assignment) =>
        assignment.flightId === flight.id && assignment.positionRuleId
    )
    .filter((assignment) => {
      const targetRule = assignmentRule(state, assignment);
      return Boolean(
        targetRule &&
        targetRule.category === "常规" &&
        !targetRule.manual &&
        isNumberedRegularPosition(targetRule) &&
        canMobileSupervisorCoverPosition(state, {
          flightNo: flight.flightNo,
          position: targetRule.name,
          remark: targetRule.remark,
        })
      );
    });

  for (const supervisorId of supervisorIds) {
    const existing = targets.find(
      (target) =>
        target.staffId === supervisorId && target.status === "assigned"
    );
    if (existing)
      return {
        target: existing,
        changes: [],
        description: "已在允许兼任的KE166柜台",
      };
  }

  for (const supervisorId of supervisorIds) {
    const supervisor = personById.get(supervisorId)!;
    const sources = assignments.filter(
      (assignment) =>
        assignment.staffId === supervisorId &&
        isAutomaticRegularAssignment(state, assignment) &&
        !lockedAssignmentIds.has(assignment.id)
    );
    for (const target of targets.filter(
      (assignment) => assignment.status === "assigned" && assignment.staffId
    )) {
      const outgoing = personById.get(target.staffId!);
      if (!outgoing) continue;
      for (const source of sources) {
        if (source.id === target.id) continue;
        const changes = [
          {
            assignment: target,
            staffId: supervisor.id,
            staffName: supervisor.name,
          },
          {
            assignment: source,
            staffId: outgoing.id,
            staffName: outgoing.name,
          },
        ];
        if (planIsSafe(state, assignments, changes)) {
          return {
            target,
            changes,
            description: `${supervisor.name}与${outgoing.name}在${source.flightNo}/${source.position}、${target.flightNo}/${target.position}之间安全互换`,
          };
        }
        const sourceRule = assignmentRule(state, source);
        if (!sourceRule) continue;
        for (const replacement of eligibleStaffForRule(
          state,
          state.flights.find((item) => item.id === source.flightId)!,
          sourceRule
        ).filter(
          (person) => person.id !== supervisor.id && person.id !== outgoing.id
        )) {
          const replacementChanges = [
            {
              assignment: target,
              staffId: supervisor.id,
              staffName: supervisor.name,
            },
            {
              assignment: source,
              staffId: replacement.id,
              staffName: replacement.name,
            },
          ];
          if (planIsSafe(state, assignments, replacementChanges)) {
            return {
              target,
              changes: replacementChanges,
              description: `${supervisor.name}进入${target.flightNo}/${target.position}，${replacement.name}接替其原${source.flightNo}/${source.position}`,
            };
          }
        }
      }
    }
  }

  const automaticCandidates = assignments.filter(
    (assignment) =>
      isAutomaticRegularAssignment(state, assignment) &&
      !lockedAssignmentIds.has(assignment.id)
  );
  const endpointStaffIds = state.staff
    .filter((person) => person.status === "正常" && person.staffType === "常规")
    .map((person) => person.id);
  const supervisorIdSet = new Set(supervisorIds);
  for (const target of targets.filter(
    (assignment) => assignment.status === "assigned" && assignment.staffId
  )) {
    const targetRole: RotationRole = {
      id: target.id,
      assignments: [target],
      staffId: target.staffId!,
      staffName: target.staffName,
    };
    const candidateRoles = automaticCandidates
      .filter(
        (assignment) =>
          assignment.id === target.id ||
          assignment.flightId === target.flightId ||
          intervalsOverlap(
            assignment.startTime,
            assignment.endTime,
            target.startTime,
            target.endTime
          )
      )
      .map((assignment): RotationRole => ({
        id: assignment.id,
        assignments: [assignment],
        staffId: assignment.staffId!,
        staffName: assignment.staffName,
      }));
    const eligibilityReason = (
      role: RotationRole,
      incomingStaffId: string
    ): string | null => {
      const assignment = role.assignments[0]!;
      const sourceRule = assignmentRule(state, assignment);
      if (!sourceRule?.qualifiedStaffIds.includes(incomingStaffId))
        return "候选人不具备连续腾挪目标岗位资质";
      if (role.id === targetRole.id && !supervisorIdSet.has(incomingStaffId))
        return "候选人不具备未连续的机动督导资质";
      return null;
    };
    const safetyReasons = (
      changes: CounterPlacementPlan["changes"]
    ): string[] =>
      reassignmentSafetyReasons({
        kind: "plan",
        state,
        assignments,
        changes: changes.map((change) => ({
          assignmentId: change.assignment.id,
          staffId: change.staffId,
        })),
        primaryAssignmentId: target.id,
        date,
        review: "ke166-supervisor",
        facts,
      });

    for (
      let participantLimit = 2;
      participantLimit <= 5;
      participantLimit += 1
    ) {
      const closedSearch = findShortestRotationCycle({
        primary: targetRole,
        roles: candidateRoles,
        eligibilityReason,
        safetyReasons: (roles) => safetyReasons(roleChanges(state, roles)),
        maxRoles: participantLimit,
      });
      if (closedSearch.cycle) {
        const changes = roleChanges(state, closedSearch.cycle);
        return {
          target,
          changes,
          description: `通过${closedSearch.cycle.length}人连续腾挪，将未连续督导放入允许兼任柜台`,
        };
      }

      const targetStaffHasOtherWork = assignments.some(
        (assignment) =>
          assignment.id !== target.id &&
          assignment.staffId === target.staffId &&
          assignment.status === "assigned" &&
          assignment.workHours > 0
      );
      if (!targetStaffHasOtherWork) continue;
      const openSearch = findShortestOpenRotationChain({
        primary: targetRole,
        roles: candidateRoles,
        endpointStaffIds,
        eligibilityReason,
        safetyReasons: (chain) => safetyReasons(openRoleChanges(state, chain)),
        maxParticipants: participantLimit,
      });
      if (!openSearch.chain) continue;
      return {
        target,
        changes: openRoleChanges(state, openSearch.chain),
        description: `通过${openSearch.chain.roles.length + 1}人开放式连续腾挪，将未连续督导放入允许兼任柜台并由空闲合格人员补齐末端岗位`,
      };
    }
  }

  for (const supervisorId of supervisorIds) {
    const supervisor = personById.get(supervisorId)!;
    for (const target of targets) {
      const changes = [
        {
          assignment: target,
          staffId: supervisor.id,
          staffName: supervisor.name,
        },
      ];
      if (planIsSafe(state, assignments, changes)) {
        return {
          target,
          changes,
          description: `${supervisor.name}直接进入${target.flightNo}/${target.position}`,
        };
      }
    }
  }
  return null;
}

export function assignKe166SupervisorByCounterCoverage(
  state: AppState,
  assignments: Assignment[],
  flight: Flight,
  rule: PositionRule,
  date: string,
  facts?: ScheduleRunFacts,
  lockedAssignmentIds: ReadonlySet<string> = new Set(),
  rotationReplacementForStaffId?: string
): Assignment | undefined {
  if (!isKe166MobileSupervisor(flight, rule)) return undefined;
  const requireNonRepeated = Boolean(rotationReplacementForStaffId);
  const eligibleIds = new Set(
    eligibleStaffForRule(state, flight, rule)
      .filter(
        (person) =>
          !requireNonRepeated ||
          consecutivePositionAssignments(
            state,
            person.id,
            flight.flightNo,
            rule.name,
            date
          ) === 0
      )
      .map((person) => person.id)
  );
  let regularAssignment = assignments
    .filter((assignment) => {
      const sourceRule = assignmentRule(state, assignment);
      return (
        assignment.flightId === flight.id &&
        assignment.status === "assigned" &&
        assignment.staffId &&
        eligibleIds.has(assignment.staffId) &&
        Boolean(
          sourceRule &&
          isNumberedRegularPosition(sourceRule) &&
          canMobileSupervisorCoverPosition(state, {
            flightNo: flight.flightNo,
            position: sourceRule.name,
            remark: sourceRule.remark,
          })
        )
      );
    })
    .sort((left, right) => {
      const leftPerson = state.staff.find(
        (person) => person.id === left.staffId
      )!;
      const rightPerson = state.staff.find(
        (person) => person.id === right.staffId
      )!;
      return (
        Number(
          consecutivePositionAssignments(
            state,
            leftPerson.id,
            flight.flightNo,
            rule.name,
            date
          ) > 0
        ) -
          Number(
            consecutivePositionAssignments(
              state,
              rightPerson.id,
              flight.flightNo,
              rule.name,
              date
            ) > 0
          ) ||
        Number(
          isNextDutyRestConflict(
            state,
            leftPerson.id,
            rule,
            date,
            facts?.nextDutyRest
          )
        ) -
          Number(
            isNextDutyRestConflict(
              state,
              rightPerson.id,
              rule,
              date,
              facts?.nextDutyRest
            )
          ) ||
        totalFatiguePriority(
          leftPerson,
          assignments,
          state,
          date,
          facts?.currentDutyStaffId
        ) -
          totalFatiguePriority(
            rightPerson,
            assignments,
            state,
            date,
            facts?.currentDutyStaffId
          ) ||
        leftPerson.id.localeCompare(rightPerson.id, undefined, {
          numeric: true,
        })
      );
    })[0];
  if (!regularAssignment) {
    const plan = findSupervisorCounterPlan(
      state,
      assignments,
      flight,
      rule,
      date,
      facts,
      lockedAssignmentIds,
      requireNonRepeated
    );
    if (plan) {
      for (const change of plan.changes) {
        clearAutomaticAssignmentEvidence(change.assignment);
        change.assignment.staffId = change.staffId;
        change.assignment.staffName = change.staffName;
        change.assignment.status = "assigned";
      }
      regularAssignment = plan.target;
      if (plan.changes.length) {
        regularAssignment.decisionTrace = [
          schedulingDecision(
            "ke166-supervisor",
            "selected",
            `KE166没有独立督导人选，柜台完成后置安全重排：${plan.description}，随后启用督导兼任兜底。`
          ),
        ];
      }
    }
  }
  if (!regularAssignment?.staffId) return undefined;
  const replacedIndependentSupervisor = rotationReplacementForStaffId
    ? state.staff.find((person) => person.id === rotationReplacementForStaffId)
    : undefined;
  const rotationImprovementMessage = replacedIndependentSupervisor
    ? `KE166机动督导连续轮岗已落实：${replacedIndependentSupervisor.name}上一工作班已承担${flight.flightNo}/${rule.name}，本班改由${regularAssignment.staffName}保留${flight.flightNo}/${regularAssignment.position}并兼任机动督导。`
    : null;
  const supervisorIds = new Set(
    eligibleStaffForRule(state, flight, rule).map((person) => person.id)
  );
  const sourceRule = assignmentRule(state, regularAssignment);
  if (sourceRule) {
    const currentNeedsAvoidance =
      consecutivePositionAssignments(
        state,
        regularAssignment.staffId,
        flight.flightNo,
        rule.name,
        date
      ) > 0 ||
      isNextDutyRestConflict(
        state,
        regularAssignment.staffId,
        rule,
        date,
        facts?.nextDutyRest
      );
    if (currentNeedsAvoidance) {
      const replacement = state.staff
        .filter(
          (person) =>
            person.id !== regularAssignment.staffId &&
            supervisorIds.has(person.id) &&
            sourceRule.qualifiedStaffIds.includes(person.id) &&
            canSafelyTakeCounter(
              assignments,
              regularAssignment,
              person.id,
              state,
              flight
            )
        )
        .sort(
          (left, right) =>
            Number(
              consecutivePositionAssignments(
                state,
                left.id,
                flight.flightNo,
                rule.name,
                date
              ) > 0
            ) -
              Number(
                consecutivePositionAssignments(
                  state,
                  right.id,
                  flight.flightNo,
                  rule.name,
                  date
                ) > 0
              ) ||
            Number(
              isNextDutyRestConflict(
                state,
                left.id,
                rule,
                date,
                facts?.nextDutyRest
              )
            ) -
              Number(
                isNextDutyRestConflict(
                  state,
                  right.id,
                  rule,
                  date,
                  facts?.nextDutyRest
                )
              ) ||
            totalFatiguePriority(
              left,
              assignments,
              state,
              date,
              facts?.currentDutyStaffId
            ) -
              totalFatiguePriority(
                right,
                assignments,
                state,
                date,
                facts?.currentDutyStaffId
              ) ||
            left.id.localeCompare(right.id, undefined, { numeric: true })
        )
        .find(
          (person) =>
            !isNextDutyRestConflict(
              state,
              person.id,
              rule,
              date,
              facts?.nextDutyRest
            )
        );
      if (replacement) {
        const originalName = regularAssignment.staffName;
        clearAutomaticAssignmentEvidence(regularAssignment);
        regularAssignment.staffId = replacement.id;
        regularAssignment.staffName = replacement.name;
        regularAssignment.decisionTrace = [
          schedulingDecision(
            "position-rotation",
            "selected",
            "KE166机动督导后置绑定前已完成安全换人：" +
              originalName +
              "从" +
              flight.flightNo +
              "/" +
              regularAssignment.position +
              "退出，由" +
              replacement.name +
              "接替，先保证柜台轮换再启用督导兼任兜底。"
          ),
        ];
      }
    }
  }

  const repeatedSupervisor =
    consecutivePositionAssignments(
      state,
      regularAssignment.staffId,
      flight.flightNo,
      rule.name,
      date
    ) > 0;
  const repeatedMessage = repeatedSupervisor
    ? "KE166机动督导连续轮岗未落实：" +
      regularAssignment.staffName +
      "上一工作班已承担" +
      flight.flightNo +
      "/" +
      rule.name +
      "，本班再次承担；没有其他未连续且满足全部安全约束的机动督导人选，为保证岗位完整性本班异常保留。"
    : undefined;
  const boundCounterRule = assignmentRule(state, regularAssignment);
  const recoveryOverride =
    boundCounterRule &&
    lateShiftRecoveryRisk(
      state,
      regularAssignment.staffId,
      {
        ...flight,
        position: regularAssignment.position,
        remark: regularAssignment.remark,
        fatiguePoints: regularAssignment.fatiguePoints,
      },
      date,
      facts?.crossDayRecovery
    ).excess > 0
      ? schedulingDecision(
          "late-shift-recovery",
          "fallback",
          `跨工作日恢复未落实：${regularAssignment.staffName}仍安排为${flight.flightNo}/${regularAssignment.position}；KE166机动督导锁定优先`
        )
      : null;
  const decisionTrace = [
    schedulingDecision(
      "ke166-supervisor",
      "selected",
      rotationImprovementMessage
        ? `${regularAssignment.staffName}为解除连续督导，由KE166柜台兼任机动督导`
        : regularAssignment.staffName + "在人手不足时由KE166柜台兼任机动督导"
    ),
    ...(regularAssignment.decisionTrace?.filter(
      (decision) => decision.ruleId === "position-rotation"
    ) ?? []),
    ...(rotationImprovementMessage
      ? [
          schedulingDecision(
            "position-rotation",
            "selected",
            rotationImprovementMessage
          ),
        ]
      : []),
    ...(repeatedMessage
      ? [schedulingDecision("position-rotation", "fallback", repeatedMessage)]
      : []),
    ...(isNextDutyRestConflict(
      state,
      regularAssignment.staffId,
      rule,
      date,
      facts?.nextDutyRest
    )
      ? [
          schedulingDecision(
            "next-duty-rest",
            "fallback",
            `下班次值班预休未落实：${regularAssignment.staffName}仍安排为${flight.flightNo}/${rule.name}；KE166机动督导锁定优先`
          ),
        ]
      : []),
    ...(recoveryOverride ? [recoveryOverride] : []),
  ];

  const supervisorAssignment: Assignment = {
    id: createId("assignment"),
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule.id,
    position: rule.name,
    staffId: regularAssignment.staffId,
    staffName: regularAssignment.staffName,
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: durationHours(flight.startTime, flight.endTime),
    fatiguePoints: rule.fatiguePoints,
    remark: rule.remark,
    manualRemark: "",
    status: "assigned",
    ...(repeatedMessage ? { systemNotes: [repeatedMessage] } : {}),
    ...(decisionTrace.length ? { decisionTrace } : {}),
  };
  regularAssignment.decisionTrace = [
    ...(regularAssignment.decisionTrace ?? []).filter(
      (decision) =>
        decision.ruleId !== "ke166-supervisor" &&
        decision.ruleId !== "late-shift-recovery" &&
        (!rotationImprovementMessage || decision.ruleId !== "position-rotation")
    ),
    schedulingDecision(
      "ke166-supervisor",
      "selected",
      `${regularAssignment.staffName}在人手不足时兼任${flight.flightNo}/${rule.name}`
    ),
    ...(rotationImprovementMessage
      ? [
          schedulingDecision(
            "position-rotation",
            "selected",
            rotationImprovementMessage
          ),
        ]
      : []),
    ...(recoveryOverride ? [recoveryOverride] : []),
  ];
  regularAssignment.workHours = 0;
  regularAssignment.supervisorSourceAssignmentId = supervisorAssignment.id;
  return supervisorAssignment;
}
