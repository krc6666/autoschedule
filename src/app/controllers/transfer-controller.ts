import { buildFlightPlanReconciliation } from "../../domain/flights/flight-plan-reconciliation";
import { queryInternationalFlights } from "../../infrastructure/flight-query";
import { exportShareHtml, exportSharePng } from "../../infrastructure/share";
import type { UiCommand } from "../../ui/events/ui-command";
import { prepareWorkbookImport } from "../workbook-import-controller";
import type {
  ApplicationContext,
  UiCommandController,
} from "../application-context";

export class TransferController implements UiCommandController {
  constructor(private readonly context: ApplicationContext) {}

  async handle(command: UiCommand): Promise<boolean> {
    switch (command.type) {
      case "import-file":
        await this.importWorkbook(
          command.file,
          command.mode ?? "all",
          command.date ?? this.context.view().date
        );
        return true;
      case "export-config": {
        const { buildConfigWorkbook, writeWorkbook } =
          await import("../../infrastructure/excel");
        writeWorkbook(
          buildConfigWorkbook(this.context.model()),
          "排班工具配置.xlsx"
        );
        return true;
      }
      case "export-schedule": {
        const { buildScheduleWorkbook, writeWorkbook } =
          await import("../../infrastructure/excel");
        writeWorkbook(
          buildScheduleWorkbook(
            this.context.model().assignments,
            this.context.view().date
          ),
          `保障明细_${this.context.view().date}.xlsx`
        );
        return true;
      }
      case "export-share-html":
        exportShareHtml(this.context.model(), this.context.view().date);
        return true;
      case "export-share-png":
        try {
          await exportSharePng(this.context.model(), this.context.view().date);
        } catch (error) {
          this.context.toast(
            `图片导出失败：${error instanceof Error ? error.message : String(error)}`,
            "danger"
          );
        }
        return true;
      case "open-flight-query":
        this.context.updateView({
          dialog: {
            kind: "flight-query",
            date: this.context.view().date,
            loading: false,
            reconciliation: null,
            fetchedAt: "",
            error: "",
          },
        });
        return true;
      case "run-flight-query":
        await this.queryFlights(command.date);
        return true;
      case "apply-flight-query":
        return this.applyFlightQuery(command.templateIds, command.flightIds);
      default:
        return false;
    }
  }

  private async importWorkbook(
    file: File,
    mode: "all" | "config" | "history" | "duty-roster",
    date: string
  ): Promise<void> {
    try {
      const importedState = structuredClone(this.context.model());
      const prepared = await prepareWorkbookImport(
        importedState,
        file,
        mode,
        date
      );
      if (prepared.kind === "duty-roster") {
        this.context.updateView({
          dialog: { kind: "duty-roster-import", preview: prepared.preview },
        });
        return;
      }
      this.context.store.getState().replaceModel(importedState);
      this.context.commit(
        prepared.recognized
          ? `已导入 ${prepared.recognized}`
          : (prepared.warnings[0] ?? "文件中没有有效数据")
      );
      if (prepared.recognized && prepared.warnings.length)
        this.context.toast(prepared.warnings.join("；"), "warning");
    } catch (error) {
      this.context.toast(
        `导入失败：${error instanceof Error ? error.message : String(error)}`,
        "danger"
      );
    }
  }

  private async queryFlights(date: string): Promise<void> {
    this.context.updateView({
      dialog: {
        kind: "flight-query",
        date,
        loading: true,
        reconciliation: null,
        fetchedAt: "",
        error: "",
      },
    });
    try {
      const result = await queryInternationalFlights(date);
      const reconciliation = buildFlightPlanReconciliation(
        this.context.model(),
        this.context.view().date,
        result
      );
      this.context.updateView({
        dialog: {
          kind: "flight-query",
          date,
          loading: false,
          reconciliation,
          fetchedAt: result.fetchedAt,
          error: "",
        },
      });
    } catch (error) {
      this.context.updateView({
        dialog: {
          kind: "flight-query",
          date,
          loading: false,
          reconciliation: null,
          fetchedAt: "",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private applyFlightQuery(
    templateIds: string[],
    flightIds: string[]
  ): boolean {
    const dialog = this.context.view().dialog;
    if (dialog?.kind !== "flight-query" || !dialog.reconciliation) return true;
    if (!templateIds.length && !flightIds.length) {
      this.context.toast("当前没有勾选需要新增或删减的航班", "warning");
      return true;
    }
    if (flightIds.length && !dialog.reconciliation.removalAllowed) {
      this.context.toast(dialog.reconciliation.removalBlockedReason, "warning");
      return true;
    }
    if (flightIds.length) {
      const flightNumbers = dialog.reconciliation.removals
        .filter((flight) => flightIds.includes(flight.id))
        .map((flight) => flight.flightNo)
        .join("、");
      if (
        !this.context.confirm(
          `确认从当前航班计划删除 ${flightIds.length} 个航班（${flightNumbers}）？删除后已有排班结果将失效，需重新排班。`
        )
      )
        return true;
    }
    const result = this.context.store
      .getState()
      .configuration.applyFlightPlan(
        dialog.reconciliation,
        templateIds,
        flightIds
      );
    if (!result.added && !result.removed) {
      this.context.toast(
        "所选内容已失效，当前计划没有变化，请重新查询",
        "warning"
      );
      return true;
    }
    localStorage.setItem("autoschedule.scheduleDate", dialog.date);
    this.context.updateView({ dialog: null });
    this.context.updateView({ date: dialog.date });
    this.context.commit(
      `航班计划已更新：新增 ${result.added} 个，删除 ${result.removed} 个`
    );
    return true;
  }
}
