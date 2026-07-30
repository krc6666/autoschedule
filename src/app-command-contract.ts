export const APP_CLICK_ACTIONS = [
  "generate-schedule",
  "import-workbook",
  "import-config",
  "import-history",
  "import-duty-roster",
  "download-duty-roster-template",
  "apply-duty-roster-import",
  "export-config",
  "export-schedule",
  "export-share-html",
  "export-share-png",
  "add-flight",
  "open-online-flight-query",
  "run-online-flight-query",
  "apply-flight-plan-reconciliation",
  "delete-flight",
  "add-from-template",
  "select-template",
  "add-staff",
  "add-admin-staff",
  "delete-staff",
  "add-positions",
  "move-position-up",
  "move-position-down",
  "sort-counters-desc",
  "delete-position",
  "edit-qualified",
  "select-all-qualified",
  "clear-all-qualified",
  "save-qualified",
  "save-schedule-policy",
  "clear-policy-search",
  "add-duty-priority",
  "move-duty-priority-up",
  "move-duty-priority-down",
  "delete-duty-priority",
  "add-recovery-target",
  "delete-recovery-target",
  "add-late-shift-recovery-position",
  "delete-late-shift-recovery-position",
  "add-supervisor-coverage",
  "delete-supervisor-coverage",
  "add-transition-policy",
  "delete-transition-policy",
  "add-template",
  "delete-template",
  "clear-schedule",
  "archive-schedule",
  "archive-and-next-duty",
  "clear-history",
  "delete-history",
  "clear-assignment",
  "zoom-schedule-out",
  "zoom-schedule-reset",
  "zoom-schedule-in",
  "delete-assignment",
  "reset-duty-roster",
  "rebalance-duty-roster-month",
  "reset-all",
] as const;

export const APP_CHANGE_ACTIONS = [
  "assign-staff",
  "toggle-admin-support-mode",
  "load-sort-field",
  "load-sort-direction",
  "create-temporary-assignment",
] as const;

export type AppClickAction = (typeof APP_CLICK_ACTIONS)[number];
export type AppChangeAction = (typeof APP_CHANGE_ACTIONS)[number];
export type AppAction = AppClickAction | AppChangeAction;

const CLICK_ACTIONS = new Set<string>(APP_CLICK_ACTIONS);
const CHANGE_ACTIONS = new Set<string>(APP_CHANGE_ACTIONS);

export function isAppClickAction(value: string): value is AppClickAction {
  return CLICK_ACTIONS.has(value);
}

export function isAppChangeAction(value: string): value is AppChangeAction {
  return CHANGE_ACTIONS.has(value);
}

export function isAppAction(value: string): value is AppAction {
  return isAppClickAction(value) || isAppChangeAction(value);
}
