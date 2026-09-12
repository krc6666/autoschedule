export interface GlobalErrorBoundary {
  dispose(): void;
}

const PANEL_ID = "autoschedule-global-error";

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "string") return error;
  try {
    const serialized = JSON.stringify(error);
    return serialized === undefined ? String(error) : serialized;
  } catch {
    return String(error);
  }
}

/** Installs a last-resort browser boundary without depending on Lit rendering. */
export function installGlobalErrorBoundary(
  host: HTMLElement
): GlobalErrorBoundary {
  let panel: HTMLElement | null = null;

  const report = (source: string, error: unknown): void => {
    // Keep the original error available to developers even when the page can
    // no longer render normally.
    console.error(`[autoschedule] ${source}`, error);

    if (!panel) {
      panel = document.createElement("aside");
      panel.id = PANEL_ID;
      panel.className =
        "alert alert-danger position-fixed top-0 start-50 translate-middle-x mt-3 shadow";
      panel.setAttribute("role", "alert");
      panel.style.zIndex = "2000";
      panel.innerHTML =
        '<strong>页面遇到问题，但已有数据仍然保留。</strong><div data-error-message class="small mt-1"></div>';
      (document.body ?? host).append(panel);
    }

    const details = panel.querySelector<HTMLElement>("[data-error-message]");
    if (details) {
      details.textContent = `请刷新页面重试；如问题持续，请查看控制台日志。(${source}: ${describeError(error)})`;
    }
  };

  const onError = (event: ErrorEvent): void => {
    report("window.error", event.error ?? event.message);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    report("unhandledrejection", event.reason);
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return {
    dispose: () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      panel?.remove();
      panel = null;
    },
  };
}
