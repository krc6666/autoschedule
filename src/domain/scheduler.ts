import type { AppState, Assignment, Flight, PositionRule, ScheduleResult, Staff } from "../model";
import { createId } from "../utils";
import { historyFatigue } from "./fatigue";
import { durationHours, intervalsOverlap, isNightInterval, timeToMinutes } from "./time";

function findRule(rules: PositionRule[], flight: Flight, position: string): PositionRule | undefined {
  return rules.find((rule) => rule.flightNo === flight.flightNo && rule.name === position);
}

export function isAuxiliaryCategory(category: PositionRule["category"] | undefined): boolean {
  return category === "支援" || category === "行政支援";
}

export function isFixedBottomPosition(position: string): boolean {
  return position.includes("引导") && !position.includes("督导");
}

function isSupervisorPosition(position: string): boolean {
  return position.includes("督导");
}

export function isSameFlightReusePosition(position: string): boolean {
  return position.trim().startsWith("柜台引导1");
}

function canReleaseForFlight(assignment: Assignment, flight: Pick<Flight, "startTime" | "endTime">, state: AppState): boolean {
  const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
  if (rule?.category !== "分流" || rule.earlyReleaseMinutes <= 0 || timeToMinutes(assignment.startTime) < 12 * 60) return false;
  const assignmentStart = timeToMinutes(assignment.startTime);
  let assignmentEnd = timeToMinutes(assignment.endTime);
  let nextStart = timeToMinutes(flight.startTime);
  if (assignmentEnd <= assignmentStart) assignmentEnd += 24 * 60;
  if (nextStart < assignmentStart) nextStart += 24 * 60;
  const overlapMinutes = assignmentEnd - nextStart;
  return overlapMinutes > 0 && overlapMinutes <= rule.earlyReleaseMinutes;
}

function staffConflicts(assignments: Assignment[], staffId: string, flight: Pick<Flight, "startTime" | "endTime">): Assignment[] {
  return assignments.filter((assignment) => assignment.staffId === staffId
    && intervalsOverlap(assignment.startTime, assignment.endTime, flight.startTime, flight.endTime));
}

function projectedAssignedHours(assignments: Assignment[], staffId: string, flight: Pick<Flight, "startTime" | "endTime">, state: AppState): number {
  return assignments.filter((assignment) => assignment.staffId === staffId).reduce((sum, assignment) => {
    return sum + (canReleaseForFlight(assignment, flight, state) ? durationHours(assignment.startTime, flight.startTime) : assignment.workHours);
  }, 0);
}

function applyEarlyReleases(assignments: Assignment[], staffId: string, flight: Pick<Flight, "startTime" | "endTime">, state: AppState): void {
  staffConflicts(assignments, staffId, flight).filter((assignment) => canReleaseForFlight(assignment, flight, state)).forEach((assignment) => {
    assignment.endTime = flight.startTime;
    assignment.workHours = durationHours(assignment.startTime, assignment.endTime);
  });
}

function candidateScore(
  person: Staff,
  assignments: Assignment[],
  state: AppState,
  date: string
): number {
  const prior = historyFatigue(state.history, person.id, date, state.settings);
  const current = assignments
    .filter((assignment) => assignment.staffId === person.id)
    .reduce((sum, assignment) => sum + assignment.fatiguePoints, 0);
  return prior + current;
}

function makeUnfilled(flight: Flight, position: string, rule: PositionRule | undefined): Assignment {
  return {
    id: createId("assignment"),
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule?.id ?? null,
    position,
    staffId: null,
    staffName: "",
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: durationHours(flight.startTime, flight.endTime),
    fatiguePoints: rule?.fatiguePoints ?? durationHours(flight.startTime, flight.endTime),
    remark: rule?.remark ?? "未找到岗位规则",
    manualRemark: "",
    status: rule?.manual || isAuxiliaryCategory(rule?.category) ? "manual" : "unfilled"
  };
}

export function activeFlightPositions(state: AppState, flight: Flight): string[] {
  const configured = state.positionRules.filter((rule) => rule.flightNo === flight.flightNo);
  const primary = configured.filter((rule) => !isFixedBottomPosition(rule.name));
  const fixedBottom = configured.filter((rule) => isFixedBottomPosition(rule.name));
  const orderedPrimary = primary
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => Number(isSupervisorPosition(right.rule.name)) - Number(isSupervisorPosition(left.rule.name)) || left.index - right.index)
    .map(({ rule }) => rule.name);
  return [...new Set([...orderedPrimary, ...fixedBottom.map((rule) => rule.name)])];
}

export function generateSchedule(state: AppState, date: string): ScheduleResult {
  const assignments: Assignment[] = [];
  const warnings: string[] = [];

  const flights = [...state.flights].sort((left, right) => left.startTime.localeCompare(right.startTime));
  for (const flight of flights) {
    const displayPositions = activeFlightPositions(state, flight);
    const processingPositions = displayPositions.filter((position) => findRule(state.positionRules, flight, position)?.category !== "行政支援")
      .concat(displayPositions.filter((position) => findRule(state.positionRules, flight, position)?.category === "行政支援"));
    const flightAssignmentStart = assignments.length;
    for (const position of processingPositions) {
      const rule = findRule(state.positionRules, flight, position);
      if (!rule) {
        assignments.push(makeUnfilled(flight, position, rule));
        warnings.push(`${flight.flightNo} / ${position} 缺少岗位规则`);
        continue;
      }
      if ((rule.minPassengers ?? 0) > flight.bookedPassengers) {
        assignments.push({ ...makeUnfilled(flight, position, rule), status: "manual" });
        continue;
      }
      if (rule.manual || rule.category === "支援") {
        assignments.push(makeUnfilled(flight, position, rule));
        continue;
      }
      const basicShortage = assignments.some((assignment) => {
        if (assignment.flightId !== flight.id || assignment.status !== "unfilled") return false;
        const assignmentRule = assignment.positionRuleId
          ? state.positionRules.find((item) => item.id === assignment.positionRuleId)
          : undefined;
        return !isAuxiliaryCategory(assignmentRule?.category);
      });
      if (rule.category === "行政支援" && basicShortage) {
        assignments.push({ ...makeUnfilled(flight, position, rule), status: "manual" });
        continue;
      }

      const hours = durationHours(flight.startTime, flight.endTime);
      if (isSameFlightReusePosition(position)) {
        const reusedCandidates = state.staff
          .filter((person) => person.status === "正常")
          .filter((person) => rule.qualifiedStaffIds.includes(person.id))
          .filter((person) => assignments.some((item) => item.flightId === flight.id && item.staffId === person.id && item.status === "assigned" && !item.remark.trim()));
        const selected = reusedCandidates[Math.floor(Math.random() * reusedCandidates.length)];
        if (!selected) {
          assignments.push({ ...makeUnfilled(flight, position, rule), workHours: 0 });
          warnings.push(`${flight.flightNo} / ${position} 没有可复用的无备注人员`);
        } else {
          assignments.push({
            id: createId("assignment"), flightId: flight.id, flightNo: flight.flightNo, positionRuleId: rule.id,
            position, staffId: selected.id, staffName: selected.name, startTime: flight.startTime, endTime: flight.endTime,
            workHours: 0, fatiguePoints: rule.fatiguePoints, remark: rule.remark, manualRemark: "", status: "assigned"
          });
        }
        continue;
      }
      const candidates = state.staff
        .filter((person) => person.status === "正常")
        .filter((person) => rule.category === "行政支援" || rule.qualifiedStaffIds.includes(person.id))
        .filter((person) => !isNightInterval(flight.startTime, flight.endTime, state.settings.nightStart, state.settings.nightEnd) || person.nightShift)
        .filter((person) => staffConflicts(assignments, person.id, flight).every((assignment) => canReleaseForFlight(assignment, flight, state)))
        .filter((person) => projectedAssignedHours(assignments, person.id, flight, state) + hours <= state.settings.maxDailyHours)
        .sort((left, right) => (rule.category === "行政支援"
          ? Number(rule.qualifiedStaffIds.includes(right.id)) - Number(rule.qualifiedStaffIds.includes(left.id))
          : 0)
          || candidateScore(left, assignments, state, date) - candidateScore(right, assignments, state, date)
          || Number(left.id) - Number(right.id));

      const selected = candidates[0];
      if (!selected) {
        assignments.push({ ...makeUnfilled(flight, position, rule), status: rule.category === "行政支援" ? "manual" : "unfilled" });
        if (rule.category !== "行政支援") warnings.push(`${flight.flightNo} / ${position} 无可用人员`);
        continue;
      }

      applyEarlyReleases(assignments, selected.id, flight, state);

      assignments.push({
        id: createId("assignment"),
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: rule.id,
        position,
        staffId: selected.id,
        staffName: selected.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: hours,
        fatiguePoints: rule.fatiguePoints,
        remark: rule.remark,
        manualRemark: "",
        status: "assigned"
      });
    }

    const currentFlightAssignments = assignments.filter((assignment) => assignment.flightId === flight.id);
    const needsMorningSupport = timeToMinutes(flight.startTime) < 12 * 60
      && currentFlightAssignments.some((assignment) => assignment.status === "unfilled")
      && !currentFlightAssignments.some((assignment) => {
        const rule = assignment.positionRuleId
          ? state.positionRules.find((item) => item.id === assignment.positionRuleId)
          : undefined;
        return isAuxiliaryCategory(rule?.category) || !assignment.positionRuleId;
      });
    if (needsMorningSupport) {
      assignments.push({
        id: createId("assignment"), flightId: flight.id, flightNo: flight.flightNo, positionRuleId: null,
        position: "临时支援", staffId: null, staffName: "", startTime: flight.startTime, endTime: flight.endTime,
        workHours: durationHours(flight.startTime, flight.endTime), fatiguePoints: 1,
        remark: "", manualRemark: "", status: "manual", layoutGroup: "primary", layoutIndex: displayPositions.length
      });
    }
    const sortedFlightAssignments = assignments.splice(flightAssignmentStart);
    sortedFlightAssignments.sort((left, right) => {
      const leftIndex = displayPositions.indexOf(left.position);
      const rightIndex = displayPositions.indexOf(right.position);
      return (leftIndex < 0 ? displayPositions.length : leftIndex) - (rightIndex < 0 ? displayPositions.length : rightIndex);
    });
    assignments.push(...sortedFlightAssignments);
  }

  return {
    assignments,
    unfilledCount: assignments.filter((assignment) => assignment.status === "unfilled").length,
    warnings: [...new Set(warnings)]
  };
}

export function canAssignStaff(state: AppState, assignmentId: string, staffId: string, ignoreAssignmentId?: string): string | null {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const person = state.staff.find((item) => item.id === staffId);
  if (!assignment || !person) return "人员或岗位不存在";
  if (person.status !== "正常") return `${person.name} 当前状态为${person.status}`;
  const rule = assignment.positionRuleId
    ? state.positionRules.find((item) => item.id === assignment.positionRuleId)
    : undefined;
  if (rule && rule.category !== "行政支援" && !rule.manual && !rule.qualifiedStaffIds.includes(person.id)) return `${person.name} 不具备该岗位资质`;
  if (isNightInterval(assignment.startTime, assignment.endTime, state.settings.nightStart, state.settings.nightEnd) && !person.nightShift) {
    return `${person.name} 不可上夜班`;
  }
  const reuse = isSameFlightReusePosition(assignment.position);
  const others = state.assignments.filter((item) => item.id !== assignmentId && (reuse || item.id !== ignoreAssignmentId) && item.staffId === staffId);
  if (reuse) {
    const source = others.find((item) => item.flightId === assignment.flightId && item.status === "assigned"
      && !isSameFlightReusePosition(item.position)
      && state.positionRules.find((ruleItem) => ruleItem.id === item.positionRuleId)?.category !== "支援");
    if (!source) return `${person.name} 未在该航班承担其他岗位`;
    if (source.remark.trim()) return `${person.name} 的原岗位已有备注任务`;
  }
  const conflicts = reuse
    ? others.filter((item) => item.flightId !== assignment.flightId)
    : others.filter((item) => item.flightId !== assignment.flightId || !isSameFlightReusePosition(item.position));
  if (conflicts.some((item) => intervalsOverlap(item.startTime, item.endTime, assignment.startTime, assignment.endTime) && !canReleaseForFlight(item, assignment, state))) {
    return `${person.name} 在该时段已有排班`;
  }
  if (projectedAssignedHours(others, staffId, assignment, state) + assignment.workHours > state.settings.maxDailyHours) {
    return `${person.name} 将超过每日 ${state.settings.maxDailyHours} 小时上限`;
  }
  return null;
}

export function applyEarlyReleaseForStaff(state: AppState, assignmentId: string, staffId: string): void {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return;
  const others = state.assignments.filter((item) => item.id !== assignmentId);
  applyEarlyReleases(others, staffId, assignment, state);
}

export function isDiversionTransfer(state: AppState, sourceAssignmentId: string, targetAssignmentId: string): boolean {
  const source = state.assignments.find((item) => item.id === sourceAssignmentId);
  const target = state.assignments.find((item) => item.id === targetAssignmentId);
  return Boolean(source && target && canReleaseForFlight(source, target, state));
}
