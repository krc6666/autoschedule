import { dutyFatigueByStaff } from "../../domain/duty-roster/roster";
import { buildStaffLoads } from "../../domain/statistics/fatigue";
import { buildScheduleFeedback } from "../../domain/feedback/schedule-feedback";
import {
  assignmentRule,
  isFixedBottomPosition,
} from "../../domain/flights/schedule-position-rules";
import { countedWorkloadAssignments } from "../../domain/shared/workload-accounting";
import type { AppState, Assignment, Staff } from "../../model";

export type LoadSortField =
  "workHours" | "todayFatigue" | "historyFatigue" | "totalFatigue";
export type LoadSortDirection = "asc" | "desc";

export interface SchedulePageOptions {
  field: LoadSortField;
  direction: LoadSortDirection;
  zoom: number;
}

export interface ScheduleFlightGroup {
  flight: AppState["flights"][number];
  guideListId: string;
  guideCandidates: Staff[];
  primary: Assignment[];
  bottom: Assignment[];
}

function orderedAssignments(assignments: Assignment[]): Assignment[] {
  return assignments
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        (left.item.layoutIndex ?? left.index) -
          (right.item.layoutIndex ?? right.index) || left.index - right.index
    )
    .map(({ item }) => item);
}

function isBottomAssignment(state: AppState, assignment: Assignment): boolean {
  const rule = assignment.positionRuleId
    ? state.positionRules.find((item) => item.id === assignment.positionRuleId)
    : undefined;
  return (
    rule?.category === "引导" || isFixedBottomPosition(assignment.position)
  );
}

export function buildSchedulePageModel(
  state: AppState,
  date: string,
  options: SchedulePageOptions
) {
  const zoom = Math.min(1.6, Math.max(0.7, options.zoom));
  const scaled = (value: number): string =>
    `${Number((value * zoom).toFixed(1))}px`;
  const flights = [...state.flights].sort((left, right) =>
    left.startTime.localeCompare(right.startTime)
  );
  const groups: ScheduleFlightGroup[] = flights.map((flight, groupIndex) => {
    const assignments = state.assignments.filter(
      (item) => item.flightId === flight.id
    );
    const guideCandidates = assignments
      .filter(
        (assignment) =>
          assignment.status === "assigned" &&
          assignment.staffId &&
          assignmentRule(state, assignment)?.category === "常规"
      )
      .map((assignment) =>
        state.staff.find((person) => person.id === assignment.staffId)
      )
      .filter((person): person is Staff =>
        Boolean(person?.status === "正常" && person.staffType === "常规")
      )
      .filter(
        (person, index, people) =>
          people.findIndex((candidate) => candidate.id === person.id) === index
      );
    return {
      flight,
      guideListId: `schedule-guide-staff-${groupIndex}`,
      guideCandidates,
      primary: orderedAssignments(
        assignments.filter(
          (item) =>
            item.layoutGroup === "primary" ||
            (item.layoutGroup !== "bottom" && !isBottomAssignment(state, item))
        )
      ),
      bottom: orderedAssignments(
        assignments.filter(
          (item) =>
            item.layoutGroup === "bottom" ||
            (item.layoutGroup !== "primary" && isBottomAssignment(state, item))
        )
      ),
    };
  });
  const loads = buildStaffLoads(
    state.staff.filter((person) => person.staffType !== "行政支援"),
    countedWorkloadAssignments(state),
    state.history,
    date,
    state.settings,
    dutyFatigueByStaff(state, date)
  ).sort((left, right) => {
    const result = left[options.field] - right[options.field];
    return (
      (options.direction === "asc" ? result : -result) ||
      left.staff.name.localeCompare(right.staff.name, "zh-CN")
    );
  });
  return {
    groups,
    loads,
    feedback: buildScheduleFeedback(state, date),
    primaryRowCount:
      Math.max(0, ...groups.map((group) => group.primary.length)) + 1,
    bottomRowCount:
      Math.max(0, ...groups.map((group) => group.bottom.length)) + 1,
    regularStaff: state.staff.filter(
      (person) => person.staffType !== "行政支援"
    ),
    administrativeStaff: state.staff.filter(
      (person) => person.staffType === "行政支援"
    ),
    zoom,
    zoomPercent: Math.round(zoom * 100),
    tableStyles: {
      "--flight-count": String(Math.max(1, flights.length)),
      "--schedule-column-width": scaled(64),
      "--schedule-person-column-width": scaled(56),
      "--schedule-flight-width": scaled(120),
      "--schedule-header-height": scaled(50),
      "--schedule-cell-height": scaled(36),
      "--schedule-flight-size": scaled(14),
      "--schedule-position-size": scaled(11),
      "--schedule-small-size": scaled(10),
      "--schedule-tiny-size": scaled(9),
      "--schedule-input-height": scaled(19),
      "--schedule-name-width": scaled(48),
      "--schedule-divider-height": scaled(20),
    },
  };
}

export type SchedulePageModel = ReturnType<typeof buildSchedulePageModel>;
