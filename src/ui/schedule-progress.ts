import {
  scheduleProgressLabel,
  type ScheduleProgressStage,
} from "../domain/schedule-progress";

export function updateScheduleProgress(
  root: HTMLElement,
  stage: ScheduleProgressStage,
  percent: number
): void {
  const panel = root.querySelector<HTMLElement>("#schedule-progress");
  if (!panel) return;
  panel.hidden = false;
  const safePercent = Math.min(100, Math.max(0, Math.round(percent)));
  const progress = panel.querySelector<HTMLElement>(".progress");
  const bar = panel.querySelector<HTMLElement>("#schedule-progress-bar");
  const percentLabel = panel.querySelector<HTMLElement>(
    "#schedule-progress-percent"
  );
  const detail = panel.querySelector<HTMLElement>("#schedule-progress-detail");
  if (progress) progress.setAttribute("aria-valuenow", String(safePercent));
  if (bar) bar.style.width = `${safePercent}%`;
  if (percentLabel) percentLabel.textContent = `${safePercent}%`;
  if (detail) detail.textContent = scheduleProgressLabel(stage);
}

export function setScheduleControlsDisabled(
  root: HTMLElement,
  disabled: boolean
): void {
  root
    .querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      '[data-action="generate-schedule"], [data-action="archive-and-next-duty"], [data-action="toggle-admin-support-mode"]'
    )
    .forEach((control) => {
      control.disabled = disabled;
    });
}

export function hideScheduleProgress(root: HTMLElement): void {
  const panel = root.querySelector<HTMLElement>("#schedule-progress");
  if (panel) panel.hidden = true;
}
