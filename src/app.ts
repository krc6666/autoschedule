import Modal from "bootstrap/js/dist/modal";
import Toast from "bootstrap/js/dist/toast";

import {
  addAdministrativeStaff as addAdministrativeStaffAction,
  addFlight as addFlightAction,
  addMobileSupervisorCoverageRule,
  addPositions as addPositionsAction,
  addStaff as addStaffAction,
  addTemplate as addTemplateAction,
  addTemplateFlight as addTemplateFlightAction,
  addTransitionPolicy as addTransitionPolicyAction,
  deleteFlight as deleteFlightAction,
  deleteMobileSupervisorCoverageRule,
  deletePosition as deletePositionAction,
  deleteStaff as deleteStaffAction,
  deleteTemplate as deleteTemplateAction,
  deleteTransitionPolicy as deleteTransitionPolicyAction,
  movePosition as movePositionAction,
  saveQualified as saveQualifiedAction,
  sortCountersDescending as sortCountersDescendingAction,
  updateConfigurationField
} from "./app/configuration-actions";
import {
  clearHistory as clearHistoryAction,
  currentScheduleHistory as buildCurrentScheduleHistory,
  deleteHistory as deleteHistoryAction,
  replaceHistoryForDate as replaceHistoryForDateAction
} from "./app/history-actions";
import {
  addDutyPriority as addDutyPriorityAction,
  applySchedulePolicy,
  deleteDutyPriority as deleteDutyPriorityAction,
  moveDutyPriority as moveDutyPriorityAction,
  updateDutyPriority
} from "./app/policy-actions";
import {
  assignStaff as editScheduleAssignment,
  createTemporaryAssignment as createTemporaryAssignmentAction,
  deleteTemporaryAssignment,
  updateAssignmentField as editScheduleAssignmentField
} from "./app/schedule-actions";
import { applyWorkbookImport } from "./app/workbook-actions";
import { createDefaultState } from "./defaults";
import { generateSchedule } from "./domain/scheduler";
import { addIsoDays } from "./domain/time";
import { applyStaffStatusChange } from "./domain/schedule-state";
import { clearDutyRosterOverride, clearMonthlyDutyRosterOverrides, updateDutyRosterSlot, type DutyRosterSlot } from "./domain/duty-roster";
import { clearState, loadState, saveState } from "./infrastructure/storage";
import type { AppSection, AppState, HistoryRecord } from "./model";
import { renderConfig } from "./ui/config-view";
import { renderFlights } from "./ui/flights-view";
import { renderHistory } from "./ui/history-view";
import { renderOverview } from "./ui/overview-view";
import { renderSchedule, type LoadSortDirection, type LoadSortField } from "./ui/schedule-view";
import { renderSchedulePolicy } from "./ui/schedule-policy-view";
import { renderShell } from "./ui/shell";
import { assertElement, escapeHtml, normalizeText, todayIso } from "./utils";

export class AutoScheduleApp {
  private state: AppState = loadState();
  private activeSection: AppSection = "overview";
  private scheduleDate = localStorage.getItem("autoschedule.scheduleDate") || todayIso();
  private loadSortField: LoadSortField = "totalFatigue";
  private loadSortDirection: LoadSortDirection = "desc";
  private loadDetailsOpen = false;
  private openDutyRosterSections = new Set<string>();
  private scheduleZoom = Math.min(1.6, Math.max(0.7, Number(localStorage.getItem("autoschedule.scheduleZoom")) || 1));
  private importMode: "all" | "config" | "history" = "all";
  private openPositionFlights = new Set<string>();
  private openPolicyCards = new Set<string>();
  private policySearchOpenCards: Set<string> | null = null;
  private openConfigSections = new Set<string>();
  private pointerDrag: { assignmentId: string; pointerId: number; startX: number; startY: number; active: boolean } | null = null;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("change", (event) => void this.handleChange(event));
    this.root.addEventListener("input", (event) => this.handleInput(event));
    this.root.addEventListener("dragstart", (event) => this.handleDragStart(event));
    this.root.addEventListener("dragover", (event) => this.handleDragOver(event));
    this.root.addEventListener("drop", (event) => this.handleDrop(event));
    this.root.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    this.root.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    this.root.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    this.root.addEventListener("pointercancel", () => this.cancelPointerDrag());
  }

  start(): void {
    this.render();
  }

  private view(): string {
    switch (this.activeSection) {
      case "config": return renderConfig(this.state);
      case "flights": return renderFlights(this.state);
      case "schedule": return renderSchedule(this.state, this.scheduleDate, { field: this.loadSortField, direction: this.loadSortDirection, zoom: this.scheduleZoom });
      case "policy": return renderSchedulePolicy(this.state);
      case "history": return renderHistory(this.state);
      default: return renderOverview(this.state, this.scheduleDate);
    }
  }

  private render(): void {
    this.loadDetailsOpen = this.root.querySelector<HTMLDetailsElement>(".load-details")?.open ?? this.loadDetailsOpen;
    this.openDutyRosterSections = new Set([...this.root.querySelectorAll<HTMLDetailsElement>(".duty-roster-details[open]")]
      .map((element) => element.dataset.dutyRosterSection ?? "").filter(Boolean));
    this.openPositionFlights = new Set([...this.root.querySelectorAll<HTMLDetailsElement>(".position-rule-group[open]")]
      .map((element) => element.dataset.positionFlight ?? "").filter(Boolean));
    this.openPolicyCards = this.policySearchOpenCards
      ? new Set(this.policySearchOpenCards)
      : new Set([...this.root.querySelectorAll<HTMLDetailsElement>(".policy-rule-card[open]")]
        .map((element) => element.dataset.policyCard ?? "").filter(Boolean));
    this.policySearchOpenCards = null;
    this.openConfigSections = new Set([...this.root.querySelectorAll<HTMLDetailsElement>(".config-collapsible[open]")]
      .map((element) => element.dataset.configSection ?? "").filter(Boolean));
    this.root.innerHTML = renderShell(this.state, this.activeSection, this.scheduleDate, this.view());
    this.root.querySelectorAll<HTMLDetailsElement>(".position-rule-group").forEach((element) => {
      element.open = this.openPositionFlights.has(element.dataset.positionFlight ?? "");
    });
    this.root.querySelectorAll<HTMLDetailsElement>(".policy-rule-card").forEach((element) => {
      element.open = this.openPolicyCards.has(element.dataset.policyCard ?? "");
    });
    this.root.querySelectorAll<HTMLDetailsElement>(".config-collapsible").forEach((element) => {
      element.open = this.openConfigSections.has(element.dataset.configSection ?? "");
    });
    const loadDetails = this.root.querySelector<HTMLDetailsElement>(".load-details");
    if (loadDetails) loadDetails.open = this.loadDetailsOpen;
    this.root.querySelectorAll<HTMLDetailsElement>(".duty-roster-details").forEach((element) => {
      element.open = this.openDutyRosterSections.has(element.dataset.dutyRosterSection ?? "");
    });
  }

  private commit(message?: string): void {
    this.state = saveState(this.state);
    this.render();
    if (message) this.toast(message, "success");
  }

  private toast(message: string, tone: "success" | "danger" | "warning" = "success"): void {
    const element = assertElement<HTMLElement>("#app-toast");
    element.className = `toast align-items-center border-0 text-bg-${tone}`;
    assertElement<HTMLElement>("#toast-body").textContent = message;
    Toast.getOrCreateInstance(element, { delay: 3600 }).show();
  }

  private modal(title: string, body: string, footer: string): void {
    assertElement<HTMLElement>("#modal-title").textContent = title;
    assertElement<HTMLElement>("#modal-body").innerHTML = body;
    assertElement<HTMLElement>("#modal-footer").innerHTML = footer;
    Modal.getOrCreateInstance(assertElement<HTMLElement>("#app-modal")).show();
  }

  private closeModal(): void {
    Modal.getInstance(assertElement<HTMLElement>("#app-modal"))?.hide();
  }

  private openImport(mode: "all" | "config" | "history"): void {
    this.importMode = mode;
    const input = assertElement<HTMLInputElement>("#workbook-input");
    input.value = "";
    input.click();
  }

  private handleDragStart(event: Event): void {
    const drag = (event.target as Element).closest<HTMLElement>("[data-drag-staff], [data-drag-assignment]");
    const dataTransfer = (event as DragEvent).dataTransfer;
    if (!drag || !dataTransfer) return;
    const payload = {
      staffId: drag.dataset.dragStaff ?? "",
      assignmentId: drag.dataset.dragAssignment ?? ""
    };
    dataTransfer.effectAllowed = "move";
    dataTransfer.setData("application/x-autoschedule", JSON.stringify(payload));
    dataTransfer.setData("text/plain", payload.staffId || payload.assignmentId);
  }

  private handleDragOver(event: Event): void {
    const target = (event.target as Element).closest<HTMLElement>("[data-drop-assignment]");
    if (target) {
      event.preventDefault();
      (event as DragEvent).dataTransfer!.dropEffect = "move";
    }
  }

  private handleDrop(event: Event): void {
    const target = (event.target as Element).closest<HTMLElement>("[data-drop-assignment]");
    if (!target) return;
    event.preventDefault();
    const dataTransfer = (event as DragEvent).dataTransfer;
    if (!dataTransfer) return;
    let payload: { staffId?: string; assignmentId?: string } = {};
    try { payload = JSON.parse(dataTransfer.getData("application/x-autoschedule") || "{}"); } catch { return; }
    const assignmentId = target.dataset.dropAssignment ?? "";
    if (!assignmentId || !payload.staffId) {
      const source = payload.assignmentId ? this.state.assignments.find((item) => item.id === payload.assignmentId) : undefined;
      if (source?.staffId) this.assignStaff(assignmentId, source.staffId, source.id);
      return;
    }
    this.assignStaff(assignmentId, payload.staffId, payload.assignmentId);
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const drag = (event.target as Element).closest<HTMLElement>("[data-drag-assignment]");
    if (!drag?.dataset.dragAssignment) return;
    this.pointerDrag = {
      assignmentId: drag.dataset.dragAssignment,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
  }

  private handlePointerMove(event: PointerEvent): void {
    const drag = this.pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    drag.active = true;
    event.preventDefault();
    this.root.classList.add("is-pointer-dragging");
    const board = this.root.querySelector<HTMLElement>(".schedule-board");
    if (board) {
      const bounds = board.getBoundingClientRect();
      if (event.clientX < bounds.left + 28) board.scrollLeft -= 18;
      else if (event.clientX > bounds.right - 28) board.scrollLeft += 18;
    }
    this.root.querySelectorAll(".schedule-cell.is-drop-target").forEach((element) => element.classList.remove("is-drop-target"));
    document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-drop-assignment]")
      ?.classList.add("is-drop-target");
  }

  private handlePointerUp(event: PointerEvent): void {
    const drag = this.pointerDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = drag.active
      ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-drop-assignment]")
      : null;
    this.cancelPointerDrag();
    const targetId = target?.dataset.dropAssignment ?? "";
    if (!targetId || targetId === drag.assignmentId) return;
    const source = this.state.assignments.find((assignment) => assignment.id === drag.assignmentId);
    if (source?.staffId) this.assignStaff(targetId, source.staffId, source.id);
  }

  private cancelPointerDrag(): void {
    this.pointerDrag = null;
    this.root.classList.remove("is-pointer-dragging");
    this.root.querySelectorAll(".schedule-cell.is-drop-target").forEach((element) => element.classList.remove("is-drop-target"));
  }

  private handleClick(event: Event): void {
    const target = (event.target as Element).closest<HTMLElement>("[data-nav], [data-action]");
    if (!target) return;
    const nav = target.dataset.nav as AppSection | undefined;
    if (nav) {
      this.activeSection = nav;
      this.render();
      return;
    }
    const action = target.dataset.action;
    const id = target.dataset.id ?? "";
    if (!action) return;

    const actions: Record<string, () => void> = {
      "generate-schedule": () => this.generate(),
      "import-workbook": () => this.openImport("all"),
      "import-config": () => this.openImport("config"),
      "import-history": () => this.openImport("history"),
      "export-config": () => void this.exportConfig(),
      "export-schedule": () => void this.exportSchedule(),
      "export-share-html": () => void this.exportHtml(),
      "export-share-png": () => void this.exportPng(),
      "add-flight": () => this.addFlight(),
      "delete-flight": () => this.deleteFlight(id),
      "add-from-template": () => this.showTemplates(),
      "select-template": () => this.addTemplateFlight(id),
      "add-staff": () => this.addStaff(),
      "add-admin-staff": () => this.addAdministrativeStaff(),
      "delete-staff": () => this.deleteStaff(id),
      "add-positions": () => this.addPositions(),
      "move-position-up": () => this.movePosition(id, -1),
      "move-position-down": () => this.movePosition(id, 1),
      "sort-counters-desc": () => this.sortCountersDescending(target.dataset.flightNo ?? ""),
      "delete-position": () => this.deletePosition(id),
      "edit-qualified": () => this.showQualified(id),
      "select-all-qualified": () => this.setQualifiedSelection(true),
      "clear-all-qualified": () => this.setQualifiedSelection(false),
      "save-qualified": () => this.saveQualified(id),
      "save-schedule-policy": () => this.saveSchedulePolicy(),
      "clear-policy-search": () => this.clearPolicySearch(),
      "add-duty-priority": () => this.addDutyPriority(),
      "move-duty-priority-up": () => this.moveDutyPriority(id, -1),
      "move-duty-priority-down": () => this.moveDutyPriority(id, 1),
      "delete-duty-priority": () => this.deleteDutyPriority(id),
      "add-supervisor-coverage": () => this.addSupervisorCoverageRule(),
      "delete-supervisor-coverage": () => this.deleteSupervisorCoverageRule(id),
      "add-transition-policy": () => this.addTransitionPolicy(),
      "delete-transition-policy": () => this.deleteTransitionPolicy(id),
      "add-template": () => this.addTemplate(),
      "delete-template": () => this.deleteTemplate(id),
      "clear-schedule": () => this.clearSchedule(),
      "archive-schedule": () => this.archiveSchedule(),
      "archive-and-next-duty": () => this.archiveAndScheduleNextDutyDay(),
      "clear-history": () => this.clearHistory(),
      "delete-history": () => this.deleteHistory(id),
      "clear-assignment": () => this.assignStaff(id, ""),
      "zoom-schedule-out": () => this.changeScheduleZoom(-0.1),
      "zoom-schedule-reset": () => this.setScheduleZoom(1),
      "zoom-schedule-in": () => this.changeScheduleZoom(0.1),
      "delete-assignment": () => this.deleteAssignment(id),
      "reset-duty-roster": () => this.resetDutyRoster(id),
      "rebalance-duty-roster-month": () => this.rebalanceDutyRosterMonth(id),
      "reset-all": () => this.resetAll()
    };
    actions[action]?.();
  }

  private handleInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.id === "policy-rule-search") this.filterPolicyRules(target.value);
  }

  private filterPolicyRules(value: string): void {
    const query = normalizeText(value).toLocaleLowerCase("zh-CN");
    const cards = [...this.root.querySelectorAll<HTMLDetailsElement>(".schedule-policy-section > .policy-rule-card")];
    const allCards = [...this.root.querySelectorAll<HTMLDetailsElement>(".schedule-policy-section .policy-rule-card")];
    if (query && !this.policySearchOpenCards) {
      this.policySearchOpenCards = new Set(allCards.filter((card) => card.open).map((card) => card.dataset.policyCard ?? ""));
    }
    const searchableText = (element: HTMLElement): string => [
      element.textContent ?? "",
      ...[...element.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")].map((input) => input.value)
    ].join(" ").toLocaleLowerCase("zh-CN");
    cards.forEach((card) => {
      const summaryMatches = Boolean(query) && searchableText(card.querySelector<HTMLElement>(":scope > summary") ?? card).includes(query);
      card.hidden = Boolean(query) && !searchableText(card).includes(query);
      if (query && !card.hidden) card.open = true;
      card.querySelectorAll<HTMLDetailsElement>(".policy-transition-card").forEach((nested) => {
        nested.hidden = Boolean(query) && !summaryMatches && !searchableText(nested).includes(query);
        if (query && !nested.hidden) nested.open = true;
      });
      card.querySelectorAll<HTMLTableRowElement>(".policy-ledger-table tbody tr").forEach((row) => {
        row.hidden = Boolean(query) && !summaryMatches && !(row.textContent ?? "").toLocaleLowerCase("zh-CN").includes(query);
      });
    });
    if (!query && this.policySearchOpenCards) {
      cards.forEach((card) => {
        card.hidden = false;
        card.querySelectorAll<HTMLElement>(".policy-transition-card, .policy-ledger-table tbody tr").forEach((element) => { element.hidden = false; });
      });
      allCards.forEach((card) => { card.open = this.policySearchOpenCards?.has(card.dataset.policyCard ?? "") ?? false; });
      this.policySearchOpenCards = null;
    }
  }

  private clearPolicySearch(): void {
    const input = this.root.querySelector<HTMLInputElement>("#policy-rule-search");
    if (!input) return;
    input.value = "";
    this.filterPolicyRules("");
    input.focus();
  }

  private async handleChange(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.id === "workbook-input" && target instanceof HTMLInputElement) {
      const file = target.files?.[0];
      if (file) await this.loadWorkbook(file);
      return;
    }
    if (target.id === "schedule-date") {
      const nextDate = target.value || todayIso();
      if (this.state.assignments.length && this.state.activeScheduleDate !== nextDate) {
        this.state.assignments = [];
        this.state.activeScheduleDate = null;
        this.state = saveState(this.state);
      }
      this.scheduleDate = nextDate;
      localStorage.setItem("autoschedule.scheduleDate", this.scheduleDate);
      this.render();
      return;
    }
    if (target.dataset.action === "assign-staff") {
      this.assignStaff(target.dataset.id ?? "", target.value);
      return;
    }
    if (target.dataset.action === "toggle-admin-support-mode" && target instanceof HTMLInputElement) {
      this.toggleAdministrativeSupport(target.checked);
      return;
    }
    if (target.dataset.action === "load-sort-field") {
      const field = target.value as LoadSortField;
      if (["workHours", "todayFatigue", "historyFatigue", "totalFatigue"].includes(field)) this.loadSortField = field;
      this.render();
      return;
    }
    if (target.dataset.action === "load-sort-direction") {
      this.loadSortDirection = target.value === "asc" ? "asc" : "desc";
      this.render();
      return;
    }
    if (target.dataset.action === "create-temporary-assignment") {
      this.createTemporaryAssignment(target);
      return;
    }
    const entity = target.dataset.entity;
    const id = target.dataset.id ?? "";
    const field = target.dataset.field ?? "";
    if (entity && field) this.updateField(entity, id, field, target);
  }

  private generate(): void {
    const result = generateSchedule(this.state, this.scheduleDate);
    this.state.assignments = result.assignments;
    this.state.activeScheduleDate = this.scheduleDate;
    this.activeSection = "schedule";
    this.commit(result.unfilledCount ? `排班已生成，${result.unfilledCount} 个岗位待补位` : "排班已完整生成");
  }

  private async exportPng(): Promise<void> {
    try {
      const { exportSharePng } = await import("./infrastructure/share");
      await exportSharePng(this.state, this.scheduleDate);
      this.toast("排班图片已导出");
    } catch (error) {
      this.toast(`图片导出失败：${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  private async exportConfig(): Promise<void> {
    const { buildConfigWorkbook, writeWorkbook } = await import("./infrastructure/excel");
    writeWorkbook(buildConfigWorkbook(this.state), "自动排班配置.xlsx");
  }

  private async exportSchedule(): Promise<void> {
    const { buildScheduleWorkbook, writeWorkbook } = await import("./infrastructure/excel");
    writeWorkbook(buildScheduleWorkbook(this.state.assignments, this.scheduleDate), `排班表_${this.scheduleDate}.xlsx`);
  }

  private async exportHtml(): Promise<void> {
    const { exportShareHtml } = await import("./infrastructure/share");
    exportShareHtml(this.state, this.scheduleDate);
  }

  private addFlight(): void {
    addFlightAction(this.state);
    this.commit("已新增航班");
  }

  private toggleAdministrativeSupport(enabled: boolean): void {
    this.state.settings.adminSupportEnabled = enabled;
    const result = generateSchedule(this.state, this.scheduleDate);
    this.state.assignments = result.assignments;
    this.state.activeScheduleDate = this.scheduleDate;
    this.commit(enabled ? "行政支援模式已启用，行政岗位已留空" : "行政支援模式已关闭");
  }

  private changeScheduleZoom(delta: number): void {
    this.setScheduleZoom(this.scheduleZoom + delta);
  }

  private setScheduleZoom(value: number): void {
    this.scheduleZoom = Math.min(1.6, Math.max(0.7, Number(value.toFixed(1))));
    localStorage.setItem("autoschedule.scheduleZoom", String(this.scheduleZoom));
    this.render();
  }

  private saveSchedulePolicy(): void {
    const readNumber = (selector: string): number => Number(assertElement<HTMLInputElement>(selector).value);
    const readMode = (selector: string): "prefer" | "forbid" => assertElement<HTMLSelectElement>(selector).value === "forbid" ? "forbid" : "prefer";
    const regenerate = applySchedulePolicy(this.state, {
      highLoadProtectionEnabled: assertElement<HTMLInputElement>("#policy-enabled").checked,
      highLoadFatigueThreshold: readNumber("#policy-fatigue-threshold"),
      highLoadRecoveryMinutes: readNumber("#policy-recovery-minutes"),
      remarkedPositionHighLoad: assertElement<HTMLInputElement>("#policy-remarked-high-load").checked,
      highLoadTransitionMode: readMode("#policy-transition-mode"),
      rollingLoadProtectionEnabled: assertElement<HTMLInputElement>("#policy-rolling-load-enabled").checked,
      rollingLoadWindowMinutes: readNumber("#policy-rolling-window-minutes"),
      rollingLoadMaxFatigue: readNumber("#policy-rolling-max-fatigue"),
      rollingLoadMode: readMode("#policy-rolling-load-mode"),
      positionRotationEnabled: assertElement<HTMLInputElement>("#policy-rotation-enabled").checked,
      lateShiftRecoveryEnabled: assertElement<HTMLInputElement>("#policy-late-shift-recovery-enabled").checked,
      lateShiftStartTime: assertElement<HTMLInputElement>("#policy-late-shift-start-time").value,
      lateShiftLatestWindowMinutes: readNumber("#policy-late-shift-latest-window"),
      nextDayLateMaxFatigue: readNumber("#policy-next-day-late-max-fatigue"),
      lateShiftRecoveryMode: readMode("#policy-late-shift-recovery-mode"),
      workloadBalanceEnabled: assertElement<HTMLInputElement>("#policy-workload-balance-enabled").checked,
      maxWorkHoursDifference: readNumber("#policy-max-work-hours-difference"),
      maxTodayFatigueDifference: readNumber("#policy-max-today-fatigue-difference"),
      dutyFatiguePoints: readNumber("#policy-duty-fatigue-points"),
      earlyDepartureCutoffTime: assertElement<HTMLInputElement>("#policy-early-departure-cutoff").value,
      afternoonRestStartTime: assertElement<HTMLInputElement>("#policy-afternoon-rest-start").value,
      afternoonRestEndTime: assertElement<HTMLInputElement>("#policy-afternoon-rest-end").value
    });
    if (regenerate) {
      const result = generateSchedule(this.state, this.scheduleDate);
      this.state.assignments = result.assignments;
      this.state.activeScheduleDate = this.scheduleDate;
    }
    this.commit(regenerate ? "排班规则已保存，当前排班已重新生成" : "排班规则已保存，将用于下次排班");
  }

  private addDutyPriority(): void {
    addDutyPriorityAction(this.state);
    this.openPolicyCards.add("duty-rules");
    this.commit("已新增值班岗位优先项");
  }

  private moveDutyPriority(id: string, direction: -1 | 1): void {
    if (!moveDutyPriorityAction(this.state, id, direction)) return;
    this.openPolicyCards.add("duty-rules");
    this.commit("值班岗位优先顺序已调整");
  }

  private deleteDutyPriority(id: string): void {
    const priority = this.state.settings.dutyPositionPriorities.find((item) => item.id === id);
    if (!priority || !confirm(`确认删除 ${priority.flightNo || "未填写航班"} / ${priority.positionKeyword || "任意岗位"}？`)) return;
    if (!deleteDutyPriorityAction(this.state, id)) return;
    this.openPolicyCards.add("duty-rules");
    this.commit("值班岗位优先项已删除");
  }

  private addSupervisorCoverageRule(): void {
    addMobileSupervisorCoverageRule(this.state);
    this.openPolicyCards.add("supervisor-coverage");
    this.commit("已新增机动督导兼任规则");
  }

  private deleteSupervisorCoverageRule(id: string): void {
    const rule = this.state.settings.mobileSupervisorCoverageRules.find((item) => item.id === id);
    if (!rule || !confirm(`确认删除机动督导兼任规则“${rule.keyword || "未填写关键词"}”？`)) return;
    if (!deleteMobileSupervisorCoverageRule(this.state, id)) return;
    this.openPolicyCards.add("supervisor-coverage");
    this.commit("机动督导兼任规则已删除");
  }

  private addTransitionPolicy(): void {
    addTransitionPolicyAction(this.state);
    this.commit("已新增衔接规则，请编辑后保存并应用");
  }

  private deleteTransitionPolicy(id: string): void {
    const policy = this.state.settings.positionTransitionPolicies.find((item) => item.id === id);
    if (!policy || !confirm(`确认删除衔接规则“${policy.name}”？`)) return;
    if (!deleteTransitionPolicyAction(this.state, id)) return;
    this.commit("衔接规则已删除，保存并应用后重新排班");
  }

  private addTemplate(): void {
    addTemplateAction(this.state);
    this.commit("已新增航班模板");
  }

  private deleteFlight(id: string): void {
    const flight = this.state.flights.find((item) => item.id === id);
    if (!flight || !confirm(`确认删除航班 ${flight.flightNo}？`)) return;
    if (!deleteFlightAction(this.state, id)) return;
    this.commit("航班已删除");
  }

  private showTemplates(): void {
    this.modal("从模板添加航班", this.state.templates.length ? `<div class="list-group">${this.state.templates.map((template) => `<button class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" type="button" data-action="select-template" data-id="${template.id}"><span><strong>${escapeHtml(template.flightNo)}</strong><small class="text-secondary ms-3">${escapeHtml(template.startTime)}–${escapeHtml(template.endTime)}</small></span><span class="badge text-bg-light">${template.positions.length} 岗</span></button>`).join("")}</div>` : `<div class="empty-state">尚无航班模板</div>`, `<button class="btn btn-secondary" type="button" data-bs-dismiss="modal">关闭</button>`);
  }

  private addTemplateFlight(id: string): void {
    if (!addTemplateFlightAction(this.state, id)) return;
    this.closeModal();
    this.commit("已从模板添加航班");
  }

  private addStaff(): void {
    addStaffAction(this.state);
    this.commit("已新增人员");
  }

  private addAdministrativeStaff(): void {
    addAdministrativeStaffAction(this.state);
    this.commit("已新增行政支援人员");
  }

  private deleteStaff(id: string): void {
    const person = this.state.staff.find((item) => item.id === id);
    if (!person || !confirm(`确认删除 ${person.name}？相关岗位资质也会同步移除。`)) return;
    if (!deleteStaffAction(this.state, id)) return;
    this.commit("人员已删除");
  }

  private addPositions(): void {
    const flightNo = assertElement<HTMLSelectElement>("#position-flight").value;
    const requestedCount = Number(assertElement<HTMLInputElement>("#position-batch-count").value);
    if (!flightNo) { this.toast("请先配置航班", "warning"); return; }
    const count = addPositionsAction(this.state, flightNo, requestedCount);
    this.commit(`已为 ${flightNo} 新增 ${count} 条岗位规则`);
  }

  private deletePosition(id: string): void {
    const rule = this.state.positionRules.find((item) => item.id === id);
    if (!rule || !confirm(`确认删除 ${rule.flightNo} / ${rule.name}？`)) return;
    if (!deletePositionAction(this.state, id)) return;
    this.commit("岗位规则已删除");
  }

  private movePosition(id: string, direction: -1 | 1): void {
    if (!movePositionAction(this.state, id, direction)) return;
    this.commit("岗位顺序已调整");
  }

  private sortCountersDescending(flightNo: string): void {
    if (!flightNo) return;
    if (!sortCountersDescendingAction(this.state, flightNo)) return;
    this.commit(`${flightNo} 柜台已按编号从大到小排列`);
  }

  private createTemporaryAssignment(input: HTMLInputElement | HTMLSelectElement): void {
    const slot = input.closest<HTMLElement>("[data-empty-slot]");
    const flightId = slot?.dataset.flightId ?? "";
    if (!slot) return;
    const position = normalizeText(slot.querySelector<HTMLInputElement>('[data-empty-field="position"]')?.value) || "临时岗位";
    const staffName = normalizeText(slot.querySelector<HTMLInputElement>('[data-empty-field="staffName"]')?.value);
    if (!createTemporaryAssignmentAction(
      this.state,
      flightId,
      position,
      staffName,
      slot.dataset.layoutGroup === "bottom" ? "bottom" : "primary",
      Number(slot.dataset.layoutIndex) || 0
    )) return;
    this.commit("已增加临时岗位");
  }

  private showQualified(id: string): void {
    const rule = this.state.positionRules.find((item) => item.id === id);
    if (!rule) return;
    const body = `<div class="d-flex align-items-center justify-content-between gap-2 border-bottom pb-3 mb-3"><div class="form-check form-switch m-0"><input class="form-check-input" id="qualified-manual" type="checkbox" ${rule.manual ? "checked" : ""}><label class="form-check-label" for="qualified-manual">手动补位岗位</label></div><div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" type="button" data-action="select-all-qualified"><i class="bi bi-check2-square me-1"></i>全选</button><button class="btn btn-outline-secondary" type="button" data-action="clear-all-qualified"><i class="bi bi-square me-1"></i>全不选</button></div></div><div class="qualified-grid">${this.state.staff.map((person) => `<label class="form-check qualified-check"><input class="form-check-input" type="checkbox" name="qualified-staff" value="${escapeHtml(person.id)}" ${rule.qualifiedStaffIds.includes(person.id) ? "checked" : ""}><span class="form-check-label">${escapeHtml(person.name)} <small>#${escapeHtml(person.id)} · ${escapeHtml(person.staffType)}</small></span></label>`).join("")}</div>`;
    this.modal(`${rule.flightNo} / ${rule.name} 资质`, body, `<button class="btn btn-secondary" type="button" data-bs-dismiss="modal">取消</button><button class="btn btn-primary" type="button" data-action="save-qualified" data-id="${id}">保存</button>`);
  }

  private setQualifiedSelection(checked: boolean): void {
    document.querySelectorAll<HTMLInputElement>('input[name="qualified-staff"]').forEach((input) => { input.checked = checked; });
  }

  private saveQualified(id: string): void {
    const rule = this.state.positionRules.find((item) => item.id === id);
    if (!rule) return;
    const manual = assertElement<HTMLInputElement>("#qualified-manual").checked;
    const staffIds = [...document.querySelectorAll<HTMLInputElement>('input[name="qualified-staff"]:checked')].map((input) => input.value);
    if (!saveQualifiedAction(this.state, id, manual, staffIds)) return;
    this.closeModal();
    this.commit("岗位资质已保存");
  }

  private deleteTemplate(id: string): void {
    deleteTemplateAction(this.state, id);
    this.commit("模板已删除");
  }

  private assignStaff(assignmentId: string, staffId: string, sourceAssignmentId?: string): void {
    const result = editScheduleAssignment(this.state, assignmentId, staffId, sourceAssignmentId);
    if (result.error) { this.render(); this.toast(result.error, "danger"); return; }
    if (result.changed) this.commit(result.message);
  }

  private deleteAssignment(id: string): void {
    if (!deleteTemporaryAssignment(this.state, id)) return;
    this.commit("临时岗位已移除");
  }

  private clearSchedule(): void {
    if (!this.state.assignments.length || !confirm("确认清空当前排班？")) return;
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
    this.commit("当前排班已清空");
  }

  private archiveSchedule(): void {
    const records = this.currentScheduleHistory();
    if (!records.length) { this.toast("没有可归档的已排岗位", "warning"); return; }
    if (!confirm(`将 ${records.length} 条已排岗位归档到 ${this.scheduleDate}？同日旧记录会被替换。`)) return;
    this.replaceHistoryForDate(this.scheduleDate, records);
    this.commit("排班已归档到历史");
  }

  private currentScheduleHistory(): HistoryRecord[] {
    return buildCurrentScheduleHistory(this.state, this.scheduleDate);
  }

  private resetDutyRoster(date: string): void {
    clearDutyRosterOverride(this.state, date);
    this.commit(`${date} 已恢复顺序轮值`);
  }

  private rebalanceDutyRosterMonth(date: string): void {
    if (!confirm(`清除 ${date.slice(0, 7)} 的人工轮值调整，并按值班优先规则重新均衡？`)) return;
    clearMonthlyDutyRosterOverrides(this.state, date);
    this.commit(`${date.slice(0, 7)} 已重新均衡轮值`);
  }

  private updateDutyRoster(date: string, slot: DutyRosterSlot, staffId: string): void {
    if (!staffId) { this.render(); this.toast("轮值人员不能为空", "danger"); return; }
    const error = updateDutyRosterSlot(this.state, date, slot, staffId);
    if (error) { this.render(); this.toast(error, "danger"); return; }
    this.commit(`${date} 轮值已调整`);
  }

  private replaceHistoryForDate(date: string, records: HistoryRecord[]): void {
    replaceHistoryForDateAction(this.state, date, records);
  }

  private archiveAndScheduleNextDutyDay(): void {
    const records = this.currentScheduleHistory();
    if (!records.length) { this.toast("没有可归档的已排岗位", "warning"); return; }
    const currentDate = this.scheduleDate;
    const nextDate = addIsoDays(currentDate, 2);
    if (!confirm(`归档 ${currentDate}，并根据今天的负荷生成后天 ${nextDate} 排班？`)) return;
    this.replaceHistoryForDate(currentDate, records);
    this.scheduleDate = nextDate;
    localStorage.setItem("autoschedule.scheduleDate", nextDate);
    const result = generateSchedule(this.state, nextDate);
    this.state.assignments = result.assignments;
    this.state.activeScheduleDate = nextDate;
    this.activeSection = "schedule";
    this.commit(result.unfilledCount
      ? `今天已归档，后天排班已生成，${result.unfilledCount} 个常规岗位待补位`
      : "今天已归档，已按今天负荷生成后天排班");
  }

  private clearHistory(): void {
    if (!this.state.history.length || !confirm("确认清空全部历史排班？")) return;
    clearHistoryAction(this.state);
    this.commit("历史排班已清空");
  }

  private deleteHistory(id: string): void {
    deleteHistoryAction(this.state, id);
    this.commit("历史记录已删除");
  }

  private resetAll(): void {
    if (!confirm("确认恢复初始数据？当前本地数据将被替换。")) return;
    clearState();
    this.state = createDefaultState();
    this.commit("已恢复初始数据");
  }

  private async loadWorkbook(file: File): Promise<void> {
    try {
      const { importWorkbook } = await import("./infrastructure/excel");
      const imported = await importWorkbook(file, this.state.staff);
      const { recognized } = applyWorkbookImport(this.state, imported, this.importMode);
      this.importMode = "all";
      this.commit(recognized ? `已导入 ${recognized}` : imported.warnings[0] ?? "文件中没有有效数据");
    } catch (error) {
      this.toast(`导入失败：${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  private updateField(entity: string, id: string, field: string, input: HTMLInputElement | HTMLSelectElement): void {
    const value: string | number | boolean = input instanceof HTMLInputElement && input.type === "checkbox"
      ? input.checked
      : input instanceof HTMLInputElement && input.type === "number"
        ? Number(input.value)
        : input.value;
    if (entity === "duty-roster") {
      this.updateDutyRoster(id, input.dataset.dutySlot as DutyRosterSlot, String(value));
      return;
    }
    if (entity === "assignment") {
      const result = editScheduleAssignmentField(this.state, id, field, value);
      if (result.error) { this.render(); this.toast(result.error, "danger"); return; }
      if (!result.changed) return;
      this.commit();
      return;
    }
    if (entity === "staff" && field === "status") {
      const status = value === "病假" ? "病假" : value === "休假" ? "休假" : "正常";
      const result = applyStaffStatusChange(this.state, id, status);
      this.commit(result
        ? result.unfilledCount
          ? `人员状态已更新，当前排班已重新计算，${result.unfilledCount} 个岗位待补位`
          : "人员状态已更新，当前排班已重新计算"
        : "人员状态已更新");
      return;
    }
    if (entity === "duty-priority") {
      if (!updateDutyPriority(this.state, id, field, value)) return;
      this.state = saveState(this.state);
      return;
    }
    const result = updateConfigurationField(this.state, entity, id, field, value);
    if (result === "missing") return;
    if (result === "duplicate") {
      this.render();
      this.toast("人员编号不能重复", "danger");
      return;
    }
    if (result === "saved") {
      this.state = saveState(this.state);
      return;
    }
    this.commit();
  }
}
