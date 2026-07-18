import Modal from "bootstrap/js/dist/modal";
import Toast from "bootstrap/js/dist/toast";

import { createDefaultState } from "./defaults";
import { generateSchedule, canAssignStaff, isSameFlightReusePosition } from "./domain/scheduler";
import { durationHours } from "./domain/time";
import { clearState, loadState, saveState } from "./infrastructure/storage";
import type { AppSection, AppState, Flight, FlightTemplate, HistoryRecord } from "./model";
import { renderConfig } from "./ui/config-view";
import { renderFlights } from "./ui/flights-view";
import { renderHistory } from "./ui/history-view";
import { renderOverview } from "./ui/overview-view";
import { renderSchedule } from "./ui/schedule-view";
import { renderShell } from "./ui/shell";
import { assertElement, combinedAssignmentRemark, createId, escapeHtml, normalizeText, splitList, todayIso } from "./utils";

export class AutoScheduleApp {
  private state: AppState = loadState();
  private activeSection: AppSection = "overview";
  private scheduleDate = localStorage.getItem("autoschedule.scheduleDate") || todayIso();
  private importMode: "all" | "config" | "history" = "all";
  private openPositionFlights = new Set<string>();
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("change", (event) => void this.handleChange(event));
    this.root.addEventListener("dragstart", (event) => this.handleDragStart(event));
    this.root.addEventListener("dragover", (event) => this.handleDragOver(event));
    this.root.addEventListener("drop", (event) => this.handleDrop(event));
  }

  start(): void {
    this.render();
  }

  private view(): string {
    switch (this.activeSection) {
      case "config": return renderConfig(this.state);
      case "flights": return renderFlights(this.state);
      case "schedule": return renderSchedule(this.state, this.scheduleDate);
      case "history": return renderHistory(this.state);
      default: return renderOverview(this.state, this.scheduleDate);
    }
  }

  private render(): void {
    this.openPositionFlights = new Set([...this.root.querySelectorAll<HTMLDetailsElement>(".position-rule-group[open]")]
      .map((element) => element.dataset.positionFlight ?? "").filter(Boolean));
    this.root.innerHTML = renderShell(this.state, this.activeSection, this.scheduleDate, this.view());
    this.root.querySelectorAll<HTMLDetailsElement>(".position-rule-group").forEach((element) => {
      element.open = this.openPositionFlights.has(element.dataset.positionFlight ?? "");
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
      "delete-staff": () => this.deleteStaff(id),
      "add-positions": () => this.addPositions(),
      "delete-position": () => this.deletePosition(id),
      "edit-qualified": () => this.showQualified(id),
      "select-all-qualified": () => this.setQualifiedSelection(true),
      "clear-all-qualified": () => this.setQualifiedSelection(false),
      "save-qualified": () => this.saveQualified(id),
      "add-template": () => this.addTemplate(),
      "delete-template": () => this.deleteTemplate(id),
      "clear-schedule": () => this.clearSchedule(),
      "archive-schedule": () => this.archiveSchedule(),
      "archive-and-next": () => this.archiveAndScheduleNextDay(),
      "clear-history": () => this.clearHistory(),
      "delete-history": () => this.deleteHistory(id),
      "clear-assignment": () => this.assignStaff(id, ""),
      "add-schedule-slot": () => this.addScheduleSlot(id),
      "delete-assignment": () => this.deleteAssignment(id),
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
    this.state.staff.push({ id, name: "新人员", nightShift: true, status: "正常", remark: "" });
    this.commit("已新增人员");
  }

  private deleteStaff(id: string): void {
    const person = this.state.staff.find((item) => item.id === id);
    if (!person || !confirm(`确认删除 ${person.name}？相关岗位资质也会同步移除。`)) return;
    this.state.staff = this.state.staff.filter((item) => item.id !== id);
    this.state.positionRules.forEach((rule) => { rule.qualifiedStaffIds = rule.qualifiedStaffIds.filter((staffId) => staffId !== id); });
    this.state.assignments = this.state.assignments.map((item) => {
      if (item.staffId !== id) return item;
      const rule = item.positionRuleId ? this.state.positionRules.find((ruleItem) => ruleItem.id === item.positionRuleId) : undefined;
      return { ...item, staffId: null, staffName: "", status: rule?.category === "支援" || !item.positionRuleId ? "manual" : "unfilled" };
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
      this.state.positionRules.push({ id: createId("position"), flightNo, name, category: "常规", remark: "", qualifiedStaffIds: [], manual: false, fatiguePoints: 1, minPassengers: 0 });
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

  private showQualified(id: string): void {
    const rule = this.state.positionRules.find((item) => item.id === id);
    if (!rule) return;
    const body = `<div class="d-flex align-items-center justify-content-between gap-2 border-bottom pb-3 mb-3"><div class="form-check form-switch m-0"><input class="form-check-input" id="qualified-manual" type="checkbox" ${rule.manual ? "checked" : ""}><label class="form-check-label" for="qualified-manual">手动补位岗位</label></div><div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" type="button" data-action="select-all-qualified"><i class="bi bi-check2-square me-1"></i>全选</button><button class="btn btn-outline-secondary" type="button" data-action="clear-all-qualified"><i class="bi bi-square me-1"></i>全不选</button></div></div><div class="qualified-grid">${this.state.staff.map((person) => `<label class="form-check qualified-check"><input class="form-check-input" type="checkbox" name="qualified-staff" value="${escapeHtml(person.id)}" ${rule.qualifiedStaffIds.includes(person.id) ? "checked" : ""}><span class="form-check-label">${escapeHtml(person.name)} <small>#${escapeHtml(person.id)}</small></span></label>`).join("")}</div>`;
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
      assignment.staffId = null; assignment.staffName = ""; assignment.status = rule?.manual || rule?.category === "支援" ? "manual" : "unfilled";
      this.commit("岗位已设为待补位");
      return;
    }
    const error = canAssignStaff(this.state, assignmentId, staffId, sourceAssignmentId);
    if (error) { this.render(); this.toast(error, "danger"); return; }
    const person = this.state.staff.find((item) => item.id === staffId);
    if (!person) return;
    assignment.staffId = person.id; assignment.staffName = person.name; assignment.status = "assigned";
    if (sourceAssignmentId && !isSameFlightReusePosition(assignment.position)) {
      const source = this.state.assignments.find((item) => item.id === sourceAssignmentId);
      if (source) {
        const sourceRule = source.positionRuleId ? this.state.positionRules.find((item) => item.id === source.positionRuleId) : undefined;
        source.staffId = null; source.staffName = ""; source.status = sourceRule?.manual || sourceRule?.category === "支援" || !source.positionRuleId ? "manual" : "unfilled";
      }
    }
    this.commit("人员分配已更新");
  }

  private addScheduleSlot(flightId: string): void {
    const flight = this.state.flights.find((item) => item.id === flightId);
    if (!flight) return;
    this.state.assignments.push({
      id: createId("assignment"), flightId: flight.id, flightNo: flight.flightNo, positionRuleId: null,
      position: "临时支援", staffId: null, staffName: "", startTime: flight.startTime, endTime: flight.endTime,
      workHours: durationHours(flight.startTime, flight.endTime),
      fatiguePoints: 1, remark: "临时增加岗位", manualRemark: "", status: "manual"
    });
    this.commit("已增加临时岗位");
  }

  private deleteAssignment(id: string): void {
    const assignment = this.state.assignments.find((item) => item.id === id);
    const rule = assignment?.positionRuleId ? this.state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
    if (!assignment || (assignment.positionRuleId && rule?.category !== "支援")) return;
    this.state.assignments = this.state.assignments.filter((item) => item.id !== id);
    this.commit("本次支援岗位已移除");
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
    return this.state.assignments.filter((item) => item.status === "assigned" && item.staffName).map((item) => ({
      id: createId("history"), date: this.scheduleDate, flightNo: item.flightNo, position: item.position,
      staffId: item.staffId ?? "", staffName: item.staffName, startTime: item.startTime, endTime: item.endTime,
      workHours: item.workHours, fatiguePoints: item.fatiguePoints, remark: combinedAssignmentRemark(item.remark, item.manualRemark)
    }));
  }

  private replaceHistoryForDate(date: string, records: HistoryRecord[]): void {
    this.state.history = [...this.state.history.filter((item) => item.date !== date), ...records];
  }

  private archiveAndScheduleNextDay(): void {
    const records = this.currentScheduleHistory();
    if (!records.length) { this.toast("没有可归档的已排岗位", "warning"); return; }
    const currentDate = this.scheduleDate;
    const [year, month, day] = currentDate.split("-").map(Number);
    const nextDate = new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
    if (!confirm(`归档 ${currentDate}，并根据今天的负荷生成 ${nextDate} 排班？`)) return;
    this.replaceHistoryForDate(currentDate, records);
    this.scheduleDate = nextDate;
    localStorage.setItem("autoschedule.scheduleDate", nextDate);
    const result = generateSchedule(this.state, nextDate);
    this.state.assignments = result.assignments;
    this.state.activeScheduleDate = nextDate;
    this.activeSection = "schedule";
    this.commit(result.unfilledCount
      ? `今天已归档，明天排班已生成，${result.unfilledCount} 个常规岗位待补位`
      : "今天已归档，已按今天负荷生成明天排班");
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
      if (importConfig && imported.positionRules?.length) this.state.positionRules = imported.positionRules;
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
      this.state.assignments = [];
      this.state.activeScheduleDate = null;
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
        if (rule?.category === "支援" || !assignment.positionRuleId) {
          assignment.staffId = null;
          assignment.staffName = staffName;
          assignment.status = staffName ? "assigned" : "manual";
        } else if (!staffName) {
          this.assignStaff(id, "");
          return;
        } else {
          const person = this.state.staff.find((item) => item.name === staffName);
          if (!person) { this.render(); this.toast("常规岗位只能填写人员名单中的姓名", "danger"); return; }
          this.assignStaff(id, person.id);
          return;
        }
      }
    } else if (entity === "staff") {
      const person = this.state.staff.find((item) => item.id === id);
      if (!person) return;
      if (field === "id" && typeof value === "string" && value !== id) {
        if (this.state.staff.some((item) => item.id === value)) { this.render(); this.toast("人员编号不能重复", "danger"); return; }
        this.state.positionRules.forEach((rule) => { rule.qualifiedStaffIds = rule.qualifiedStaffIds.map((staffId) => staffId === id ? value : staffId); });
        this.state.assignments.forEach((item) => { if (item.staffId === id) item.staffId = value; });
        this.state.history.forEach((item) => { if (item.staffId === id) item.staffId = value; });
      }
      (person as unknown as Record<string, unknown>)[field] = value;
      this.state.assignments = [];
      this.state.activeScheduleDate = null;
    }
    this.commit();
  }
}
