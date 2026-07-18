export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function splitList(value: unknown): string[] {
  return normalizeText(value)
    .split(/[,，、/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function visiblePositionRemark(value: unknown): string {
  return normalizeText(value)
    .replaceAll("一号", "")
    .replaceAll(/^[\s，、,/]+|[\s，、,/]+$/g, "")
    .trim();
}

export function combinedAssignmentRemark(positionRemark: unknown, manualRemark: unknown): string {
  return [visiblePositionRemark(positionRemark), normalizeText(manualRemark)].filter(Boolean).join("；");
}

export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function assertElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`页面缺少元素：${selector}`);
  return element;
}
