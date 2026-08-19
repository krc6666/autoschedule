import type { AppState, Assignment } from "../model";
import { assignmentWarningRemark, downloadBlob } from "../utils";

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

function groupedByStaff(
  assignments: readonly Assignment[]
): Array<{ name: string; items: Assignment[] }> {
  const groups = new Map<string, Assignment[]>();
  for (const item of assignments.filter((assignment) => assignment.staffId)) {
    groups.set(item.staffName, [...(groups.get(item.staffName) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({
      name,
      items: items.sort((left, right) =>
        left.startTime.localeCompare(right.startTime)
      ),
    }))
    .sort(
      (left, right) =>
        left.items[0]!.startTime.localeCompare(right.items[0]!.startTime) ||
        left.name.localeCompare(right.name, "zh-CN")
    );
}

function node<K extends keyof HTMLElementTagNameMap>(
  owner: Document,
  tagName: K,
  options: { className?: string; text?: string } = {}
): HTMLElementTagNameMap[K] {
  const element = owner.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  return element;
}

function tableHeader(
  owner: Document,
  labels: readonly string[]
): HTMLTableSectionElement {
  const head = node(owner, "thead");
  const row = node(owner, "tr");
  labels.forEach((label) => row.append(node(owner, "th", { text: label })));
  head.append(row);
  return head;
}

function textCell(
  owner: Document,
  value: string,
  className = ""
): HTMLTableCellElement {
  return node(owner, "td", { className, text: value });
}

function lineCell(
  owner: Document,
  values: readonly string[]
): HTMLTableCellElement {
  const cell = node(owner, "td");
  values.forEach((value, index) => {
    if (index) cell.append(node(owner, "br"));
    cell.append(owner.createTextNode(value));
  });
  return cell;
}

function flightSection(
  owner: Document,
  state: AppState,
  flight: AppState["flights"][number]
): HTMLElement {
  const section = node(owner, "section", { className: "flight" });
  const heading = node(owner, "div", { className: "flight-title" });
  heading.append(
    node(owner, "strong", { text: flight.flightNo }),
    node(owner, "span", {
      text: `${flight.startTime}-${flight.endTime} · ${flight.remark}`,
    })
  );
  const table = node(owner, "table");
  const body = node(owner, "tbody");
  state.assignments
    .filter((assignment) => assignment.flightId === flight.id)
    .forEach((assignment) => {
      const row = node(owner, "tr");
      const staffName =
        assignment.staffName ||
        (assignment.status === "manual" ? "" : "待补位");
      row.append(
        textCell(owner, assignment.position),
        textCell(
          owner,
          staffName,
          assignment.staffName || assignment.status === "manual"
            ? ""
            : "unfilled"
        ),
        textCell(
          owner,
          assignmentWarningRemark(
            assignment.remark,
            assignment.manualRemark,
            assignment.manualOverrideWarnings
          )
        )
      );
      body.append(row);
    });
  table.append(tableHeader(owner, ["岗位", "保障人员", "备注"]), body);
  section.append(heading, table);
  return section;
}

function peopleSection(
  owner: Document,
  assignments: readonly Assignment[]
): HTMLElement {
  const section = node(owner, "section", { className: "people" });
  const table = node(owner, "table");
  const body = node(owner, "tbody");
  groupedByStaff(assignments).forEach(({ name, items }) => {
    const row = node(owner, "tr");
    row.append(
      textCell(owner, name, "person-name"),
      lineCell(
        owner,
        items.map((item) => `${item.flightNo} / ${item.position}`)
      ),
      lineCell(
        owner,
        items.map((item) => `${item.startTime}-${item.endTime}`)
      ),
      textCell(
        owner,
        `${items.reduce((sum, item) => sum + item.workHours, 0).toFixed(1)}h`
      )
    );
    body.append(row);
  });
  section.append(node(owner, "h2", { text: "人员排班一览" }), table);
  table.append(
    tableHeader(owner, ["人员", "航班与岗位", "工作时段", "合计工时"]),
    body
  );
  return section;
}

export function buildShareSheet(
  state: AppState,
  date: string,
  owner: Document = document,
  generatedAt = new Date()
): HTMLElement {
  const assignedCount = state.assignments.filter(
    (item) => item.status === "assigned"
  ).length;
  const unfilledCount = state.assignments.filter(
    (item) => item.status === "unfilled"
  ).length;
  const sheet = node(owner, "div", { className: "share-page" });
  sheet.id = "share-sheet";
  const heading = node(owner, "header", { className: "share-head" });
  const title = node(owner, "div");
  title.append(
    node(owner, "h1", { text: "国际航班保障排班" }),
    node(owner, "div", { className: "date", text: date })
  );
  const incomplete = unfilledCount ? ` · ${unfilledCount} 个待补位` : "";
  heading.append(
    title,
    node(owner, "div", {
      className: "meta",
      text: `${state.flights.length} 个航班 · ${assignedCount} 个岗位已排${incomplete}`,
    })
  );
  const flights = node(owner, "main", { className: "flight-grid" });
  state.flights.forEach((flight) =>
    flights.append(flightSection(owner, state, flight))
  );
  const footer = node(owner, "footer", { className: "footer" });
  footer.append(
    node(owner, "span", { text: "自动排班" }),
    node(owner, "span", {
      text: `生成时间 ${generatedAt.toLocaleString("zh-CN", { hour12: false })}`,
    })
  );
  sheet.append(
    heading,
    flights,
    peopleSection(owner, state.assignments),
    footer
  );
  return sheet;
}

export function buildShareDocument(state: AppState, date: string): string {
  const output = document.implementation.createHTMLDocument(
    `${date} 国际航班保障排班`
  );
  output.documentElement.lang = "zh-CN";
  output.head.replaceChildren();
  const charset = node(output, "meta");
  charset.setAttribute("charset", "UTF-8");
  const viewport = node(output, "meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width,initial-scale=1";
  const title = node(output, "title", { text: `${date} 国际航班保障排班` });
  const style = node(output, "style", { text: shareStyles });
  output.head.append(charset, viewport, title, style);
  output.body.replaceChildren(buildShareSheet(state, date, output));
  return new XMLSerializer().serializeToString(output);
}

export function exportShareHtml(state: AppState, date: string): void {
  downloadBlob(
    new Blob([buildShareDocument(state, date)], {
      type: "text/html;charset=utf-8",
    }),
    `国际航班保障排班_${date}.html`
  );
}

export async function exportSharePng(
  state: AppState,
  date: string
): Promise<void> {
  const { default: html2canvas } = await import("html2canvas");
  const host = node(document, "div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;width:1400px;background:#fff;z-index:-1";
  host.append(
    node(document, "style", { text: shareStyles }),
    buildShareSheet(state, date)
  );
  document.body.append(host);
  try {
    const sheet = host.querySelector<HTMLElement>("#share-sheet");
    if (!sheet) throw new Error("无法生成分享排班页");
    const canvas = await html2canvas(sheet, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("浏览器无法生成 PNG 文件");
    downloadBlob(blob, `国际航班保障排班_${date}.png`);
  } finally {
    host.remove();
  }
}
