import type {
  ApplicationContext,
  UiCommandController,
} from "../application-context";
import type { UiCommand } from "../../ui/events/ui-command";

export class ConfigurationController implements UiCommandController {
  constructor(private readonly context: ApplicationContext) {}

  async handle(command: UiCommand): Promise<boolean> {
    const commands = this.context.store.getState().configuration;
    switch (command.type) {
      case "update-configuration": {
        if (command.entity === "staff" && command.field === "status") {
          const status =
            command.value === "病假"
              ? "病假"
              : command.value === "休假"
                ? "休假"
                : "正常";
          const changed = this.context.store
            .getState()
            .schedule.applyStaffStatus(command.id, status);
          if (!changed) return true;
          const activeDate = this.context.model().activeScheduleDate;
          if (!activeDate) {
            this.context.commit("人员状态已更新");
            return true;
          }
          try {
            const plugins = this.context.pluginSession.manifests(
              this.context.model().pluginConfigurations
            );
            const result = await this.context.scheduleRunner.calculate(
              this.context.model(),
              activeDate,
              plugins
            );
            this.context.store.getState().schedule.install(activeDate, result);
            this.context.commit(
              result.unfilledCount
                ? `人员状态已更新，当前排班已重新计算，${result.unfilledCount} 个岗位待补位`
                : "人员状态已更新，当前排班已重新计算"
            );
          } catch (error) {
            this.context.toast(
              `人员状态已更新，但排班重新计算失败：${error instanceof Error ? error.message : String(error)}`,
              "danger"
            );
          }
          return true;
        }
        const result = commands.updateField(
          command.entity,
          command.id,
          command.field,
          command.value
        );
        if (result === "duplicate")
          this.context.toast("人员编号不能重复", "danger");
        else if (result !== "missing") this.context.commit();
        return true;
      }
      case "add-flight":
        commands.addFlight();
        this.context.commit("已新增航班");
        return true;
      case "delete-flight": {
        const flight = this.context
          .model()
          .flights.find((item) => item.id === command.id);
        if (
          flight &&
          this.context.confirm(`确认删除航班 ${flight.flightNo}？`) &&
          commands.deleteFlight(command.id)
        )
          this.context.commit("航班已删除");
        return true;
      }
      case "open-flight-templates":
        this.context.updateView({ dialog: { kind: "templates" } });
        return true;
      case "add-template-flight":
        if (commands.addTemplateFlight(command.id))
          this.context.commit("已从模板添加航班");
        this.context.updateView({ dialog: null });
        return true;
      case "add-template":
        commands.addTemplate();
        this.context.commit("已新增航班模板");
        return true;
      case "delete-template":
        commands.deleteTemplate(command.id);
        this.context.commit("模板已删除");
        return true;
      case "add-staff":
        command.administrative
          ? commands.addAdministrativeStaff()
          : commands.addStaff();
        this.context.commit(
          command.administrative ? "已新增行政支援人员" : "已新增人员"
        );
        return true;
      case "delete-staff": {
        const person = this.context
          .model()
          .staff.find((item) => item.id === command.id);
        if (
          person &&
          this.context.confirm(
            `确认删除 ${person.name}？相关岗位资质也会同步移除。`
          ) &&
          commands.deleteStaff(command.id)
        )
          this.context.commit("人员已删除");
        return true;
      }
      case "add-positions": {
        if (!command.flightNo) this.context.toast("请先配置航班", "warning");
        else
          this.context.commit(
            `已为 ${command.flightNo} 新增 ${commands.addPositions(command.flightNo, command.count)} 条岗位规则`
          );
        return true;
      }
      case "delete-position": {
        const rule = this.context
          .model()
          .positionRules.find((item) => item.id === command.id);
        if (
          rule &&
          this.context.confirm(`确认删除 ${rule.flightNo} / ${rule.name}？`) &&
          commands.deletePosition(command.id)
        )
          this.context.commit("岗位规则已删除");
        return true;
      }
      case "move-position":
        if (commands.movePosition(command.id, command.direction))
          this.context.commit("岗位顺序已调整");
        return true;
      case "sort-counters":
        commands.sortCountersDescending(command.flightNo);
        this.context.commit(`${command.flightNo} 柜台已按编号从大到小排列`);
        return true;
      case "open-qualification":
        this.context.updateView({
          dialog: { kind: "qualification", positionRuleId: command.id },
        });
        return true;
      case "save-qualification":
        if (
          commands.saveQualified(command.id, command.manual, command.staffIds)
        )
          this.context.commit("岗位资质已保存");
        this.context.updateView({ dialog: null });
        return true;
      default:
        return false;
    }
  }
}
