import Modal from "bootstrap/js/dist/modal";
import Toast from "bootstrap/js/dist/toast";

import { createDefaultState } from "./defaults";
import { activeFlightRules, applyEarlyReleaseForStaff, generateSchedule, canAssignStaff, isAuxiliaryCategory, isDiversionTransfer, isGuideAssignment } from "./domain/scheduler";
import { addIsoDays } from "./domain/time";
import { applyStaffStatusChange, assignmentUsesUnavailableStaff } from "./domain/schedule-state";
import { isSupervisorMoveSlot, moveSupervisorWithinFlight, normalizeSupervisorFillAssignments } from "./domain/schedule-adjustment";
import { clearDutyRosterOverride, clearMonthlyDutyRosterOverrides, getDutyRosterForDate, updateDutyRosterSlot, type DutyRosterSlot } from "./domain/duty-roster";
import { clearState, loadState, saveState } from "./infrastructure/storage";
import type { AppSection, AppState, Flight, FlightTemplate, HistoryRecord, PositionTransitionPolicy, Staff } from "./model";
import { renderConfig } from "./ui/config-view";
import { renderFlights } from "./ui/flights-view";
import { renderHistory } from "./ui/history-view";
import { renderOverview } from "./ui/overview-view";
import { renderSchedule, type LoadSortDirection, type LoadSortField } from "./ui/schedule-view";
import { renderSchedulePolicy } from "./ui/schedule-policy-view";
import { renderShell } from "./ui/shell";
import { assertElement, combinedAssignmentRemark, createId, escapeHtml, normalizeText, orderPositionRules, sortFlightCountersDescending, splitList, todayIso } from "./utils";

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
  private openConfigSections = new Set<string>();
  private pointerDrag: { assignmentId: string; pointerId: number; startX: number; startY: number; active: boolean } | null = null;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("change", (event) => void this.handleChange(event));
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
    this.openPolicyCards = new Set([...this.root.querySelectorAll<HTMLDetailsElement>(".policy-rule-card[open]")]
      .map((element) => element.dataset.policyCard ?? "").filter(Boolean));
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
    const flight: Flight = {
      id: createId("flight"), flightNo: "NEW", startTime: "08:00", endTime: "10:00",
      bookedPassengers: 0, positions: [], remark: ""
    };
    this.state.flights.push(flight);
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
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
    const enabled = assertElement<HTMLInputElement>("#policy-enabled").checked;
    const threshold = Number(assertElement<HTMLInputElement>("#policy-fatigue-threshold").value);
    const recoveryMinutes = Number(assertElement<HTMLInputElement>("#policy-recovery-minutes").value);
    const remarkedHighLoad = assertElement<HTMLInputElement>("#policy-remarked-high-load").checked;
    const mode = assertElement<HTMLSelectElement>("#policy-transition-mode").value === "forbid" ? "forbid" : "prefer";
    const rollingLoadEnabled = assertElement<HTMLInputElement>("#policy-rolling-load-enabled").checked;
    const rollingWindowMinutes = Number(assertElement<HTMLInputElement>("#policy-rolling-window-minutes").value);
    const rollingMaxFatigue = Number(assertElement<HTMLInputElement>("#policy-rolling-max-fatigue").value);
    const rollingLoadMode = assertElement<HTMLSelectElement>("#policy-rolling-load-mode").value === "forbid" ? "forbid" : "prefer";
    const rotationEnabled = assertElement<HTMLInputElement>("#policy-rotation-enabled").checked;
    const rotationLookbackDays = Number(assertElement<HTMLInputElement>("#policy-rotation-lookback-days").value);
    const rotationMode = assertElement<HTMLSelectElement>("#policy-rotation-mode").value === "forbid" ? "forbid" : "prefer";
    const lateShiftRecoveryEnabled = assertElement<HTMLInputElement>("#policy-late-shift-recovery-enabled").checked;
    const lateShiftStartTime = assertElement<HTMLInputElement>("#policy-late-shift-start-time").value;
    const lateShiftLatestWindowMinutes = Number(assertElement<HTMLInputElement>("#policy-late-shift-latest-window").value);
    const nextDayLateMaxFatigue = Number(assertElement<HTMLInputElement>("#policy-next-day-late-max-fatigue").value);
    const lateShiftRecoveryMode = assertElement<HTMLSelectElement>("#policy-late-shift-recovery-mode").value === "forbid" ? "forbid" : "prefer";
    const workloadBalanceEnabled = assertElement<HTMLInputElement>("#policy-workload-balance-enabled").checked;
    const maxWorkHoursDifference = Number(assertElement<HTMLInputElement>("#policy-max-work-hours-difference").value);
    const maxTodayFatigueDifference = Number(assertElement<HTMLInputElement>("#policy-max-today-fatigue-difference").value);
    const dutyFatiguePoints = Number(assertElement<HTMLInputElement>("#policy-duty-fatigue-points").value);
    this.state.settings.highLoadProtectionEnabled = enabled;
    this.state.settings.highLoadFatigueThreshold = Math.min(50, Math.max(0.5, Number.isFinite(threshold) ? threshold : 4));
    this.state.settings.highLoadRecoveryMinutes = Math.min(1440, Math.max(0, Number.isFinite(recoveryMinutes) ? Math.round(recoveryMinutes) : 360));
    this.state.settings.remarkedPositionHighLoad = remarkedHighLoad;
    this.state.settings.highLoadTransitionMode = mode;
    this.state.settings.rollingLoadProtectionEnabled = rollingLoadEnabled;
    this.state.settings.rollingLoadWindowMinutes = Math.min(1440, Math.max(0, Number.isFinite(rollingWindowMinutes) ? Math.round(rollingWindowMinutes) : 360));
    this.state.settings.rollingLoadMaxFatigue = Math.min(100, Math.max(0.5, Number.isFinite(rollingMaxFatigue) ? rollingMaxFatigue : 8));
    this.state.settings.rollingLoadMode = rollingLoadMode;
    this.state.settings.positionRotationEnabled = rotationEnabled;
    this.state.settings.positionRotationLookbackDays = Math.min(90, Math.max(1, Number.isFinite(rotationLookbackDays) ? Math.round(rotationLookbackDays) : 3));
    this.state.settings.positionRotationMode = rotationMode;
    this.state.settings.lateShiftRecoveryEnabled = lateShiftRecoveryEnabled;
    this.state.settings.lateShiftStartTime = lateShiftStartTime || "20:00";
    this.state.settings.lateShiftLatestWindowMinutes = Math.min(720, Math.max(0, Number.isFinite(lateShiftLatestWindowMinutes) ? Math.round(lateShiftLatestWindowMinutes) : 180));
    this.state.settings.nextDayLateMaxFatigue = Math.min(50, Math.max(0, Number.isFinite(nextDayLateMaxFatigue) ? nextDayLateMaxFatigue : 2));
    this.state.settings.lateShiftRecoveryMode = lateShiftRecoveryMode;
    this.state.settings.workloadBalanceEnabled = workloadBalanceEnabled;
    this.state.settings.maxWorkHoursDifference = Math.min(24, Math.max(0, Number.isFinite(maxWorkHoursDifference) ? maxWorkHoursDifference : 2));
    this.state.settings.maxTodayFatigueDifference = Math.min(100, Math.max(0, Number.isFinite(maxTodayFatigueDifference) ? maxTodayFatigueDifference : 4));
    this.state.settings.dutyFatiguePoints = Math.min(50, Math.max(0, Number.isFinite(dutyFatiguePoints) ? dutyFatiguePoints : 12));
    this.state.settings.positionTransitionPolicies = this.state.settings.positionTransitionPolicies.map((policy) => ({
      ...policy,
      name: normalizeText(policy.name) || "未命名衔接规则",
      sourceFlightNo: normalizeText(policy.sourceFlightNo).toUpperCase(),
      sourcePositions: policy.sourcePositions.map(normalizeText).filter(Boolean),
      targetFlightNo: normalizeText(policy.targetFlightNo).toUpperCase(),
      targetPosition: normalizeText(policy.targetPosition),
      minimumGapMinutes: Math.min(1440, Math.max(0, Math.round(policy.minimumGapMinutes) || 0)),
      mode: policy.mode === "forbid" ? "forbid" : "prefer"
    }));
    const regenerate = this.state.assignments.length > 0;
    if (regenerate) {
      const result = generateSchedule(this.state, this.scheduleDate);
      this.state.assignments = result.assignments;
      this.state.activeScheduleDate = this.scheduleDate;
    }
    this.commit(regenerate ? "排班规则已保存，当前排班已重新生成" : "排班规则已保存，将用于下次排班");
  }

  private addTransitionPolicy(): void {
    const sourceFlight = this.state.flights[0];
    const targetFlight = this.state.flights.at(-1) ?? sourceFlight;
    const policy: PositionTransitionPolicy = {
      id: createId("transition-policy"),
      name: "新岗位衔接规则",
      enabled: false,
      sourceFlightNo: sourceFlight?.flightNo ?? "",
      sourcePositions: [],
      targetFlightNo: targetFlight?.flightNo ?? "",
      targetPosition: "",
      minimumGapMinutes: 180,
      mode: "prefer"
    };
    this.state.settings.positionTransitionPolicies.push(policy);
    this.commit("已新增衔接规则，请编辑后保存并应用");
  }

  private deleteTransitionPolicy(id: string): void {
    const policy = this.state.settings.positionTransitionPolicies.find((item) => item.id === id);
    if (!policy || !confirm(`确认删除衔接规则“${policy.name}”？`)) return;
    this.state.settings.positionTransitionPolicies = this.state.settings.positionTransitionPolicies.filter((item) => item.id !== id);
    this.commit("衔接规则已删除，保存并应用后重新排班");
  }

  private addTemplate(): void {
    const template: FlightTemplate = {
      id: createId("template"), flightNo: "NEW", startTime: "08:00", endTime: "10:00", positions: [], remark: ""
    };
    this.state.templates.push(template);
    this.commit("已新增航班模板");
  }

  private deleteFlight(id: string): void {
    const flight = this.state.flights.find((item) => item.id === id);
    if (!flight || !confirm(`确认删除航班 ${flight.flightNo}？`)) return;
    this.state.flights = this.state.flights.filter((item) => item.id !== id);
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
    this.commit("航班已删除");
  }

  private showTemplates(): void {
    this.modal("从模板添加航班", this.state.templates.length ? `<div class="list-group">${this.state.templates.map((template) => `<button class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" type="button" data-action="select-template" data-id="${template.id}"><span><strong>${escapeHtml(template.flightNo)}</strong><small class="text-secondary ms-3">${escapeHtml(template.startTime)}–${escapeHtml(template.endTime)}</small></span><span class="badge text-bg-light">${template.positions.length} 岗</span></button>`).join("")}</div>` : `<div class="empty-state">尚无航班模板</div>`, `<button class="btn btn-secondary" type="button" data-bs-dismiss="modal">关闭</button>`);
  }

  private addTemplateFlight(id: string): void {
    const template = this.state.templates.find((item) => item.id === id);
    if (!template) return;
    this.state.flights.push({ ...structuredClone(template), id: createId("flight"), bookedPassengers: 0 });
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
    this.closeModal();
    this.commit("已从模板添加航班");
  }

  private addStaff(): void {
    const numericIds = this.state.staff.map((item) => Number(item.id)).filter(Number.isFinite);
    const id = String(Math.max(0, ...numericIds) + 1);
    this.state.staff.push({ id, name: "新人员", staffType: "常规", cxPreflightQualified: false, dutyQualified: true, nightShift: true, status: "正常", remark: "" });
    this.commit("已新增人员");
  }

  private addAdministrativeStaff(): void {
    let sequence = 1;
    while (this.state.staff.some((person) => person.id === `A${sequence}`)) sequence += 1;
    const person: Staff = {
      id: `A${sequence}`,
      name: `行政支援${sequence}`,
      staffType: "行政支援",
      cxPreflightQualified: false,
      dutyQualified: false,
      nightShift: true,
      status: "正常",
      remark: ""
    };
    this.state.staff.push(person);
    this.commit("已新增行政支援人员");
  }

  private deleteStaff(id: string): void {
    const person = this.state.staff.find((item) => item.id === id);
    if (!person || !confirm(`确认删除 ${person.name}？相关岗位资质也会同步移除。`)) return;
    this.state.staff = this.state.staff.filter((item) => item.id !== id);
    this.state.positionRules.forEach((rule) => { rule.qualifiedStaffIds = rule.qualifiedStaffIds.filter((staffId) => staffId !== id); });
    this.state.dutyRosterOverrides = this.state.dutyRosterOverrides.map((item) => ({
      ...item,
      cxPreflightStaffId: item.cxPreflightStaffId === id ? null : item.cxPreflightStaffId,
      dutyStaffId: item.dutyStaffId === id ? null : item.dutyStaffId,
      standbyStaffIds: item.standbyStaffIds.map((staffId) => staffId === id ? null : staffId) as [string | null, string | null]
    }));
    this.state.assignments = this.state.assignments.map((item) => {
      if (item.staffId !== id) return item;
      const rule = item.positionRuleId ? this.state.positionRules.find((ruleItem) => ruleItem.id === item.positionRuleId) : undefined;
      return { ...item, staffId: null, staffName: "", status: isAuxiliaryCategory(rule?.category) || !item.positionRuleId ? "manual" : "unfilled" };
    });
    this.commit("人员已删除");
  }

  private addPositions(): void {
    const flightNo = assertElement<HTMLSelectElement>("#position-flight").value;
    const count = Math.max(1, Math.min(30, Number(assertElement<HTMLInputElement>("#position-batch-count").value) || 1));
    if (!flightNo) { this.toast("请先配置航班", "warning"); return; }
    const existingNames = new Set(this.state.positionRules.filter((item) => item.flightNo === flightNo).map((item) => item.name));
    let nextNumber = 1;
    for (let index = 0; index < count; index += 1) {
      while (existingNames.has(`新岗位${nextNumber}`)) nextNumber += 1;
      const name = `新岗位${nextNumber}`;
      existingNames.add(name);
      this.state.positionRules.push({ id: createId("position"), flightNo, name, category: "常规", remark: "", qualifiedStaffIds: [], manual: false, fatiguePoints: 1, minPassengers: 0, earlyReleaseMinutes: 0 });
      nextNumber += 1;
    }
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
    this.commit(`已为 ${flightNo} 新增 ${count} 条岗位规则`);
  }

  private deletePosition(id: string): void {
    const rule = this.state.positionRules.find((item) => item.id === id);
    if (!rule || !confirm(`确认删除 ${rule.flightNo} / ${rule.name}？`)) return;
    this.state.positionRules = this.state.positionRules.filter((item) => item.id !== id);
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
    this.commit("岗位规则已删除");
  }

  private movePosition(id: string, direction: -1 | 1): void {
    const rule = this.state.positionRules.find((item) => item.id === id);
    if (!rule) return;
    const siblingIndexes = this.state.positionRules
      .map((item, index) => item.flightNo === rule.flightNo ? index : -1)
      .filter((index) => index >= 0);
    const currentSiblingIndex = siblingIndexes.indexOf(this.state.positionRules.indexOf(rule));
    const targetIndex = siblingIndexes[currentSiblingIndex + direction];
    if (targetIndex === undefined) return;
    const currentIndex = this.state.positionRules.indexOf(rule);
    [this.state.positionRules[currentIndex], this.state.positionRules[targetIndex]] = [this.state.positionRules[targetIndex]!, this.state.positionRules[currentIndex]!];
    this.state.positionRules = orderPositionRules(this.state.positionRules);
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
    this.commit("岗位顺序已调整");
  }

  private sortCountersDescending(flightNo: string): void {
    if (!flightNo) return;
    this.state.positionRules = sortFlightCountersDescending(this.state.positionRules, flightNo);
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
    this.commit(`${flightNo} 柜台已按编号从大到小排列`);
  }

  private createTemporaryAssignment(input: HTMLInputElement | HTMLSelectElement): void {
    const slot = input.closest<HTMLElement>("[data-empty-slot]");
    const flightId = slot?.dataset.flightId ?? "";
    const flight = this.state.flights.find((item) => item.id === flightId);
    if (!slot || !flight) return;
    const position = normalizeText(slot.querySelector<HTMLInputElement>('[data-empty-field="position"]')?.value) || "临时岗位";
    const staffName = normalizeText(slot.querySelector<HTMLInputElement>('[data-empty-field="staffName"]')?.value);
    this.state.assignments.push({
      id: createId("assignment"), flightId: flight.id, flightNo: flight.flightNo, positionRuleId: null,
      position, staffId: null, staffName, startTime: flight.startTime, endTime: flight.endTime,
      workHours: 0, fatiguePoints: 0, remark: "", manualRemark: "", status: staffName ? "assigned" : "manual",
      layoutGroup: slot.dataset.layoutGroup === "bottom" ? "bottom" : "primary",
      layoutIndex: Number(slot.dataset.layoutIndex) || 0
    });
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
    rule.manual = assertElement<HTMLInputElement>("#qualified-manual").checked;
    rule.qualifiedStaffIds = [...document.querySelectorAll<HTMLInputElement>('input[name="qualified-staff"]:checked')].map((input) => input.value);
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
    this.closeModal();
    this.commit("岗位资质已保存");
  }

  private deleteTemplate(id: string): void {
    this.state.templates = this.state.templates.filter((item) => item.id !== id);
    this.commit("模板已删除");
  }

  private assignStaff(assignmentId: string, staffId: string, sourceAssignmentId?: string): void {
    const assignment = this.state.assignments.find((item) => item.id === assignmentId);
    if (!assignment) return;
    if (sourceAssignmentId === assignmentId) return;
    if (!staffId) {
      const rule = assignment.positionRuleId ? this.state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
      assignment.staffId = null; assignment.staffName = ""; assignment.status = rule?.manual || isAuxiliaryCategory(rule?.category) || rule?.category === "督导补位" || !assignment.positionRuleId ? "manual" : "unfilled";
      if (rule?.category === "督导补位") assignment.supervisorFillDetached = true;
      delete assignment.systemNotes;
      this.refreshSameFlightReuseAssignments([assignment.flightId]);
      this.commit("岗位已设为待补位");
      return;
    }
    const source = sourceAssignmentId ? this.state.assignments.find((item) => item.id === sourceAssignmentId) : undefined;
    if (source && isSupervisorMoveSlot(this.state, source) && isSupervisorMoveSlot(this.state, assignment)) {
      const moveError = moveSupervisorWithinFlight(this.state, source.id, assignment.id);
      if (moveError) { this.render(); this.toast(moveError, "danger"); return; }
      this.refreshSameFlightReuseAssignments([assignment.flightId]);
      this.commit(assignment.staffName && source.staffName ? "督导岗位人员已交换" : "督导人员已移动");
      return;
    }
    const targetStaffId = assignment.staffId;
    const targetStaffName = assignment.staffName;
    const copySource = Boolean(sourceAssignmentId && (isGuideAssignment(this.state, assignment)
      || (!targetStaffId && isDiversionTransfer(this.state, sourceAssignmentId, assignmentId))));
    const error = canAssignStaff(this.state, assignmentId, staffId, copySource ? undefined : sourceAssignmentId);
    if (error) { this.render(); this.toast(error, "danger"); return; }
    const person = this.state.staff.find((item) => item.id === staffId);
    if (!person) return;
    if (source && !copySource && targetStaffId) {
      const reverseError = canAssignStaff(this.state, source.id, targetStaffId, assignment.id);
      if (reverseError) { this.render(); this.toast(`无法交换：${reverseError}`, "danger"); return; }
    }
    assignment.staffId = person.id; assignment.staffName = person.name; assignment.status = "assigned"; delete assignment.systemNotes;
    if (source && !copySource) {
      if (targetStaffId) {
        source.staffId = targetStaffId;
        source.staffName = targetStaffName;
        source.status = "assigned";
        delete source.systemNotes;
      } else {
        const sourceRule = source.positionRuleId ? this.state.positionRules.find((item) => item.id === source.positionRuleId) : undefined;
        source.staffId = null; source.staffName = ""; source.status = sourceRule?.manual || isAuxiliaryCategory(sourceRule?.category) || sourceRule?.category === "督导补位" || !source.positionRuleId ? "manual" : "unfilled";
        delete source.systemNotes;
      }
    }
    applyEarlyReleaseForStaff(this.state, assignment.id, person.id);
    if (source && targetStaffId && !copySource) applyEarlyReleaseForStaff(this.state, source.id, targetStaffId);
    this.refreshSameFlightReuseAssignments([assignment.flightId, ...(source ? [source.flightId] : [])]);
    const copyMessage = isGuideAssignment(this.state, assignment) ? "引导人员已复用" : "分流人员已转派";
    this.commit(source && targetStaffId && !copySource ? "人员岗位已交换" : copySource ? copyMessage : "人员分配已更新");
  }

  private refreshSameFlightReuseAssignments(flightIds: string[]): void {
    normalizeSupervisorFillAssignments(this.state);
    for (const flightId of new Set(flightIds)) {
      const reuseAssignments = this.state.assignments.filter((item) => item.flightId === flightId && isGuideAssignment(this.state, item));
      const flight = this.state.flights.find((item) => item.id === flightId);
      const displayIndex = new Map((flight ? activeFlightRules(this.state, flight) : []).map((rule, index) => [rule.id, index]));
      const usedStaffIdsByCategory = new Map<string, Set<string>>();
      for (const reuseAssignment of reuseAssignments) {
        const reuseRule = reuseAssignment.positionRuleId ? this.state.positionRules.find((rule) => rule.id === reuseAssignment.positionRuleId) : undefined;
        if (!reuseRule) continue;
        const usedStaffIds = usedStaffIdsByCategory.get(reuseRule.category) ?? new Set<string>();
        usedStaffIdsByCategory.set(reuseRule.category, usedStaffIds);
        const candidates = this.state.assignments
          .filter((item) => item.flightId === flightId && item.id !== reuseAssignment.id && item.status === "assigned")
          .filter((item) => item.staffId && !usedStaffIds.has(item.staffId))
          .map((item) => ({
            assignment: item,
            sourceRule: item.positionRuleId ? this.state.positionRules.find((rule) => rule.id === item.positionRuleId) : undefined,
            person: this.state.staff.find((person) => person.id === item.staffId)
          }))
          .filter((item): item is typeof item & { person: Staff } => Boolean(
            item.sourceRule?.category === "常规"
            && item.person?.status === "正常"
            && item.person.staffType === "常规"
          ))
          .sort((left, right) => (displayIndex.get(right.assignment.positionRuleId ?? "") ?? -1) - (displayIndex.get(left.assignment.positionRuleId ?? "") ?? -1));
        const selected = candidates[0]?.person;
        reuseAssignment.staffId = selected?.id ?? null;
        reuseAssignment.staffName = selected?.name ?? "";
        reuseAssignment.status = selected ? "assigned" : "unfilled";
        if (selected) usedStaffIds.add(selected.id);
      }
    }
  }

  private deleteAssignment(id: string): void {
    const assignment = this.state.assignments.find((item) => item.id === id);
    if (!assignment || assignment.positionRuleId) return;
    this.state.assignments = this.state.assignments.filter((item) => item.id !== id);
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
    const records = this.state.assignments
      .filter((item) => item.status === "assigned" && item.staffName && !assignmentUsesUnavailableStaff(this.state, item))
      .map((item) => ({
        id: createId("history"), date: this.scheduleDate, flightNo: item.flightNo, position: item.position,
        staffId: item.staffId ?? "", staffName: item.staffName, startTime: item.startTime, endTime: item.endTime,
        workHours: item.workHours, fatiguePoints: item.fatiguePoints, remark: combinedAssignmentRemark(item.remark, item.manualRemark)
      }));
    const roster = getDutyRosterForDate(this.state, this.scheduleDate);
    const dutyPerson = roster.dutyStaffId ? this.state.staff.find((person) => person.id === roster.dutyStaffId) : undefined;
    if (dutyPerson && this.state.settings.dutyFatiguePoints > 0) {
      records.push({
        id: createId("history"), date: this.scheduleDate, flightNo: "轮值", position: "值班人员",
        staffId: dutyPerson.id, staffName: dutyPerson.name, startTime: "", endTime: "",
        workHours: 0, fatiguePoints: this.state.settings.dutyFatiguePoints, remark: "月度轮值"
      });
    }
    return records;
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
    this.state.history = [...this.state.history.filter((item) => item.date !== date), ...records];
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
    this.state.history = [];
    this.commit("历史排班已清空");
  }

  private deleteHistory(id: string): void {
    this.state.history = this.state.history.filter((item) => item.id !== id);
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
      const importConfig = this.importMode !== "history";
      const importHistory = this.importMode !== "config";
      if (importConfig && imported.staff?.length) this.state.staff = imported.staff;
      if (importConfig && imported.positionRules?.length) this.state.positionRules = orderPositionRules(imported.positionRules);
      if (importConfig && imported.templates?.length) this.state.templates = imported.templates;
      if (importConfig && imported.flights?.length && !imported.templates?.length) {
        this.state.templates = imported.flights.map(({ id, bookedPassengers: _bookedPassengers, ...flight }) => ({ ...structuredClone(flight), id: createId("template") }));
      }
      if (this.importMode === "all" && imported.flights?.length) this.state.flights = imported.flights;
      if (importHistory && imported.history) {
        const incomingKeys = new Set(imported.history.map((item) => `${item.date}|${item.flightNo}|${item.position}|${item.staffName}`));
        this.state.history = [...this.state.history.filter((item) => !incomingKeys.has(`${item.date}|${item.flightNo}|${item.position}|${item.staffName}`)), ...imported.history];
      }
      const changedConfig = importConfig && Boolean(imported.staff?.length || imported.flights?.length || imported.templates?.length || imported.positionRules?.length);
      if (changedConfig) this.state.assignments = [];
      if (changedConfig) this.state.activeScheduleDate = null;
      const recognized = [imported.staff?.length && `${imported.staff.length} 人`, imported.flights?.length && `${imported.flights.length} 个航班计划`, imported.templates?.length && `${imported.templates.length} 个航班模板`, imported.positionRules?.length && `${imported.positionRules.length} 条岗位规则`, imported.history?.length && `${imported.history.length} 条历史负荷`].filter(Boolean).join("、");
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
    if (entity === "settings") {
      const key = field as keyof AppState["settings"];
      (this.state.settings[key] as string | number) = value as string | number;
      this.state.assignments = [];
      this.state.activeScheduleDate = null;
    } else if (entity === "flight") {
      const flight = this.state.flights.find((item) => item.id === id);
      if (!flight) return;
      if (field === "positions") flight.positions = splitList(value);
      else {
        const nextValue = typeof value === "string" && field === "flightNo" ? value.toUpperCase() : value;
        (flight as unknown as Record<string, unknown>)[field] = nextValue;
        if (field === "flightNo" && typeof nextValue === "string") {
          const template = this.state.templates.find((item) => item.flightNo.toUpperCase() === nextValue);
          if (template) {
            flight.startTime = template.startTime;
            flight.endTime = template.endTime;
            flight.positions = [...template.positions];
            flight.remark = template.remark;
          }
        }
      }
      this.state.assignments = [];
      this.state.activeScheduleDate = null;
    } else if (entity === "position") {
      const rule = this.state.positionRules.find((item) => item.id === id);
      if (!rule) return;
      (rule as unknown as Record<string, unknown>)[field] = typeof value === "string" && field === "flightNo" ? value.toUpperCase() : value;
      if (field === "category") {
        if (value === "分流" && !rule.earlyReleaseMinutes) rule.earlyReleaseMinutes = 60;
        if (value !== "分流") rule.earlyReleaseMinutes = 0;
        if (value === "引导" || value === "督导补位") {
          rule.manual = value === "督导补位";
          rule.qualifiedStaffIds = [];
        }
      }
      if (field === "name" || field === "flightNo") this.state.positionRules = orderPositionRules(this.state.positionRules);
      this.state.assignments = [];
      this.state.activeScheduleDate = null;
    } else if (entity === "transition-policy") {
      const policy = this.state.settings.positionTransitionPolicies.find((item) => item.id === id);
      if (!policy) return;
      if (field === "sourcePositions") policy.sourcePositions = splitList(value);
      else if (field === "minimumGapMinutes") policy.minimumGapMinutes = Math.min(1440, Math.max(0, Math.round(Number(value)) || 0));
      else if (field === "sourceFlightNo" || field === "targetFlightNo") (policy as unknown as Record<string, unknown>)[field] = normalizeText(value).toUpperCase();
      else if (field === "mode") policy.mode = value === "forbid" ? "forbid" : "prefer";
      else if (field === "enabled") policy.enabled = Boolean(value);
      else if (field === "name" || field === "targetPosition") (policy as unknown as Record<string, unknown>)[field] = normalizeText(value);
      this.state = saveState(this.state);
      return;
    } else if (entity === "duty-roster") {
      this.updateDutyRoster(id, input.dataset.dutySlot as DutyRosterSlot, String(value));
      return;
    } else if (entity === "template") {
      const template = this.state.templates.find((item) => item.id === id);
      if (!template) return;
      if (field === "positions") template.positions = splitList(value);
      else (template as unknown as Record<string, unknown>)[field] = typeof value === "string" && field === "flightNo" ? value.toUpperCase() : value;
    } else if (entity === "assignment") {
      const assignment = this.state.assignments.find((item) => item.id === id);
      if (!assignment) return;
      if (field === "manualRemark") assignment.manualRemark = normalizeText(value);
      else if (field === "staffName") {
        const staffName = normalizeText(value);
        const rule = assignment.positionRuleId ? this.state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
        if (!staffName) {
          this.assignStaff(id, "");
          return;
        }
        const person = this.state.staff.find((item) => item.name === staffName);
        if (!person && (rule?.category === "引导" || rule?.category === "督导补位")) {
          this.render();
          this.toast(rule.category === "督导补位" ? "督导补位只能复用同一航班已排督导人员" : "引导岗位只能复用同一航班中已排常规岗位的常规人员", "danger");
          return;
        }
        if (!person || (person.staffType !== "行政支援" && (isAuxiliaryCategory(rule?.category) || !assignment.positionRuleId))) {
          if (rule?.category === "督导补位") assignment.supervisorFillDetached = true;
          assignment.staffId = null;
          assignment.staffName = staffName;
          assignment.status = "assigned";
          delete assignment.systemNotes;
        } else {
          this.assignStaff(id, person.id);
          return;
        }
      } else if (field === "position" && !assignment.positionRuleId) {
        assignment.position = normalizeText(value) || "临时岗位";
      }
    } else if (entity === "staff") {
      const person = this.state.staff.find((item) => item.id === id);
      if (!person) return;
      if (field === "status") {
        const status = value === "病假" ? "病假" : value === "休假" ? "休假" : "正常";
        const result = applyStaffStatusChange(this.state, id, status);
        this.commit(result
          ? result.unfilledCount
            ? `人员状态已更新，当前排班已重新计算，${result.unfilledCount} 个岗位待补位`
            : "人员状态已更新，当前排班已重新计算"
          : "人员状态已更新");
        return;
      }
      if (field === "name") {
        const nextName = normalizeText(value) || person.name;
        person.name = nextName;
        this.state.assignments.forEach((item) => { if (item.staffId === id) item.staffName = nextName; });
        this.state.history.forEach((item) => { if (item.staffId === id) item.staffName = nextName; });
        this.commit();
        return;
      }
      if (field === "id" && typeof value === "string" && value !== id) {
        if (this.state.staff.some((item) => item.id === value)) { this.render(); this.toast("人员编号不能重复", "danger"); return; }
        this.state.positionRules.forEach((rule) => { rule.qualifiedStaffIds = rule.qualifiedStaffIds.map((staffId) => staffId === id ? value : staffId); });
        this.state.assignments.forEach((item) => { if (item.staffId === id) item.staffId = value; });
        this.state.history.forEach((item) => { if (item.staffId === id) item.staffId = value; });
        this.state.dutyRosterOverrides.forEach((item) => {
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
      this.state.assignments = [];
      this.state.activeScheduleDate = null;
    }
    this.commit();
  }
}
