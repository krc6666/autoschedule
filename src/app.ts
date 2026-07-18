import Modal from "bootstrap/js/dist/modal";
import Toast from "bootstrap/js/dist/toast";

import { createDefaultState } from "./defaults";
import { generateSchedule, canAssignStaff } from "./domain/scheduler";
import { clearState, loadState, saveState } from "./infrastructure/storage";
import type { AppSection, AppState, Flight, HistoryRecord } from "./model";
import { renderConfig } from "./ui/config-view";
import { renderFlights } from "./ui/flights-view";
import { renderHistory } from "./ui/history-view";
import { renderOverview } from "./ui/overview-view";
import { renderSchedule } from "./ui/schedule-view";
import { renderShell } from "./ui/shell";
import { assertElement, createId, escapeHtml, splitList, todayIso } from "./utils";

export class AutoScheduleApp {
  private state: AppState = loadState();
  private activeSection: AppSection = "overview";
  private scheduleDate = localStorage.getItem("autoschedule.scheduleDate") || todayIso();
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("change", (event) => void this.handleChange(event));
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
    this.root.innerHTML = renderShell(this.state, this.activeSection, this.scheduleDate, this.view());
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
      "import-workbook": () => assertElement<HTMLInputElement>("#workbook-input").click(),
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
      "add-position": () => this.addPosition(),
      "delete-position": () => this.deletePosition(id),
      "edit-qualified": () => this.showQualified(id),
      "save-qualified": () => this.saveQualified(id),
      "save-flights-as-templates": () => this.saveTemplates(),
      "delete-template": () => this.deleteTemplate(id),
      "clear-schedule": () => this.clearSchedule(),
      "archive-schedule": () => this.archiveSchedule(),
      "clear-history": () => this.clearHistory(),
      "delete-history": () => this.deleteHistory(id),
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
    this.state.assignments = this.state.assignments.map((item) => item.staffId === id ? { ...item, staffId: null, staffName: "", status: "unfilled" } : item);
    this.commit("人员已删除");
  }

  private addPosition(): void {
    this.state.positionRules.push({ id: createId("position"), flightNo: this.state.flights[0]?.flightNo ?? "", name: "新岗位", category: "常规", remark: "", qualifiedStaffIds: [], manual: false, fatiguePoints: 1 });
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
    this.commit("已新增岗位规则");
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
    const body = `<div class="form-check form-switch border-bottom pb-3 mb-3"><input class="form-check-input" id="qualified-manual" type="checkbox" ${rule.manual ? "checked" : ""}><label class="form-check-label" for="qualified-manual">手动补位岗位</label></div><div class="qualified-grid">${this.state.staff.map((person) => `<label class="form-check qualified-check"><input class="form-check-input" type="checkbox" name="qualified-staff" value="${escapeHtml(person.id)}" ${rule.qualifiedStaffIds.includes(person.id) ? "checked" : ""}><span class="form-check-label">${escapeHtml(person.name)} <small>#${escapeHtml(person.id)}</small></span></label>`).join("")}</div>`;
    this.modal(`${rule.flightNo} / ${rule.name} 资质`, body, `<button class="btn btn-secondary" type="button" data-bs-dismiss="modal">取消</button><button class="btn btn-primary" type="button" data-action="save-qualified" data-id="${id}">保存</button>`);
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

  private saveTemplates(): void {
    this.state.templates = this.state.flights.map(({ id, bookedPassengers: _bookedPassengers, ...flight }) => ({ ...structuredClone(flight), id: `template-${id}` }));
    this.commit("航班模板已更新");
  }

  private deleteTemplate(id: string): void {
    this.state.templates = this.state.templates.filter((item) => item.id !== id);
    this.commit("模板已删除");
  }

  private assignStaff(assignmentId: string, staffId: string): void {
    const assignment = this.state.assignments.find((item) => item.id === assignmentId);
    if (!assignment) return;
    if (!staffId) {
      const rule = assignment.positionRuleId ? this.state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
      assignment.staffId = null; assignment.staffName = ""; assignment.status = rule?.manual ? "manual" : "unfilled";
      this.commit("岗位已设为待补位");
      return;
    }
    const error = canAssignStaff(this.state, assignmentId, staffId);
    if (error) { this.render(); this.toast(error, "danger"); return; }
    const person = this.state.staff.find((item) => item.id === staffId);
    if (!person) return;
    assignment.staffId = person.id; assignment.staffName = person.name; assignment.status = "assigned";
    this.commit("人员分配已更新");
  }

  private clearSchedule(): void {
    if (!this.state.assignments.length || !confirm("确认清空当前排班？")) return;
    this.state.assignments = [];
    this.state.activeScheduleDate = null;
    this.commit("当前排班已清空");
  }

  private archiveSchedule(): void {
    const assigned = this.state.assignments.filter((item) => item.status === "assigned" && item.staffId);
    if (!assigned.length) { this.toast("没有可归档的已排岗位", "warning"); return; }
    if (!confirm(`将 ${assigned.length} 条已排岗位归档到 ${this.scheduleDate}？同日旧记录会被替换。`)) return;
    const records: HistoryRecord[] = assigned.map((item) => ({
      id: createId("history"), date: this.scheduleDate, flightNo: item.flightNo, position: item.position,
      staffId: item.staffId ?? "", staffName: item.staffName, startTime: item.startTime, endTime: item.endTime,
      workHours: item.workHours, fatiguePoints: item.fatiguePoints, remark: item.remark
    }));
    this.state.history = [...this.state.history.filter((item) => item.date !== this.scheduleDate), ...records];
    this.commit("排班已归档到历史");
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
      if (imported.staff?.length) this.state.staff = imported.staff;
      if (imported.flights?.length) this.state.flights = imported.flights;
      if (imported.positionRules?.length) this.state.positionRules = imported.positionRules;
      if (imported.history) {
        const incomingKeys = new Set(imported.history.map((item) => `${item.date}|${item.flightNo}|${item.position}|${item.staffName}`));
        this.state.history = [...this.state.history.filter((item) => !incomingKeys.has(`${item.date}|${item.flightNo}|${item.position}|${item.staffName}`)), ...imported.history];
      }
      if (imported.staff || imported.flights || imported.positionRules) this.state.assignments = [];
      if (imported.staff || imported.flights || imported.positionRules) this.state.activeScheduleDate = null;
      const recognized = [imported.staff?.length && `${imported.staff.length} 人`, imported.flights?.length && `${imported.flights.length} 个航班`, imported.positionRules?.length && `${imported.positionRules.length} 条岗位规则`, imported.history?.length && `${imported.history.length} 条历史`].filter(Boolean).join("、");
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
      else (flight as unknown as Record<string, unknown>)[field] = typeof value === "string" && field === "flightNo" ? value.toUpperCase() : value;
      this.state.assignments = [];
      this.state.activeScheduleDate = null;
    } else if (entity === "position") {
      const rule = this.state.positionRules.find((item) => item.id === id);
      if (!rule) return;
      (rule as unknown as Record<string, unknown>)[field] = typeof value === "string" && field === "flightNo" ? value.toUpperCase() : value;
      this.state.assignments = [];
      this.state.activeScheduleDate = null;
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
