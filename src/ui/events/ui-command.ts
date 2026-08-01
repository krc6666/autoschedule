import type { SchedulePolicyInput } from "../../app/policy-actions";
import type { WorkbookImportMode } from "../../app/workbook-import-controller";
import type { DutyRosterSlot } from "../../domain/duty-roster/roster";
import type { AppSection } from "../../model";

export type EditableValue = string | number | boolean;

export type UiCommand =
  | { type: "navigate"; section: AppSection }
  | { type: "change-date"; date: string }
  | { type: "open-import"; mode: WorkbookImportMode; date?: string }
  | {
      type: "import-file";
      file: File;
      mode?: WorkbookImportMode;
      date?: string;
    }
  | { type: "close-dialog" }
  | { type: "dismiss-toast" }
  | { type: "export-config" }
  | { type: "export-schedule" }
  | { type: "export-share-html" }
  | { type: "export-share-png" }
  | { type: "generate-schedule" }
  | {
      type: "update-configuration";
      entity: string;
      id: string;
      field: string;
      value: EditableValue;
    }
  | { type: "add-flight" }
  | { type: "delete-flight"; id: string }
  | { type: "open-flight-templates" }
  | { type: "add-template-flight"; id: string }
  | { type: "add-template" }
  | { type: "delete-template"; id: string }
  | { type: "add-staff"; administrative: boolean }
  | { type: "delete-staff"; id: string }
  | { type: "add-positions"; flightNo: string; count: number }
  | { type: "delete-position"; id: string }
  | { type: "move-position"; id: string; direction: -1 | 1 }
  | { type: "sort-counters"; flightNo: string }
  | { type: "open-qualification"; id: string }
  | {
      type: "save-qualification";
      id: string;
      manual: boolean;
      staffIds: string[];
    }
  | { type: "open-flight-query" }
  | { type: "run-flight-query"; date: string }
  | { type: "apply-flight-query"; templateIds: string[]; flightIds: string[] }
  | { type: "apply-policy"; input: SchedulePolicyInput }
  | {
      type: "update-policy";
      entity: string;
      id: string;
      field: string;
      value: EditableValue;
    }
  | {
      type: "add-policy-item";
      collection:
        | "duty"
        | "recovery-target"
        | "late-position"
        | "supervisor"
        | "transition";
    }
  | {
      type: "delete-policy-item";
      collection:
        | "duty"
        | "recovery-target"
        | "late-position"
        | "supervisor"
        | "transition";
      id: string;
    }
  | { type: "move-duty-priority"; id: string; direction: -1 | 1 }
  | { type: "set-hook-enabled"; id: string; enabled: boolean }
  | { type: "move-hook"; id: string; direction: -1 | 1 }
  | { type: "load-plugin"; file: File }
  | { type: "set-plugin-enabled"; id: string; enabled: boolean }
  | {
      type: "set-plugin-rule-enabled";
      pluginId: string;
      ruleId: string;
      enabled: boolean;
    }
  | { type: "move-plugin"; id: string; direction: -1 | 1 }
  | {
      type: "move-plugin-rule";
      pluginId: string;
      ruleId: string;
      direction: -1 | 1;
    }
  | { type: "remove-plugin"; id: string }
  | { type: "toggle-administrative-mode"; enabled: boolean }
  | {
      type: "assign-staff";
      assignmentId: string;
      staffId: string;
      sourceAssignmentId?: string;
    }
  | {
      type: "update-assignment";
      id: string;
      field: string;
      value: EditableValue;
    }
  | {
      type: "create-temporary-assignment";
      flightId: string;
      position: string;
      staffName: string;
      layoutGroup: "primary" | "bottom";
      layoutIndex: number;
    }
  | { type: "delete-temporary-assignment"; id: string }
  | { type: "clear-schedule" }
  | { type: "archive-schedule" }
  | { type: "archive-next-duty-day" }
  | { type: "set-schedule-zoom"; value: number }
  | {
      type: "set-load-sort";
      field: "workHours" | "todayFatigue" | "historyFatigue" | "totalFatigue";
      direction: "asc" | "desc";
    }
  | { type: "clear-history" }
  | { type: "delete-history"; id: string }
  | {
      type: "update-duty-roster";
      date: string;
      slot: DutyRosterSlot;
      staffId: string;
    }
  | { type: "reset-duty-roster"; date: string }
  | { type: "rebalance-duty-roster-month"; date: string }
  | { type: "download-duty-roster-template"; date: string }
  | { type: "apply-duty-roster-import" }
  | { type: "reset-all" };

export const UI_COMMAND_EVENT = "autoschedule-command";

export class UiCommandEvent extends CustomEvent<UiCommand> {
  constructor(command: UiCommand) {
    super(UI_COMMAND_EVENT, {
      detail: command,
      bubbles: true,
      composed: true,
    });
  }
}

export function dispatchUiCommand(
  target: EventTarget,
  command: UiCommand
): void {
  target.dispatchEvent(new UiCommandEvent(command));
}

export function inputValue(
  input: HTMLInputElement | HTMLSelectElement
): EditableValue {
  if (input instanceof HTMLInputElement && input.type === "checkbox")
    return input.checked;
  if (input instanceof HTMLInputElement && input.type === "number")
    return Number(input.value);
  return input.value;
}
