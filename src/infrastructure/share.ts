import type { AppState, Assignment } from "../model";
import { combinedAssignmentRemark, downloadBlob, escapeHtml } from "../utils";

const shareStyles = `
  *{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#1f2328;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI",sans-serif}
  .share-page{width:1400px;max-width:100%;margin:0 auto;background:#fff;padding:40px}.share-head{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:4px solid #b4232d;padding-bottom:18px;margin-bottom:26px}
  h1{font-size:30px;margin:0 0 6px}.date{font-size:18px;color:#59636e}.meta{color:#66707b}.flight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-bottom:30px}
  .flight{border:1px solid #d8dee4;border-radius:8px;overflow:hidden;break-inside:avoid}.flight-title{display:flex;align-items:center;justify-content:space-between;background:#b4232d;color:#fff;padding:12px 16px}
  .flight-title strong{font-size:19px}.flight-title span{font-size:13px}.flight table,.people table{width:100%;border-collapse:collapse}.flight th,.flight td,.people th,.people td{padding:8px 12px;border-bottom:1px solid #e7eaee;text-align:left;font-size:14px}
  .flight th,.people th{background:#f6f8fa;color:#4b5560;font-weight:600}.flight tr:last-child td{border-bottom:0}.unfilled{color:#b4232d;font-weight:700}.people{border-top:2px solid #1f2328;padding-top:18px}
  .people h2{font-size:20px;margin:0 0 14px}.person-name{font-weight:700}.footer{display:flex;justify-content:space-between;margin-top:24px;padding-top:14px;border-top:1px solid #d8dee4;color:#76808b;font-size:12px}
  @media(max-width:800px){.share-page{padding:20px}.flight-grid{grid-template-columns:1fr}.share-head{align-items:flex-start;gap:12px;flex-direction:column}}
  @media print{body{background:#fff}.share-page{width:auto;padding:12mm}.flight{break-inside:avoid}.flight-grid{gap:10mm}}
`;

function groupedByStaff(assignments: Assignment[]): Array<{ name: string; items: Assignment[] }> {
  const groups = new Map<string, Assignment[]>();
  for (const item of assignments.filter((assignment) => assignment.staffId)) {
    const key = item.staffName;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({ name, items: items.sort((a, b) => a.startTime.localeCompare(b.startTime)) }))
    .sort((a, b) => a.items[0]!.startTime.localeCompare(b.items[0]!.startTime) || a.name.localeCompare(b.name, "zh-CN"));
}

export function buildShareMarkup(state: AppState, date: string): string {
  const flights = state.flights.map((flight) => ({
    flight,
    assignments: state.assignments.filter((assignment) => assignment.flightId === flight.id)
  }));
  const people = groupedByStaff(state.assignments);
  const assignedCount = state.assignments.filter((item) => item.status === "assigned").length;
  const unfilledCount = state.assignments.filter((item) => item.status === "unfilled").length;
  return `<div class="share-page" id="share-sheet">
    <header class="share-head"><div><h1>国际航班保障排班</h1><div class="date">${escapeHtml(date)}</div></div><div class="meta">${flights.length} 个航班 · ${assignedCount} 个岗位已排${unfilledCount ? ` · ${unfilledCount} 个待补位` : ""}</div></header>
    <main class="flight-grid">${flights.map(({ flight, assignments }) => `<section class="flight"><div class="flight-title"><strong>${escapeHtml(flight.flightNo)}</strong><span>${escapeHtml(flight.startTime)}–${escapeHtml(flight.endTime)} · ${escapeHtml(flight.remark)}</span></div><table><thead><tr><th>岗位</th><th>保障人员</th><th>备注</th></tr></thead><tbody>${assignments.map((item) => `<tr><td>${escapeHtml(item.position)}</td><td class="${item.staffName || item.status === "manual" ? "" : "unfilled"}">${escapeHtml(item.staffName || (item.status === "manual" ? "" : "待补位"))}</td><td>${escapeHtml(combinedAssignmentRemark(item.remark, item.manualRemark))}</td></tr>`).join("")}</tbody></table></section>`).join("")}</main>
    <section class="people"><h2>人员排班一览</h2><table><thead><tr><th>人员</th><th>航班与岗位</th><th>工作时段</th><th>合计工时</th></tr></thead><tbody>${people.map(({ name, items }) => `<tr><td class="person-name">${escapeHtml(name)}</td><td>${items.map((item) => `${escapeHtml(item.flightNo)} / ${escapeHtml(item.position)}`).join("<br>")}</td><td>${items.map((item) => `${escapeHtml(item.startTime)}–${escapeHtml(item.endTime)}`).join("<br>")}</td><td>${items.reduce((sum, item) => sum + item.workHours, 0).toFixed(1)}h</td></tr>`).join("")}</tbody></table></section>
    <footer class="footer"><span>自动排班</span><span>生成时间 ${escapeHtml(new Date().toLocaleString("zh-CN", { hour12: false }))}</span></footer>
  </div>`;
}

export function buildShareDocument(state: AppState, date: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(date)} 国际航班保障排班</title><style>${shareStyles}</style></head><body>${buildShareMarkup(state, date)}</body></html>`;
}

export function exportShareHtml(state: AppState, date: string): void {
  downloadBlob(new Blob([buildShareDocument(state, date)], { type: "text/html;charset=utf-8" }), `国际航班保障排班_${date}.html`);
}

export async function exportSharePng(state: AppState, date: string): Promise<void> {
  const { default: html2canvas } = await import("html2canvas");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:1400px;background:#fff;z-index:-1";
  host.innerHTML = `<style>${shareStyles}</style>${buildShareMarkup(state, date)}`;
  document.body.append(host);
  try {
    const sheet = host.querySelector<HTMLElement>("#share-sheet");
    if (!sheet) throw new Error("无法生成分享排班页");
    const canvas = await html2canvas(sheet, { backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("浏览器无法生成 PNG 文件");
    downloadBlob(blob, `国际航班保障排班_${date}.png`);
  } finally {
    host.remove();
  }
}
