import { currentScheduleHistory } from "../history-actions";
import { manualAssignmentConfirmation } from "../schedule-actions";
import { addIsoDays } from "../../domain/shared/time";
import type { UiCommand } from "../../ui/events/ui-command";
import type {
  ApplicationContext,
  UiCommandController,
} from "../application-context";

export class ScheduleController implements UiCommandController {
  constructor(private readonly context: ApplicationContext) {}

  async handle(command: UiCommand): Promise<boolean> {
    const schedule = this.context.store.getState().schedule;
    switch (command.type) {
      case "generate-schedule":
        await this.generate(this.context.view().date);
        return true;
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
        if (command.field === "staffName") {
          const person = this.context
            .model()
            .staff.find(
              (item) => item.name.trim() === String(command.value).trim()
            );
          if (person && !this.confirmCutoff(command.id, person.id)) return true;
        }
        const result = schedule.updateAssignment(
          command.id,
          command.field,
          command.value
        );
        if (result.error) this.context.toast(result.error, "danger");
        else if (result.changed) this.context.commit(result.message);
        return true;
      }
      case "create-temporary-assignment":
        if (
          schedule.createTemporary(
            command.flightId,
            command.position,
            command.staffName,
            command.layoutGroup,
            command.layoutIndex
          )
        )
          this.context.commit("已增加临时岗位");
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
        await this.archiveNext();
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
      const result = await this.context.scheduleRunner.calculate(
        this.context.model(),
        date
      );
      this.context.store.getState().schedule.install(date, result);
      this.context.updateView({ section: "schedule" });
      this.context.commit(
        result.unfilledCount
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
    if (staffId && !this.confirmCutoff(assignmentId, staffId)) return true;
    const result = this.context.store
      .getState()
      .schedule.assignStaff(assignmentId, staffId, sourceAssignmentId);
    if (result.error) this.context.toast(result.error, "danger");
    else if (result.changed) this.context.commit(result.message);
    return true;
  }

  private confirmCutoff(assignmentId: string, staffId: string): boolean {
    const message = manualAssignmentConfirmation(
      this.context.model(),
      assignmentId,
      staffId,
      this.context.view().date
    );
    return !message || this.context.confirm(message);
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

  private async archiveNext(): Promise<void> {
    const currentDate = this.context.view().date;
    const records = currentScheduleHistory(this.context.model(), currentDate);
    if (!records.length)
      return this.context.toast("没有可归档的已排岗位", "warning");
    if (!this.confirmStale("归档当前排班并生成后天排班")) return;
    const nextDate = addIsoDays(currentDate, 2);
    if (
      !this.context.confirm(
        `归档 ${currentDate}，并根据今天的负荷生成后天 ${nextDate} 排班？`
      )
    )
      return;
    this.context.store.getState().records.replaceHistory(currentDate, records);
    this.context.updateView({ date: nextDate });
    this.context.preferences.saveScheduleDate(nextDate);
    await this.generate(nextDate);
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
