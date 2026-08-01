import type { AppSection } from "../../model";

export interface ApplicationNavigationItem {
  id: AppSection;
  label: string;
  icon: string;
}

export const APPLICATION_NAVIGATION: readonly ApplicationNavigationItem[] = [
  { id: "overview", label: "总览", icon: "speedometer2" },
  { id: "config", label: "配置", icon: "sliders" },
  { id: "flights", label: "航班", icon: "airplane" },
  { id: "schedule", label: "排班", icon: "calendar2-check" },
  { id: "policy", label: "规则", icon: "diagram-3" },
  { id: "statistics", label: "统计", icon: "bar-chart" },
  { id: "history", label: "历史", icon: "clock-history" },
] as const;
