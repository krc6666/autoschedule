import { loadPluginFile } from "../../infrastructure/plugin-host";
import type { UiCommand } from "../../ui/events/ui-command";
import type {
  ApplicationContext,
  UiCommandController,
} from "../application-context";

export class PolicyController implements UiCommandController {
  constructor(private readonly context: ApplicationContext) {}

  async handle(command: UiCommand): Promise<boolean> {
    const policy = this.context.store.getState().policy;
    switch (command.type) {
      case "apply-policy":
        policy.apply(command.input);
        this.context.commit(
          "排班规则已保存；当前班表需重新排班后才会执行新规则"
        );
        return true;
      case "update-policy":
        if (
          policy.updateEntity(
            command.entity,
            command.id,
            command.field,
            command.value
          ) !== "missing"
        )
          this.context.commit();
        return true;
      case "add-policy-item":
        if (command.collection === "duty") policy.addDutyPriority();
        else if (command.collection === "recovery-target")
          policy.addRecoveryTarget();
        else if (command.collection === "late-position")
          policy.addLateShiftPosition();
        else if (command.collection === "supervisor")
          policy.addSupervisorCoverage();
        else policy.addTransition();
        this.context.commit("已新增规则项");
        return true;
      case "delete-policy-item":
        return this.deleteItem(command.collection, command.id);
      case "move-duty-priority":
        if (policy.moveDutyPriority(command.id, command.direction))
          this.context.commit("值班岗位优先顺序已调整");
        return true;
      case "set-hook-enabled":
        if (policy.setHookEnabled(command.id, command.enabled))
          this.context.commit(
            command.enabled ? "规则 Hook 已启用" : "规则 Hook 已停用"
          );
        return true;
      case "move-hook":
        if (policy.moveHook(command.id, command.direction))
          this.context.commit("规则 Hook 顺序已调整");
        return true;
      case "load-plugin":
        return this.loadPlugin(command.file);
      case "set-plugin-enabled":
        if (policy.setPluginEnabled(command.id, command.enabled))
          this.context.commit(command.enabled ? "插件已启用" : "插件已停用");
        return true;
      case "set-plugin-rule-enabled":
        if (
          policy.setPluginRuleEnabled(
            command.pluginId,
            command.ruleId,
            command.enabled
          )
        )
          this.context.commit("插件规则状态已更新");
        return true;
      case "move-plugin":
        if (policy.movePlugin(command.id, command.direction))
          this.context.commit("插件顺序已调整");
        return true;
      case "move-plugin-rule":
        if (
          policy.movePluginRule(
            command.pluginId,
            command.ruleId,
            command.direction
          )
        )
          this.context.commit("插件规则顺序已调整");
        return true;
      case "remove-plugin":
        if (
          this.context.confirm("确认移除这个插件及其规则配置？") &&
          policy.removePlugin(command.id)
        ) {
          this.context.pluginSession.remove(command.id);
          this.context.commit("插件已移除");
        }
        return true;
      default:
        return false;
    }
  }

  private deleteItem(
    collection: Extract<
      UiCommand,
      { type: "delete-policy-item" }
    >["collection"],
    id: string
  ): boolean {
    if (!this.context.confirm("确认删除这条规则配置？")) return true;
    const policy = this.context.store.getState().policy;
    const deleted =
      collection === "duty"
        ? policy.deleteDutyPriority(id)
        : collection === "recovery-target"
          ? policy.deleteRecoveryTarget(id)
          : collection === "late-position"
            ? policy.deleteLateShiftPosition(id)
            : collection === "supervisor"
              ? policy.deleteSupervisorCoverage(id)
              : policy.deleteTransition(id);
    if (deleted) this.context.commit("规则配置已删除");
    return true;
  }

  private async loadPlugin(file: File): Promise<boolean> {
    try {
      const plugin = await loadPluginFile(file);
      this.context.pluginSession.install(plugin);
      this.context.store.getState().policy.registerPlugin(plugin);
      this.context.commit(`插件 ${plugin.manifest.name} 已加载`);
    } catch (error) {
      this.context.toast(
        `插件加载失败：${error instanceof Error ? error.message : String(error)}`,
        "danger"
      );
    }
    return true;
  }
}
