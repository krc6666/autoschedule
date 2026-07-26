import type { AppState, Assignment, Flight, PositionRule, SchedulingDecision, Staff } from "../model";
import { eligibleStaffForRule } from "./assignment-eligibility";
import { canReleaseForFlight, projectedAssignedHours, staffConflicts } from "./assignment-timing";
import { canMobileSupervisorCoverPosition } from "./mobile-supervisor-coverage";
import { activeFlightRules, assignmentRule } from "./schedule-position-rules";
import { positionTransitionInsertionCost } from "./schedule-protection";
import { isPreNoonFlight } from "./schedule-tasks";
import { schedulingDecision } from "./scheduling-policy";
import { durationHours, isNightInterval } from "./time";

export function preNoonShortageNote(state: AppState, assignments: Assignment[], flight: Flight, rule: PositionRule): string {
  const qualified = state.staff.filter((person) => person.staffType === "常规" && rule.qualifiedStaffIds.includes(person.id));
  const normal = qualified.filter((person) => person.status === "正常");
  const nightCapable = normal.filter((person) => !isNightInterval(
    flight.startTime,
    flight.endTime,
    state.settings.nightStart,
    state.settings.nightEnd
  ) || person.nightShift);
  const withoutConflict = nightCapable.filter((person) => staffConflicts(assignments, person.id, flight)
    .every((assignment) => canReleaseForFlight(assignment, flight, state)));
  const hours = durationHours(flight.startTime, flight.endTime);
  const withinHours = withoutConflict.filter((person) => projectedAssignedHours(assignments, person.id, flight, state)
    + hours <= state.settings.maxDailyHours);
  const reasons = [
    qualified.length === 0 ? "具备岗位资质 0 人" : "",
    qualified.length > normal.length ? `状态非正常 ${qualified.length - normal.length} 人` : "",
    normal.length > nightCapable.length ? `夜班能力不符 ${normal.length - nightCapable.length} 人` : "",
    nightCapable.length > withoutConflict.length ? `时段冲突 ${nightCapable.length - withoutConflict.length} 人` : "",
    withoutConflict.length > withinHours.length ? `超过每日工时上限 ${withoutConflict.length - withinHours.length} 人` : "",
    withinHours.length ? "无可继续调配的空闲人员" : ""
  ].filter(Boolean);
  return `因合格人数不足而无法填满（缺少 1 人：${reasons.join("，") || "无满足全部硬约束的常规人员"}）`;
}

interface RegularPlacement {
  person: Staff;
  sourceAssignment: Assignment;
  sourceRule: PositionRule;
  originalIndex: number;
  manualRemark: string;
  decisionTrace: SchedulingDecision[] | undefined;
  supervisorSourceAssignmentId: string | undefined;
}

interface RegularSlot {
  assignment: Assignment;
  rule: PositionRule;
}

function canMoveRegularPlacement(
  state: AppState,
  assignments: Assignment[],
  flight: Flight,
  placement: RegularPlacement,
  targetRule: PositionRule
): boolean {
  if (!eligibleStaffForRule(state, flight, targetRule).some((person) => person.id === placement.person.id)) return false;
  if (placement.supervisorSourceAssignmentId && !canMobileSupervisorCoverPosition(state, {
    flightNo: flight.flightNo,
    position: targetRule.name,
    remark: targetRule.remark
  })) return false;
  const otherFlights = assignments.filter((assignment) => assignment.flightId !== flight.id);
  const sourceCost = positionTransitionInsertionCost(
    otherFlights,
    placement.person.id,
    { key: `${flight.id}:${placement.sourceRule.id}`, flight, rule: placement.sourceRule },
    state,
    "forbid"
  );
  const targetCost = positionTransitionInsertionCost(
    otherFlights,
    placement.person.id,
    { key: `${flight.id}:${targetRule.id}`, flight, rule: targetRule },
    state,
    "forbid"
  );
  return targetCost <= sourceCost;
}

function canMatchEveryPlacement(
  placements: RegularPlacement[],
  slots: RegularSlot[],
  canPlace: (placement: RegularPlacement, slot: RegularSlot) => boolean
): boolean {
  return matchEveryPlacement(placements, slots, canPlace) !== null;
}

function matchEveryPlacement(
  placements: RegularPlacement[],
  slots: RegularSlot[],
  canPlace: (placement: RegularPlacement, slot: RegularSlot) => boolean
): Map<string, RegularPlacement> | null {
  if (placements.length > slots.length) return null;
  const placementById = new Map(placements.map((placement) => [placement.sourceAssignment.id, placement]));
  const matchedPlacementBySlot = new Map<string, string>();

  const tryMatch = (placement: RegularPlacement, visitedSlots: Set<string>): boolean => {
    for (const slot of slots) {
      if (visitedSlots.has(slot.assignment.id) || !canPlace(placement, slot)) continue;
      visitedSlots.add(slot.assignment.id);
      const matchedId = matchedPlacementBySlot.get(slot.assignment.id);
      const matched = matchedId ? placementById.get(matchedId) : undefined;
      if (!matched || tryMatch(matched, visitedSlots)) {
        matchedPlacementBySlot.set(slot.assignment.id, placement.sourceAssignment.id);
        return true;
      }
    }
    return false;
  };

  const matched = [...placements]
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .every((placement) => tryMatch(placement, new Set()));
  if (!matched) return null;
  return new Map([...matchedPlacementBySlot]
    .map(([slotId, placementId]) => [slotId, placementById.get(placementId)!]));
}

function canCoverRegularSlots(
  placements: RegularPlacement[],
  allSlots: RegularSlot[],
  requiredSlots: RegularSlot[],
  canPlace: (placement: RegularPlacement, slot: RegularSlot) => boolean
): boolean {
  if (requiredSlots.length > placements.length) return false;
  const requiredIds = new Set(requiredSlots.map((slot) => slot.assignment.id));
  const optionalSlots = allSlots.filter((slot) => !requiredIds.has(slot.assignment.id));
  const memo = new Map<string, boolean>();

  const search = (requiredIndex: number, usedPlacementIds: Set<string>): boolean => {
    const key = `${requiredIndex}:${[...usedPlacementIds].sort().join(",")}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    if (requiredIndex >= requiredSlots.length) {
      const remaining = placements.filter((placement) => !usedPlacementIds.has(placement.sourceAssignment.id));
      const result = canMatchEveryPlacement(remaining, optionalSlots, canPlace);
      memo.set(key, result);
      return result;
    }
    const requiredSlot = requiredSlots[requiredIndex]!;
    const result = placements.some((placement) => {
      if (usedPlacementIds.has(placement.sourceAssignment.id) || !canPlace(placement, requiredSlot)) return false;
      const nextUsed = new Set(usedPlacementIds);
      nextUsed.add(placement.sourceAssignment.id);
      return search(requiredIndex + 1, nextUsed);
    });
    memo.set(key, result);
    return result;
  };

  return search(0, new Set());
}

export function compactRegularAssignments(
  state: AppState,
  assignments: Assignment[],
  lockedAssignmentIds: ReadonlySet<string>
): Set<string> {
  const changedFlightIds = new Set<string>();

  for (const flight of state.flights) {
    const orderedRules = activeFlightRules(state, flight).filter((rule) => rule.category === "常规");
    const slots = orderedRules
      .map((rule) => ({
        rule,
        assignment: assignments.find((assignment) => assignment.flightId === flight.id
          && assignment.positionRuleId === rule.id)
      }))
      .filter((slot): slot is RegularSlot => Boolean(slot.assignment && slot.assignment.status !== "manual"));
    const firstVacancy = slots.findIndex((slot, index) => slot.assignment.status !== "assigned"
      && slots.slice(index + 1).some((later) => later.assignment.status === "assigned"));
    if (firstVacancy < 0) continue;

    const tailSlots = slots;
    const placements = tailSlots
      .map((slot, index) => {
        if (slot.assignment.status !== "assigned" || !slot.assignment.staffId) return null;
        const person = state.staff.find((item) => item.id === slot.assignment.staffId);
        return person ? {
          person,
          sourceAssignment: slot.assignment,
          sourceRule: slot.rule,
          originalIndex: index,
          manualRemark: slot.assignment.manualRemark,
          decisionTrace: slot.assignment.decisionTrace,
          supervisorSourceAssignmentId: slot.assignment.supervisorSourceAssignmentId
        } : null;
      })
      .filter((placement): placement is RegularPlacement => Boolean(placement));
    const canPlace = (placement: RegularPlacement, slot: RegularSlot) => {
      if (lockedAssignmentIds.has(placement.sourceAssignment.id)
        && placement.sourceAssignment.id !== slot.assignment.id) return false;
      if (lockedAssignmentIds.has(slot.assignment.id)
        && placement.sourceAssignment.id !== slot.assignment.id) return false;
      return canMoveRegularPlacement(state, assignments, flight, placement, slot.rule);
    };
    const occupiedSlots: RegularSlot[] = [];
    for (const slot of tailSlots) {
      if (canCoverRegularSlots(placements, tailSlots, [...occupiedSlots, slot], canPlace)) occupiedSlots.push(slot);
      if (occupiedSlots.length === placements.length) break;
    }
    const placementBySlot = matchEveryPlacement(placements, occupiedSlots, canPlace);
    if (!placementBySlot) continue;
    const changed = tailSlots.some((slot) => placementBySlot.get(slot.assignment.id)?.sourceAssignment.id !== slot.assignment.id
      && (placementBySlot.has(slot.assignment.id) || slot.assignment.status === "assigned"));
    if (!changed) continue;

    for (const slot of tailSlots) {
      const placement = placementBySlot.get(slot.assignment.id);
      delete slot.assignment.systemNotes;
      delete slot.assignment.decisionTrace;
      delete slot.assignment.supervisorSourceAssignmentId;
      if (!placement) {
        slot.assignment.staffId = null;
        slot.assignment.staffName = "";
        slot.assignment.workHours = durationHours(flight.startTime, flight.endTime);
        slot.assignment.manualRemark = "";
        slot.assignment.status = "unfilled";
        continue;
      }
      slot.assignment.staffId = placement.person.id;
      slot.assignment.staffName = placement.person.name;
      slot.assignment.workHours = placement.supervisorSourceAssignmentId
        ? 0
        : durationHours(flight.startTime, flight.endTime);
      slot.assignment.manualRemark = placement.manualRemark;
      slot.assignment.status = "assigned";
      slot.assignment.decisionTrace = placement.sourceAssignment.id === slot.assignment.id
        ? placement.decisionTrace
        : [
          ...(placement.decisionTrace ?? []),
          schedulingDecision(
            "position-compaction",
            "selected",
            `为保持${flight.flightNo}岗位连续性，从${placement.sourceRule.name}调整至${slot.rule.name}`
          )
        ];
      if (placement.supervisorSourceAssignmentId) {
        slot.assignment.supervisorSourceAssignmentId = placement.supervisorSourceAssignmentId;
      }
    }
    changedFlightIds.add(flight.id);
  }

  for (const flightId of changedFlightIds) {
    const flight = state.flights.find((item) => item.id === flightId)!;
    const displayRules = activeFlightRules(state, flight);
    const displayIndex = new Map(displayRules.map((rule, index) => [rule.id, index]));
    const regularAssignments = assignments
      .filter((assignment) => assignment.flightId === flightId
        && assignment.status === "assigned"
        && assignment.staffId
        && assignmentRule(state, assignment)?.category === "常规")
      .sort((left, right) => (displayIndex.get(right.positionRuleId ?? "") ?? -1)
        - (displayIndex.get(left.positionRuleId ?? "") ?? -1));
    const usedStaffIds = new Set<string>();
    assignments
      .filter((assignment) => assignment.flightId === flightId
        && assignmentRule(state, assignment)?.category === "引导")
      .sort((left, right) => (displayIndex.get(left.positionRuleId ?? "") ?? 0)
        - (displayIndex.get(right.positionRuleId ?? "") ?? 0))
      .forEach((guide) => {
        const source = regularAssignments.find((assignment) => assignment.staffId
          && !usedStaffIds.has(assignment.staffId));
        guide.staffId = source?.staffId ?? null;
        guide.staffName = source?.staffName ?? "";
        guide.workHours = 0;
        guide.status = source ? "assigned" : "unfilled";
        delete guide.systemNotes;
        if (source?.staffId) usedStaffIds.add(source.staffId);
      });
  }

  assignments
    .filter((assignment) => changedFlightIds.has(assignment.flightId)
      && assignment.status === "unfilled"
      && isPreNoonFlight(assignment)
      && assignmentRule(state, assignment)?.category === "常规")
    .forEach((assignment) => {
      const flight = state.flights.find((item) => item.id === assignment.flightId)!;
      const rule = assignmentRule(state, assignment)!;
      assignment.systemNotes = [preNoonShortageNote(state, assignments, flight, rule)];
    });

  return changedFlightIds;
}
