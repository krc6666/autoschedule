import { isAuxiliaryCategory } from "../domain/scheduler";
import type { AppState, Flight, FlightTemplate } from "../model";
import { createId, normalizeText, orderPositionRules, sortFlightCountersDescending, splitList } from "../utils";

export type ConfigurationValue = string | number | boolean;

function clearSchedule(state: AppState): void {
  state.assignments = [];
  state.activeScheduleDate = null;
}

export function addFlight(state: AppState): void {
  const flight: Flight = {
    id: createId("flight"), flightNo: "NEW", startTime: "08:00", endTime: "10:00",
    bookedPassengers: 0, positions: [], remark: ""
  };
  state.flights.push(flight);
  clearSchedule(state);
}

export function deleteFlight(state: AppState, id: string): boolean {
  const before = state.flights.length;
  state.flights = state.flights.filter((item) => item.id !== id);
  if (state.flights.length === before) return false;
  clearSchedule(state);
  return true;
}

export function addTemplate(state: AppState): void {
  const template: FlightTemplate = {
    id: createId("template"), flightNo: "NEW", startTime: "08:00", endTime: "10:00", positions: [], remark: ""
  };
  state.templates.push(template);
}

export function deleteTemplate(state: AppState, id: string): void {
  state.templates = state.templates.filter((item) => item.id !== id);
}

export function addTemplateFlight(state: AppState, id: string): boolean {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return false;
  state.flights.push({ ...structuredClone(template), id: createId("flight"), bookedPassengers: 0 });
  clearSchedule(state);
  return true;
}

export function addTransitionPolicy(state: AppState): void {
  const sourceFlight = state.flights[0];
  const targetFlight = state.flights.at(-1) ?? sourceFlight;
  state.settings.positionTransitionPolicies.push({
    id: createId("transition-policy"),
    name: "新岗位衔接规则",
    enabled: false,
    sourceFlightNo: sourceFlight?.flightNo ?? "",
    sourcePositions: [],
    targetFlightNo: targetFlight?.flightNo ?? "",
    targetPosition: "",
    minimumGapMinutes: 180,
    mode: "prefer"
  });
}

export function deleteTransitionPolicy(state: AppState, id: string): boolean {
  const before = state.settings.positionTransitionPolicies.length;
  state.settings.positionTransitionPolicies = state.settings.positionTransitionPolicies.filter((item) => item.id !== id);
  return state.settings.positionTransitionPolicies.length !== before;
}

export function addStaff(state: AppState): void {
  const numericIds = state.staff.map((item) => Number(item.id)).filter(Number.isFinite);
  const id = String(Math.max(0, ...numericIds) + 1);
  state.staff.push({ id, name: "新人员", staffType: "常规", cxPreflightQualified: false, dutyQualified: true, nightShift: true, status: "正常", remark: "" });
}

export function addAdministrativeStaff(state: AppState): void {
  let sequence = 1;
  while (state.staff.some((person) => person.id === `A${sequence}`)) sequence += 1;
  state.staff.push({
    id: `A${sequence}`,
    name: `行政支援${sequence}`,
    staffType: "行政支援",
    cxPreflightQualified: false,
    dutyQualified: false,
    nightShift: true,
    status: "正常",
    remark: ""
  });
}

export function deleteStaff(state: AppState, id: string): boolean {
  const before = state.staff.length;
  state.staff = state.staff.filter((item) => item.id !== id);
  if (state.staff.length === before) return false;
  state.positionRules.forEach((rule) => {
    rule.qualifiedStaffIds = rule.qualifiedStaffIds.filter((staffId) => staffId !== id);
  });
  state.dutyRosterOverrides = state.dutyRosterOverrides.map((item) => ({
    ...item,
    cxPreflightStaffId: item.cxPreflightStaffId === id ? null : item.cxPreflightStaffId,
    dutyStaffId: item.dutyStaffId === id ? null : item.dutyStaffId,
    standbyStaffIds: item.standbyStaffIds.map((staffId) => staffId === id ? null : staffId) as [string | null, string | null]
  }));
  state.assignments = state.assignments.map((item) => {
    if (item.staffId !== id) return item;
    const rule = item.positionRuleId ? state.positionRules.find((ruleItem) => ruleItem.id === item.positionRuleId) : undefined;
    return { ...item, staffId: null, staffName: "", status: isAuxiliaryCategory(rule?.category) || !item.positionRuleId ? "manual" : "unfilled" };
  });
  return true;
}

export function addPositions(state: AppState, flightNo: string, requestedCount: number): number {
  if (!flightNo) return 0;
  const count = Math.max(1, Math.min(30, requestedCount || 1));
  const existingNames = new Set(state.positionRules.filter((item) => item.flightNo === flightNo).map((item) => item.name));
  let nextNumber = 1;
  for (let index = 0; index < count; index += 1) {
    while (existingNames.has(`新岗位${nextNumber}`)) nextNumber += 1;
    const name = `新岗位${nextNumber}`;
    existingNames.add(name);
    state.positionRules.push({ id: createId("position"), flightNo, name, category: "常规", remark: "", qualifiedStaffIds: [], manual: false, fatiguePoints: 1, minPassengers: 0, earlyReleaseMinutes: 0 });
    nextNumber += 1;
  }
  clearSchedule(state);
  return count;
}

export function deletePosition(state: AppState, id: string): boolean {
  const before = state.positionRules.length;
  state.positionRules = state.positionRules.filter((item) => item.id !== id);
  if (state.positionRules.length === before) return false;
  clearSchedule(state);
  return true;
}

export function movePosition(state: AppState, id: string, direction: -1 | 1): boolean {
  const rule = state.positionRules.find((item) => item.id === id);
  if (!rule) return false;
  const siblingIndexes = state.positionRules
    .map((item, index) => item.flightNo === rule.flightNo ? index : -1)
    .filter((index) => index >= 0);
  const currentSiblingIndex = siblingIndexes.indexOf(state.positionRules.indexOf(rule));
  const targetIndex = siblingIndexes[currentSiblingIndex + direction];
  if (targetIndex === undefined) return false;
  const currentIndex = state.positionRules.indexOf(rule);
  [state.positionRules[currentIndex], state.positionRules[targetIndex]] = [state.positionRules[targetIndex]!, state.positionRules[currentIndex]!];
  state.positionRules = orderPositionRules(state.positionRules);
  clearSchedule(state);
  return true;
}

export function sortCountersDescending(state: AppState, flightNo: string): boolean {
  if (!flightNo) return false;
  state.positionRules = sortFlightCountersDescending(state.positionRules, flightNo);
  clearSchedule(state);
  return true;
}

export function saveQualified(state: AppState, id: string, manual: boolean, staffIds: string[]): boolean {
  const rule = state.positionRules.find((item) => item.id === id);
  if (!rule) return false;
  rule.manual = manual;
  rule.qualifiedStaffIds = [...staffIds];
  clearSchedule(state);
  return true;
}

export function updateConfigurationField(
  state: AppState,
  entity: string,
  id: string,
  field: string,
  value: ConfigurationValue
): "updated" | "missing" | "duplicate" | "saved" {
  if (entity === "settings") {
    const key = field as keyof AppState["settings"];
    (state.settings[key] as string | number) = value as string | number;
    clearSchedule(state);
    return "updated";
  }
  if (entity === "flight") {
    const flight = state.flights.find((item) => item.id === id);
    if (!flight) return "missing";
    if (field === "positions") flight.positions = splitList(value);
    else {
      const nextValue = typeof value === "string" && field === "flightNo" ? value.toUpperCase() : value;
      (flight as unknown as Record<string, unknown>)[field] = nextValue;
      if (field === "flightNo" && typeof nextValue === "string") {
        const template = state.templates.find((item) => item.flightNo.toUpperCase() === nextValue);
        if (template) {
          flight.startTime = template.startTime;
          flight.endTime = template.endTime;
          flight.positions = [...template.positions];
          flight.remark = template.remark;
        }
      }
    }
    clearSchedule(state);
    return "updated";
  }
  if (entity === "position") {
    const rule = state.positionRules.find((item) => item.id === id);
    if (!rule) return "missing";
    (rule as unknown as Record<string, unknown>)[field] = typeof value === "string" && field === "flightNo" ? value.toUpperCase() : value;
    if (field === "category") {
      if (value === "分流" && !rule.earlyReleaseMinutes) rule.earlyReleaseMinutes = 60;
      if (value !== "分流") rule.earlyReleaseMinutes = 0;
      if (value === "引导") {
        rule.manual = false;
        rule.qualifiedStaffIds = [];
      }
    }
    if (field === "name" || field === "flightNo") state.positionRules = orderPositionRules(state.positionRules);
    clearSchedule(state);
    return "updated";
  }
  if (entity === "transition-policy") {
    const policy = state.settings.positionTransitionPolicies.find((item) => item.id === id);
    if (!policy) return "missing";
    if (field === "sourcePositions") policy.sourcePositions = splitList(value);
    else if (field === "minimumGapMinutes") policy.minimumGapMinutes = Math.min(1440, Math.max(0, Math.round(Number(value)) || 0));
    else if (field === "sourceFlightNo" || field === "targetFlightNo") (policy as unknown as Record<string, unknown>)[field] = normalizeText(value).toUpperCase();
    else if (field === "mode") policy.mode = value === "forbid" ? "forbid" : "prefer";
    else if (field === "enabled") policy.enabled = Boolean(value);
    else if (field === "name" || field === "targetPosition") (policy as unknown as Record<string, unknown>)[field] = normalizeText(value);
    return "saved";
  }
  if (entity === "template") {
    const template = state.templates.find((item) => item.id === id);
    if (!template) return "missing";
    if (field === "positions") template.positions = splitList(value);
    else (template as unknown as Record<string, unknown>)[field] = typeof value === "string" && field === "flightNo" ? value.toUpperCase() : value;
    return "updated";
  }
  if (entity === "staff") {
    const person = state.staff.find((item) => item.id === id);
    if (!person) return "missing";
    if (field === "name") {
      const nextName = normalizeText(value) || person.name;
      person.name = nextName;
      state.assignments.forEach((item) => { if (item.staffId === id) item.staffName = nextName; });
      state.history.forEach((item) => { if (item.staffId === id) item.staffName = nextName; });
      return "updated";
    }
    if (field === "id" && typeof value === "string" && value !== id) {
      if (state.staff.some((item) => item.id === value)) return "duplicate";
      state.positionRules.forEach((rule) => { rule.qualifiedStaffIds = rule.qualifiedStaffIds.map((staffId) => staffId === id ? value : staffId); });
      state.assignments.forEach((item) => { if (item.staffId === id) item.staffId = value; });
      state.history.forEach((item) => { if (item.staffId === id) item.staffId = value; });
      state.dutyRosterOverrides.forEach((item) => {
        if (item.cxPreflightStaffId === id) item.cxPreflightStaffId = value;
        if (item.dutyStaffId === id) item.dutyStaffId = value;
        item.standbyStaffIds = item.standbyStaffIds.map((staffId) => staffId === id ? value : staffId) as [string | null, string | null];
      });
    }
    (person as unknown as Record<string, unknown>)[field] = value;
    if (field === "staffType" && value === "行政支援") {
      person.cxPreflightQualified = false;
      person.dutyQualified = false;
    }
    clearSchedule(state);
    return "updated";
  }
  return "missing";
}
