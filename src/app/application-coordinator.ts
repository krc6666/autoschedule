import { PluginSession } from "../infrastructure/plugin-session";
import type { UiCommand } from "../ui/events/ui-command";
import { ConfigurationController } from "./controllers/configuration-controller";
import { PolicyController } from "./controllers/policy-controller";
import { RecordsController } from "./controllers/records-controller";
import { ScheduleController } from "./controllers/schedule-controller";
import { TransferController } from "./controllers/transfer-controller";
import type {
  ApplicationContext,
  UiCommandController,
} from "./application-context";
import type { ApplicationViewState } from "./application-view-state";
import { createBrowserScheduleRunController } from "./schedule-run-controller";
import type { AutoscheduleStore } from "./store/autoschedule-store";
import { plannedScheduleProgress } from "../domain/kernel/schedule-pipeline";
import { todayIso } from "../utils";

export interface ApplicationCoordinatorOptions {
  confirm?: (message: string) => boolean;
  onViewChange?: (view: ApplicationViewState) => void;
}

function initialView(): ApplicationViewState {
  const storedZoom = Number(localStorage.getItem("autoschedule.scheduleZoom"));
  return {
    section: "overview",
    date: localStorage.getItem("autoschedule.scheduleDate") || todayIso(),
    zoom: Math.min(1.6, Math.max(0.7, storedZoom || 1)),
    loadSortField: "totalFatigue",
    loadSortDirection: "desc",
    dialog: null,
    toast: null,
    progress: {
      outcome: "idle",
      visible: false,
      stage: "prepare",
      percent: 0,
      steps: [],
    },
  };
}

export class ApplicationCoordinator implements ApplicationContext {
  readonly pluginSession = new PluginSession();
  readonly scheduleRunner;
  private currentView = initialView();
  private readonly controllers: UiCommandController[];
  private toastId = 0;
  private progressHideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly store: AutoscheduleStore,
    private readonly options: ApplicationCoordinatorOptions = {}
  ) {
    this.scheduleRunner = createBrowserScheduleRunController({
      start: () => {
        if (this.progressHideTimer) clearTimeout(this.progressHideTimer);
        this.updateView({
          progress: {
            outcome: "running",
            visible: true,
            stage: "prepare",
            percent: 0,
            steps: plannedScheduleProgress(
              this.model().settings,
              this.model().flights
            ),
          },
        });
      },
      progress: (stage, percent) =>
        this.updateView({
          progress: {
            ...this.currentView.progress,
            outcome: "running",
            visible: true,
            stage,
            percent,
          },
        }),
      finish: (outcome) => {
        this.updateView({
          progress: { ...this.currentView.progress, outcome },
        });
        this.progressHideTimer = setTimeout(
          () =>
            this.updateView({
              progress: { ...this.currentView.progress, visible: false },
            }),
          outcome === "completed" ? 1600 : 5000
        );
      },
    });
    this.controllers = [
      new ConfigurationController(this),
      new PolicyController(this),
      new ScheduleController(this),
      new RecordsController(this),
      new TransferController(this),
    ];
  }

  start(): void {
    this.options.onViewChange?.(this.currentView);
  }

  view(): ApplicationViewState {
    return this.currentView;
  }

  model() {
    return this.store.getState().model;
  }

  updateView(patch: Partial<ApplicationViewState>): void {
    this.currentView = { ...this.currentView, ...patch };
    this.options.onViewChange?.(this.currentView);
  }

  commit(message?: string): void {
    this.store.getState().persist();
    if (message) this.toast(message);
  }

  toast(
    message: string,
    tone: "success" | "danger" | "warning" = "success"
  ): void {
    this.updateView({ toast: { id: ++this.toastId, message, tone } });
  }

  confirm(message: string): boolean {
    return (this.options.confirm ?? globalThis.confirm)(message);
  }

  async handle(command: UiCommand): Promise<void> {
    if (this.handleViewCommand(command)) return;
    for (const controller of this.controllers) {
      if (await controller.handle(command)) return;
    }
    throw new Error(`未处理的界面命令：${command.type}`);
  }

  private handleViewCommand(command: UiCommand): boolean {
    switch (command.type) {
      case "navigate":
        this.updateView({ section: command.section });
        return true;
      case "change-date":
        localStorage.setItem("autoschedule.scheduleDate", command.date);
        this.updateView({ date: command.date });
        return true;
      case "close-dialog":
        this.updateView({ dialog: null });
        return true;
      case "dismiss-toast":
        this.updateView({ toast: null });
        return true;
      case "reset-all":
        if (this.confirm("确认恢复初始数据？当前本地数据将被替换。")) {
          this.store.getState().reset();
          this.commit("已恢复初始数据");
        }
        return true;
      case "open-import":
        return false;
      default:
        return false;
    }
  }
}
