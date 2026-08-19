import type { UiCommand } from "../../ui/events/ui-command";
import type {
  ApplicationContext,
  UiCommandController,
} from "../application-context";

export class RecordsController implements UiCommandController {
  constructor(private readonly context: ApplicationContext) {}

  async handle(command: UiCommand): Promise<boolean> {
    const records = this.context.store.getState().records;
    switch (command.type) {
      case "clear-history":
        if (
          this.context.model().history.length &&
          this.context.confirm("确认清空全部历史排班？")
        ) {
          records.clearHistory();
          this.context.commit("历史排班已清空");
        }
        return true;
      case "delete-history":
        records.deleteHistory(command.id);
        this.context.commit("历史记录已删除");
        return true;
      case "update-duty-roster": {
        if (!command.staffId) this.context.toast("轮值人员不能为空", "danger");
        else {
          const error = records.updateDutyRoster(
            command.date,
            command.slot,
            command.staffId
          );
          if (error) this.context.toast(error, "danger");
          else this.context.commit(`${command.date} 轮值已调整`);
        }
        return true;
      }
      case "reset-duty-roster":
        records.clearDutyRosterDay(command.date);
        this.context.commit(`${command.date} 已恢复顺序轮值`);
        return true;
      case "rebalance-duty-roster-month":
        if (
          this.context.confirm(
            `清除 ${command.date.slice(0, 7)} 的人工轮值调整，并按值班优先规则重新均衡？`
          )
        ) {
          records.clearDutyRosterMonth(command.date);
          this.context.commit(`${command.date.slice(0, 7)} 已重新均衡轮值`);
        }
        return true;
      case "download-duty-roster-template": {
        const [{ buildDutyRosterTemplateWorkbook }, { writeWorkbook }] =
          await Promise.all([
            import("../../infrastructure/duty-roster-excel"),
            import("../../infrastructure/excel"),
          ]);
        writeWorkbook(
          buildDutyRosterTemplateWorkbook(
            this.context.model(),
            command.date || this.context.view().date
          ),
          `值班备勤表_${(command.date || this.context.view().date).slice(0, 7)}.xlsx`
        );
        return true;
      }
      case "apply-duty-roster-import": {
        const dialog = this.context.view().dialog;
        if (dialog?.kind !== "duty-roster-import" || !dialog.preview.canApply)
          this.context.toast("当前值班备勤表存在阻止导入的问题", "danger");
        else {
          const result = records.applyDutyRosterImport(dialog.preview);
          if (!result.importedDays)
            this.context.toast(
              "值班备勤安排已发生变化，请重新选择文件并核对预览",
              "danger"
            );
          else {
            this.context.updateView({ dialog: null });
            this.context.commit(
              `已导入 ${dialog.preview.month} 值班备勤表：${result.importedDays} 个工作班、${result.importedAssignments} 项安排；CX航前保持不变`
            );
          }
        }
        return true;
      }
      case "adjust-late-priority-frequency":
        if (
          records.adjustLatePriorityFrequency(
            command.month,
            command.staffId,
            command.flightNo,
            command.kind,
            command.delta
          )
        )
          this.context.commit();
        return true;
      default:
        return false;
    }
  }
}
