import { currentScheduleHistory } from "../history-actions";
import { installArchivedNextWorkdaySchedule } from "../schedule-actions";
import { addIsoDays } from "../../domain/shared/time";
import type { UiCommand } from "../../ui/events/ui-command";
import type {
  ApplicationContext,
  UiCommandController,
} from "../application-context";
import { analyzeManualSwap } from "../../domain/reviews/manual-swap-analysis";
import {
  buildNextWorkdayFlightCandidates,
  materializeNextWorkdayFlights,
  updateNextWorkdayFlightBookedPassengers,
} from "../../domain/flights/next-workday-flight-plan";
import {
  flightNumbersForDate,
  isoWeekdayForDate,
} from "../../domain/flights/weekly-flight-plan";

export class ScheduleController implements UiCommandController {
  constructor(private readonly context: ApplicationContext) {}

  async handle(command: UiCommand): Promise<boolean> {
    const schedule = this.context.store.getState().schedule;
    switch (command.type) {
      case "generate-schedule":
        await this.generate(this.context.view().date);
        return true;
      case "stop-schedule-without-result":
        if (!this.context.scheduleRunner.stopWithoutResult())
          this.context.toast("当前没有正在运行的排班", "warning");
        return true;
      case "stop-schedule-with-current-result":
        if (!this.context.scheduleRunner.stopWithCurrentResult())
          this.context.toast("完整安全方案尚未准备好，请稍后再试", "warning");
        return true;
      case "open-swap-analysis":
        this.context.updateView({
          dialog: {
            kind: "swap-analysis",
            sourceAssignmentId: command.assignmentId,
            targetAssignmentId: null,
            analysis: null,
          },
        });
        return true;
      case "select-swap-target":
        return this.selectSwapTarget(command.assignmentId);
      case "apply-swap-analysis":
        return this.applySwapAnalysis();
      case "toggle-administrative-mode":
        schedule.setAdministrativeMode(command.enabled);
        this.context.commit();
        await this.generate(this.context.view().date);
        return true;
      case "assign-staff":
        return this.assign(
          command.assignmentId,
          command.staffId,
          command.sourceAssignmentId
        );
      case "update-assignment": {
        const result = schedule.updateAssignment(
          command.id,
          command.field,
          command.value
        );
        if (result.error) this.context.toast(result.error, "danger");
        else if (result.changed) {
          this.context.commit(result.message);
          if (result.warning) this.context.toast(result.warning, "warning");
        }
        return true;
      }
      case "create-temporary-assignment":
        {
          const result = schedule.createTemporary(
            command.flightId,
            command.position,
            command.staffName,
            command.layoutGroup,
            command.layoutIndex
          );
          if (result.error) this.context.toast(result.error, "danger");
          else if (result.changed) {
            this.context.commit(result.message ?? "已增加临时岗位");
            if (result.warning) this.context.toast(result.warning, "warning");
          }
        }
        return true;
      case "delete-temporary-assignment":
        if (schedule.deleteTemporary(command.id))
          this.context.commit("临时岗位已移除");
        return true;
      case "clear-schedule":
        if (
          this.context.model().assignments.length &&
          this.context.confirm("确认清空当前排班？")
        ) {
          schedule.clear();
          this.context.commit("当前排班已清空");
        }
        return true;
      case "archive-schedule":
        this.archive();
        return true;
      case "archive-next-duty-day":
        this.openNextWorkdayFlightPicker();
        return true;
      case "update-next-workday-flight-picker-selection":
        this.updateNextWorkdayFlightSelection(command.selectedIds);
        return true;
      case "update-next-workday-flight-picker-passengers":
        this.updateNextWorkdayFlightPassengers(
          command.candidateId,
          command.bookedPassengers
        );
        return true;
      case "confirm-next-workday-flight-picker":
        await this.confirmNextWorkdayFlightPicker(command.selectedIds);
        return true;
      case "set-schedule-zoom": {
        const zoom = Math.min(1.6, Math.max(0.7, command.value));
        this.context.preferences.saveScheduleZoom(zoom);
        this.context.updateView({ zoom });
        return true;
      }
      case "set-load-sort":
        this.context.updateView({
          loadSortField: command.field,
          loadSortDirection: command.direction,
        });
        return true;
      default:
        return false;
    }
  }

  async generate(date: string): Promise<void> {
    try {
      const outcome = await this.context.scheduleRunner.calculate(
        this.context.model(),
        date
      );
      if (outcome.kind === "stopped-without-result") {
        this.context.toast("排班已停止，原班表保持不变", "warning");
        return;
      }
      const result = outcome.result;
      this.context.store.getState().schedule.install(date, result);
      this.context.updateView({ section: "schedule" });
      this.context.commit(
        outcome.kind === "stopped-with-result"
          ? "排班已停止，并采用最近一份完整安全方案"
          : result.unfilledCount
            ? `排班已生成，${result.unfilledCount} 个常规岗位待补位`
            : "排班已生成"
      );
    } catch (error) {
      this.context.toast(
        `排班生成失败：${error instanceof Error ? error.message : String(error)}`,
        "danger"
      );
    }
  }

  private assign(
    assignmentId: string,
    staffId: string,
    sourceAssignmentId?: string
  ): boolean {
    const result = this.context.store
      .getState()
      .schedule.assignStaff(assignmentId, staffId, sourceAssignmentId);
    if (result.error) this.context.toast(result.error, "danger");
    else if (result.changed) {
      this.context.commit(result.message);
      if (result.warning) this.context.toast(result.warning, "warning");
    }
    return true;
  }

  private selectSwapTarget(targetAssignmentId: string): boolean {
    const dialog = this.context.view().dialog;
    if (dialog?.kind !== "swap-analysis") return true;
    const analysis = analyzeManualSwap(
      this.context.model(),
      this.context.view().date,
      dialog.sourceAssignmentId,
      targetAssignmentId
    );
    this.context.updateView({
      dialog: { ...dialog, targetAssignmentId, analysis },
    });
    return true;
  }

  private applySwapAnalysis(): boolean {
    const dialog = this.context.view().dialog;
    if (dialog?.kind !== "swap-analysis" || !dialog.targetAssignmentId)
      return true;
    const analysis = analyzeManualSwap(
      this.context.model(),
      this.context.view().date,
      dialog.sourceAssignmentId,
      dialog.targetAssignmentId
    );
    if (analysis.outcome === "blocked") {
      this.context.updateView({ dialog: { ...dialog, analysis } });
      this.context.toast(`不能交换：${analysis.blockers.join("；")}`, "danger");
      return true;
    }
    const source = this.context
      .model()
      .assignments.find(
        (assignment) => assignment.id === dialog.sourceAssignmentId
      );
    const target = this.context
      .model()
      .assignments.find(
        (assignment) => assignment.id === dialog.targetAssignmentId
      );
    if (!source || !target?.staffId) {
      this.context.toast("岗位已经变化，请重新打开分析", "danger");
      return true;
    }
    const result = this.context.store
      .getState()
      .schedule.assignStaff(source.id, target.staffId, target.id);
    if (result.error) {
      this.context.toast(result.error, "danger");
      return true;
    }
    if (result.changed) {
      this.context.updateView({ dialog: null });
      this.context.commit("人员岗位已按分析结果交换");
      if (result.warning) this.context.toast(result.warning, "warning");
    }
    return true;
  }

  private archive(): void {
    const records = currentScheduleHistory(
      this.context.model(),
      this.context.view().date
    );
    if (!records.length)
      return this.context.toast("没有可归档的已排岗位", "warning");
    if (!this.confirmStale("归档当前排班")) return;
    if (
      !this.context.confirm(
        `将 ${records.length} 条已排岗位归档到 ${this.context.view().date}？同日旧记录会被替换。`
      )
    )
      return;
    this.context.store
      .getState()
      .records.replaceHistory(this.context.view().date, records);
    this.context.commit("排班已归档到历史");
  }

  private openNextWorkdayFlightPicker(): void {
    const currentDate = this.context.view().date;
    const records = currentScheduleHistory(this.context.model(), currentDate);
    if (!records.length)
      return this.context.toast("没有可归档的已排岗位", "warning");
    const nextDate = addIsoDays(currentDate, 2);
    const model = this.context.model();
    const candidates = buildNextWorkdayFlightCandidates(
      model.templates,
      flightNumbersForDate(model.weeklyFlightPlans, nextDate)
    );
    if (!candidates.length)
      return this.context.toast("没有可选择的本地航班", "warning");
    this.context.updateView({
      dialog: {
        kind: "next-workday-flight-picker",
        date: nextDate,
        weekday: isoWeekdayForDate(nextDate),
        candidates,
        selectedIds: candidates
          .filter((candidate) => candidate.selectedByDefault)
          .map((candidate) => candidate.id),
      },
    });
  }

  private updateNextWorkdayFlightSelection(selectedIds: string[]): void {
    const dialog = this.context.view().dialog;
    if (dialog?.kind !== "next-workday-flight-picker") return;
    const candidateIds = new Set(
      dialog.candidates.map((candidate) => candidate.id)
    );
    this.context.updateView({
      dialog: {
        ...dialog,
        selectedIds: [...new Set(selectedIds)].filter((id) =>
          candidateIds.has(id)
        ),
      },
    });
  }

  private updateNextWorkdayFlightPassengers(
    candidateId: string,
    bookedPassengers: number
  ): void {
    const dialog = this.context.view().dialog;
    if (dialog?.kind !== "next-workday-flight-picker") return;
    this.context.updateView({
      dialog: {
        ...dialog,
        candidates: updateNextWorkdayFlightBookedPassengers(
          dialog.candidates,
          candidateId,
          bookedPassengers
        ),
      },
    });
  }

  private async confirmNextWorkdayFlightPicker(
    selectedIds: string[]
  ): Promise<void> {
    const dialog = this.context.view().dialog;
    if (dialog?.kind !== "next-workday-flight-picker") return;
    const currentDate = this.context.view().date;
    const records = currentScheduleHistory(this.context.model(), currentDate);
    if (!records.length) {
      this.context.toast("没有可归档的已排岗位", "warning");
      return;
    }
    if (!this.confirmStale("归档当前排班并生成后天排班")) return;
    const selected = new Set(selectedIds);
    const flights = materializeNextWorkdayFlights(
      dialog.candidates,
      dialog.candidates
        .filter((candidate) => selected.has(candidate.id))
        .map((candidate) => candidate.id)
    );
    if (!flights.length) {
      this.context.toast("请至少选择一个航班", "warning");
      return;
    }
    const nextDate = dialog.date;
    if (
      !this.context.confirm(
        `归档 ${currentDate}，并根据已选择的 ${flights.length} 个航班生成后天 ${nextDate} 排班？`
      )
    )
      return;

    const temporaryState = structuredClone(this.context.model());
    temporaryState.history = [
      ...temporaryState.history.filter((item) => item.date !== currentDate),
      ...records,
    ];
    temporaryState.flights = flights;
    temporaryState.assignments = [];
    temporaryState.activeScheduleDate = null;
    temporaryState.schedulePolicyStale = false;

    this.context.updateView({ dialog: null });
    try {
      const outcome = await this.context.scheduleRunner.calculate(
        temporaryState,
        nextDate
      );
      if (outcome.kind !== "completed") {
        this.context.toast("排班已停止，原班表保持不变", "warning");
        return;
      }
      installArchivedNextWorkdaySchedule(
        temporaryState,
        currentDate,
        records,
        nextDate,
        flights,
        outcome.result
      );
      this.context.store.getState().replaceModel(temporaryState);
      this.context.preferences.saveScheduleDate(nextDate);
      this.context.updateView({ date: nextDate, section: "schedule" });
      this.context.commit(
        outcome.result.unfilledCount
          ? `后天排班已生成，${outcome.result.unfilledCount} 个常规岗位待补位`
          : "后天排班已生成"
      );
    } catch (error) {
      this.context.toast(
        `后天排班生成失败：${error instanceof Error ? error.message : String(error)}`,
        "danger"
      );
    }
  }

  private confirmStale(action: string): boolean {
    return (
      !this.context.model().schedulePolicyStale ||
      this.context.confirm(
        `排班规则已更新，但当前班表尚未重新生成。仍要${action}吗？`
      )
    );
  }
}
