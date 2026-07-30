import type { AppState } from "../model";
import {
  SCHEDULING_RULES,
  SCHEDULING_STAGE_LABELS,
  SCHEDULING_STAGE_ORDER,
  type SchedulingRuleId,
} from "../schedule-rule-contract";
import { escapeHtml } from "../utils";
import {
  DENSE_CAPACITY_UTILIZATION,
  DENSE_PEAK_STAFFING_RATIO,
  WORKLOAD_BALANCE_MIN_FLIGHTS,
} from "../domain/workload-balance";

function policyState(enabled: boolean): string {
  return enabled ? "已启用 · 优先避开" : "已停用";
}

function transitionPolicyCards(state: AppState): string {
  return state.settings.positionTransitionPolicies
    .map(
      (policy) => `
    <details class="policy-rule-card policy-transition-card" data-policy-card="${escapeHtml(policy.id)}">
      <summary><span><strong>${escapeHtml(policy.name)}</strong><small>${policy.enabled ? (policy.mode === "forbid" ? "已启用 · 严格限制" : "已启用 · 优先避开") : "已停用"}</small></span><i class="bi bi-chevron-down"></i></summary>
      <div class="policy-rule-content">
        <div class="transition-policy-grid">
          <label class="form-label">规则名称<input class="form-control form-control-sm" value="${escapeHtml(policy.name)}" data-entity="transition-policy" data-id="${escapeHtml(policy.id)}" data-field="name"></label>
          <label class="policy-switch"><span><strong>启用规则</strong><small>参与下一次自动排班</small></span><span class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" ${policy.enabled ? "checked" : ""} data-entity="transition-policy" data-id="${escapeHtml(policy.id)}" data-field="enabled" aria-label="启用规则"></span></label>
          <label class="form-label">前序航班<input class="form-control form-control-sm code-input" value="${escapeHtml(policy.sourceFlightNo)}" data-entity="transition-policy" data-id="${escapeHtml(policy.id)}" data-field="sourceFlightNo"></label>
          <label class="form-label">前序晚撤岗位<input class="form-control form-control-sm" value="${escapeHtml(policy.sourcePositions.join(", "))}" data-entity="transition-policy" data-id="${escapeHtml(policy.id)}" data-field="sourcePositions"></label>
          <label class="form-label">目标航班<input class="form-control form-control-sm code-input" value="${escapeHtml(policy.targetFlightNo)}" data-entity="transition-policy" data-id="${escapeHtml(policy.id)}" data-field="targetFlightNo"></label>
          <label class="form-label">目标岗位<input class="form-control form-control-sm" value="${escapeHtml(policy.targetPosition)}" data-entity="transition-policy" data-id="${escapeHtml(policy.id)}" data-field="targetPosition"></label>
          <label class="form-label">最小间隔（分钟）<input class="form-control form-control-sm" type="number" min="0" max="1440" step="15" value="${policy.minimumGapMinutes}" data-entity="transition-policy" data-id="${escapeHtml(policy.id)}" data-field="minimumGapMinutes"></label>
          <label class="form-label">执行强度<select class="form-select form-select-sm" data-entity="transition-policy" data-id="${escapeHtml(policy.id)}" data-field="mode"><option value="prefer" ${policy.mode === "prefer" ? "selected" : ""}>优先避开</option><option value="forbid" ${policy.mode === "forbid" ? "selected" : ""}>严格限制</option></select></label>
        </div>
        <div class="d-flex justify-content-end"><button class="btn btn-sm btn-outline-danger" type="button" data-action="delete-transition-policy" data-id="${escapeHtml(policy.id)}"><i class="bi bi-trash3 me-1"></i>删除规则</button></div>
      </div>
    </details>`
    )
    .join("");
}

function dutyPriorityRows(state: AppState): string {
  return state.settings.dutyPositionPriorities
    .map(
      (priority, index) => `
    <div class="duty-priority-row">
      <span class="duty-priority-order">${index + 1}</span>
      <label class="form-label">航班号<input class="form-control form-control-sm code-input" value="${escapeHtml(priority.flightNo)}" data-entity="duty-priority" data-id="${escapeHtml(priority.id)}" data-field="flightNo"></label>
      <label class="form-label">岗位或备注关键词<input class="form-control form-control-sm" value="${escapeHtml(priority.positionKeyword)}" data-entity="duty-priority" data-id="${escapeHtml(priority.id)}" data-field="positionKeyword"></label>
      <label class="form-check form-switch duty-priority-switch"><input class="form-check-input" type="checkbox" ${priority.enabled ? "checked" : ""} data-entity="duty-priority" data-id="${escapeHtml(priority.id)}" data-field="enabled"><span class="form-check-label">启用</span></label>
      <div class="duty-priority-actions"><button class="btn btn-sm icon-btn" type="button" data-action="move-duty-priority-up" data-id="${escapeHtml(priority.id)}" title="提高优先级" ${index === 0 ? "disabled" : ""}><i class="bi bi-arrow-up"></i></button><button class="btn btn-sm icon-btn" type="button" data-action="move-duty-priority-down" data-id="${escapeHtml(priority.id)}" title="降低优先级" ${index === state.settings.dutyPositionPriorities.length - 1 ? "disabled" : ""}><i class="bi bi-arrow-down"></i></button><button class="btn btn-sm icon-btn text-danger" type="button" data-action="delete-duty-priority" data-id="${escapeHtml(priority.id)}" title="删除优先项"><i class="bi bi-trash3"></i></button></div>
    </div>`
    )
    .join("");
}

function nextWorkdayRecoveryTargetRows(state: AppState): string {
  return state.settings.nextWorkdayRecoveryTargets
    .map(
      (target) => `
    <div class="duty-priority-row">
      <label class="form-check form-switch duty-priority-switch"><input class="form-check-input" type="checkbox" ${target.enabled ? "checked" : ""} data-entity="recovery-target" data-id="${escapeHtml(target.id)}" data-field="enabled"><span class="form-check-label">启用</span></label>
      <label class="form-label">目标航班<input class="form-control form-control-sm code-input" value="${escapeHtml(target.flightNo)}" placeholder="例如：CX937" data-entity="recovery-target" data-id="${escapeHtml(target.id)}" data-field="flightNo"></label>
      <label class="form-label">岗位或备注关键词<input class="form-control form-control-sm" value="${escapeHtml(target.positionKeyword)}" placeholder="例如：一号" data-entity="recovery-target" data-id="${escapeHtml(target.id)}" data-field="positionKeyword"></label>
      <div class="duty-priority-actions"><button class="btn btn-sm icon-btn text-danger" type="button" data-action="delete-recovery-target" data-id="${escapeHtml(target.id)}" title="删除避让目标"><i class="bi bi-trash3"></i></button></div>
    </div>`
    )
    .join("");
}

function lateShiftRecoveryPositionRows(state: AppState): string {
  return state.settings.lateShiftRecoveryPositionRules
    .map(
      (rule) => `
    <div class="supervisor-coverage-row">
      <label class="form-check form-switch supervisor-coverage-switch"><input class="form-check-input" type="checkbox" ${rule.enabled ? "checked" : ""} data-entity="late-shift-recovery-position" data-id="${escapeHtml(rule.id)}" data-field="enabled"><span class="form-check-label">启用</span></label>
      <label class="form-label">适用航班<input class="form-control form-control-sm code-input" value="${escapeHtml(rule.flightNo)}" placeholder="留空=全部航班" data-entity="late-shift-recovery-position" data-id="${escapeHtml(rule.id)}" data-field="flightNo"></label>
      <label class="form-label">匹配位置<select class="form-select form-select-sm" data-entity="late-shift-recovery-position" data-id="${escapeHtml(rule.id)}" data-field="matchField"><option value="position" ${rule.matchField === "position" ? "selected" : ""}>岗位名称</option><option value="remark" ${rule.matchField === "remark" ? "selected" : ""}>岗位备注</option></select></label>
      <label class="form-label">关键词<input class="form-control form-control-sm" value="${escapeHtml(rule.keyword)}" placeholder="例如：送资料" data-entity="late-shift-recovery-position" data-id="${escapeHtml(rule.id)}" data-field="keyword"></label>
      <label class="form-label">次班截止时间<input class="form-control form-control-sm" type="time" value="${escapeHtml(rule.nextWorkdayCutoffTime)}" data-entity="late-shift-recovery-position" data-id="${escapeHtml(rule.id)}" data-field="nextWorkdayCutoffTime"><small>留空=不限制</small></label>
      <button class="btn btn-sm icon-btn text-danger" type="button" data-action="delete-late-shift-recovery-position" data-id="${escapeHtml(rule.id)}" title="删除末班重点岗位规则"><i class="bi bi-trash3"></i></button>
    </div>`
    )
    .join("");
}

function supervisorCoverageRows(state: AppState): string {
  return state.settings.mobileSupervisorCoverageRules
    .map(
      (rule) => `
    <div class="supervisor-coverage-row">
      <label class="form-check form-switch supervisor-coverage-switch"><input class="form-check-input" type="checkbox" ${rule.enabled ? "checked" : ""} data-entity="supervisor-coverage" data-id="${escapeHtml(rule.id)}" data-field="enabled"><span class="form-check-label">启用</span></label>
      <label class="form-label">适用航班<input class="form-control form-control-sm code-input" value="${escapeHtml(rule.flightNo)}" placeholder="留空=全部航班" data-entity="supervisor-coverage" data-id="${escapeHtml(rule.id)}" data-field="flightNo"></label>
      <label class="form-label">匹配位置<select class="form-select form-select-sm" data-entity="supervisor-coverage" data-id="${escapeHtml(rule.id)}" data-field="matchField"><option value="position" ${rule.matchField === "position" ? "selected" : ""}>岗位名称</option><option value="remark" ${rule.matchField === "remark" ? "selected" : ""}>岗位备注</option></select></label>
      <label class="form-label">关键词<input class="form-control form-control-sm" value="${escapeHtml(rule.keyword)}" placeholder="例如：一号" data-entity="supervisor-coverage" data-id="${escapeHtml(rule.id)}" data-field="keyword"></label>
      <label class="form-label">处理方式<select class="form-select form-select-sm" data-entity="supervisor-coverage" data-id="${escapeHtml(rule.id)}" data-field="mode"><option value="forbid" ${rule.mode === "forbid" ? "selected" : ""}>禁止兼任</option><option value="allow" ${rule.mode === "allow" ? "selected" : ""}>允许兼任</option></select></label>
      <button class="btn btn-sm icon-btn text-danger" type="button" data-action="delete-supervisor-coverage" data-id="${escapeHtml(rule.id)}" title="删除兼任规则"><i class="bi bi-trash3"></i></button>
    </div>`
    )
    .join("");
}

function ruleLedgerRows(state: AppState): string {
  const stageOrder = SCHEDULING_STAGE_ORDER.map(
    (stage) => SCHEDULING_STAGE_LABELS[stage]
  ).join(" → ");
  const descriptions: Readonly<Record<SchedulingRuleId, string>> = {
    "staff-eligibility": `岗位资质硬约束；状态变化后立即重新计算当前排班；依次检查正常状态、岗位资质、${state.settings.nightStart}-${state.settings.nightEnd} 夜班能力、时段冲突和每日 ${state.settings.maxDailyHours} 小时上限`,
    "duty-position": `最终保留12点前上午航班；${state.settings.dutyPositionPriorities.filter((item) => item.enabled).length} 个晚撤优先项按顺序逐项启用，值班疲劳 ${state.settings.dutyFatiguePoints} 点`,
    "ke166-supervisor":
      "KE166先完成柜台安排与重点岗位轮换，再优先安排不占柜台的独立督导；只有没有独立人选、否则会出现岗位空缺时，才允许合格柜台人员兼任",
    "scarce-qualification":
      "12点前岗位完整性执行12点前单岗位稀缺优先：先处理可胜任人数较少的岗位，并只为确实不可替代的后续任务预留人员",
    "staff-coverage":
      "岗位与资质允许时，优先覆盖当天仍为 0 实际工时的正常常规人员",
    "position-compaction":
      "常规岗位空缺下沉：保持已填岗位数不下降，把无法避免的空缺尽量沉到岗位列表底部",
    "team-leader-concurrent-supervision": `仅在存在常规岗位空缺时，允许合格分队长并行承担两个督导；按航班原始保障时段判断，最大重叠 ${state.settings.teamLeaderConcurrentSupervisionMaxOverlapMinutes} 分钟`,
    "position-transition": `${state.settings.positionTransitionPolicies.filter((item) => item.enabled && item.mode === "forbid").length} 条严格限制；12点后阻止违规落位，12点前无人替代时可突破严格限制并反馈留痕`,
    "next-duty-rest": state.settings.nextDutyRestProtectionEnabled
      ? "提前读取下个工作班值班人员，本班优先避开全部重点岗位；无安全替代时保证岗位完整"
      : "已停用",
    "late-shift-recovery": state.settings.lateShiftRecoveryEnabled
      ? `保护上一班末班重点岗位人员；${state.settings.lateShiftRecoveryPositionRules.filter((item) => item.enabled).length} 条重点岗位规则，避开 ${state.settings.nextWorkdayRecoveryTargets.filter((item) => item.enabled).length} 个早班目标`
      : "已停用",
    "late-shift-cutoff": state.settings.lateShiftRecoveryEnabled
      ? `按每条末班重点岗位规则的可选截止时间，优先让受保护人员在次班更早下班；时间留空时不执行截止保护`
      : "已停用",
    "priority-position-consecutive": state.settings.positionRotationEnabled
      ? "重点岗位在生成阶段即检查上一工作班的同一航班同一岗位；存在安全替代时不得连续第二班承担"
      : "已停用",
    "high-fatigue-position-consecutive": state.settings.positionRotationEnabled
      ? `常规岗位疲劳点达到 ${state.settings.highLoadFatigueThreshold} 时，生成阶段即避免同一人员连续第二班承担；完整排班后继续安全重排`
      : "已停用",
    "same-day-late-obligation":
      "重点岗位存在多个安全人选时，优先避开当天后续晚班的不可替代人员，减少较早重点岗位与晚班集中在同一人",
    "preferred-position-transition": `${state.settings.positionTransitionPolicies.filter((item) => item.enabled && item.mode === "prefer").length} 条优先衔接规则；在跨工作日恢复之后比较`,
    "rolling-load": state.settings.rollingLoadProtectionEnabled
      ? `${state.settings.rollingLoadWindowMinutes} 分钟内累计疲劳超过 ${state.settings.rollingLoadMaxFatigue} 点时优先换人`
      : "已停用",
    "high-load-recovery": state.settings.highLoadProtectionEnabled
      ? `疲劳点不少于 ${state.settings.highLoadFatigueThreshold} 或带备注时，保护 ${state.settings.highLoadRecoveryMinutes} 分钟恢复时间`
      : "已停用",
    "cross-workday-load":
      "按上一工作班疲劳点、最晚下班、总工时和重点岗位数量逐项比较；上一班负荷较轻者优先承担本班较重任务",
    "position-frequency": state.settings.positionRotationEnabled
      ? "重点岗位先比较本月同航班同岗位累计，再比较最近6个归档工作日"
      : "已停用",
    "position-frequency-review": state.settings.positionRotationEnabled
      ? "完整排班后按直接接替、两人交换、最多三人安全重排再次降低重点岗位高频"
      : "已停用",
    "workload-balance": state.settings.workloadBalanceEnabled
      ? `至少 ${WORKLOAD_BALANCE_MIN_FLIGHTS} 个航班且压力不宽松时，比较投放后的工时与疲劳差；行政支援岗位和人员完全不计负荷`
      : "已停用",
    "historical-fatigue": `比较最近 ${state.settings.historyWindowDays} 天历史疲劳、当日岗位疲劳和值班疲劳`,
    "staff-id": "前序规则全部相同时，按人员配置顺序稳定选择",
    "position-rotation": state.settings.positionRotationEnabled
      ? `分级连续轮岗：重点岗位和疲劳点达到 ${state.settings.highLoadFatigueThreshold} 的高负荷普通岗位上一班重复即复核；低疲劳普通岗位只在即将连续第三班时复核；末班重点岗位先彻底退出晚班，无解时才接受疲劳点严格下降的普通岗位，随后比较参与人数最少与负荷公平`
      : "已停用",
  };
  const adjustments: Readonly<Record<SchedulingRuleId, string>> = {
    "staff-eligibility": "人员信息 / 岗位规则 / 排班约束",
    "duty-position": "规则 / 值班任务规则",
    "ke166-supervisor": "岗位分类 / 机动督导兼任范围",
    "scarce-qualification": "岗位资质",
    "staff-coverage": "人员状态 / 岗位资质",
    "position-compaction": "岗位顺序 / 岗位资质",
    "team-leader-concurrent-supervision": "规则 / 分队长并行督导补缺",
    "position-transition": "规则 / 岗位衔接间隔",
    "next-duty-rest": "规则 / 下班次值班人员预休",
    "late-shift-recovery": "规则 / 跨工作日恢复保护",
    "late-shift-cutoff": "规则 / 跨工作日恢复保护 / 次班截止时间",
    "priority-position-consecutive": "规则 / 重点岗位频率与轮岗",
    "high-fatigue-position-consecutive":
      "规则 / 高负荷岗位衔接保护 / 重点岗位频率与轮岗",
    "same-day-late-obligation": "规则 / 当天早晚负荷分散",
    "preferred-position-transition": "规则 / 岗位衔接间隔",
    "rolling-load": "规则 / 滚动负荷上限",
    "high-load-recovery": "规则 / 高负荷岗位衔接保护",
    "cross-workday-load": "规则 / 跨工作班动态负荷互补",
    "position-frequency": "规则 / 历史",
    "position-frequency-review": "规则 / 历史",
    "workload-balance": "规则 / 当日工时与疲劳均衡",
    "historical-fatigue": "排班约束 / 历史",
    "staff-id": "人员配置顺序",
    "position-rotation": "规则 / 历史",
  };
  const rows = [
    [
      "执行顺序",
      "总合同",
      "分阶段顺序判定",
      stageOrder,
      "中央规则合同；前一阶段完成后才进入下一阶段",
    ],
    ...SCHEDULING_RULES.map((rule) => [
      rule.id,
      SCHEDULING_STAGE_LABELS[rule.stage],
      rule.label,
      descriptions[rule.id],
      adjustments[rule.id],
    ]),
    [
      "product-admin-support",
      "岗位生成",
      "行政支援替换",
      "行政模式下同航班同名行政岗位替换常规岗位并留空；行政支援岗位和人员不计工时、疲劳及负荷",
      "岗位分类 / 行政模式",
    ],
    [
      "product-passenger-threshold",
      "岗位生成",
      "运力阈值",
      "低于启用旅客人数时岗位保留；12点前常规岗位仍自动派人",
      "岗位规则 / 启用旅客人数",
    ],
    [
      "product-duty-roster",
      "月度轮值",
      "值班、CX航前与备勤",
      "按值班、CX航前、备勤的固定顺序生成并执行互斥与均衡",
      "排班页轮值表",
    ],
    [
      "product-role-reuse",
      "岗位调整",
      "引导复用与机动督导兼任",
      `引导复用同航班常规人员；自动兼任和人工拖拽统一执行 ${state.settings.mobileSupervisorCoverageRules.filter((item) => item.enabled).length} 条兼任范围规则`,
      "规则 / 机动督导兼任范围",
    ],
    [
      "product-diversion",
      "岗位衔接",
      "分流提前撤岗",
      "下午及晚间按岗位提前撤岗分钟释放人员，早班不适用",
      "岗位规则 / 提前撤岗",
    ],
    [
      "product-relaxed-shift",
      "月度统计",
      "轻松班次统计",
      `最后航班截载严格早于 ${state.settings.earlyDepartureCutoffTime} 计提前下班；${state.settings.afternoonRestStartTime}-${state.settings.afternoonRestEndTime} 无航班重叠计下午无航班`,
      "规则 / 排班结果",
    ],
  ];
  return rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`
    )
    .join("");
}

export function renderSchedulePolicy(state: AppState): string {
  return `
    <section class="workspace-section schedule-policy-section">
      <div class="section-heading"><div><h3>排班规则</h3><span>${state.settings.positionTransitionPolicies.length + 13} 条可编辑规则 · 点击规则可展开编辑</span></div><button class="btn btn-primary" type="button" data-action="save-schedule-policy"><i class="bi bi-check2-circle me-2"></i>保存规则</button></div>
      <label class="policy-search"><i class="bi bi-search"></i><input class="form-control" id="policy-rule-search" type="search" placeholder="搜索编号、规则、航班、岗位或说明" aria-label="搜索排班规则"><button class="btn icon-btn" type="button" data-action="clear-policy-search" title="清空搜索"><i class="bi bi-x-lg"></i></button></label>

      <details class="policy-rule-card" data-policy-card="workload-balance">
        <summary><span><strong>当日工时与疲劳均衡</strong><small>${state.settings.workloadBalanceEnabled ? "已启用" : "已停用"} · 同时控制两个差值</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls policy-controls-three">
            <label class="policy-switch"><span><strong>启用规则</strong><small>优先安排当日负荷较轻的合格人员</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-workload-balance-enabled" type="checkbox" ${state.settings.workloadBalanceEnabled ? "checked" : ""}></span></label>
            <label class="form-label">最大工时差（小时）<input class="form-control" id="policy-max-work-hours-difference" type="number" min="0" max="24" step="0.5" value="${state.settings.maxWorkHoursDifference}"></label>
            <label class="form-label">最大当日疲劳差<input class="form-control" id="policy-max-today-fatigue-difference" type="number" min="0" max="100" step="0.5" value="${state.settings.maxTodayFatigueDifference}"></label>
          </div>
          <div class="policy-expression"><span>目标</span><strong>工时差 ≤ ${state.settings.maxWorkHoursDifference} 小时</strong><i class="bi bi-plus-lg"></i><strong>当日疲劳差 ≤ ${state.settings.maxTodayFatigueDifference} 点</strong><i class="bi bi-arrow-right"></i><span>资质和时段允许时优先补低负荷人员</span></div>
          <small class="text-secondary d-block mt-2">固定触发边界：至少 ${WORKLOAD_BALANCE_MIN_FLIGHTS} 个航班；并发岗位/合格常规人员达到 ${Math.round(DENSE_PEAK_STAFFING_RATIO * 100)}% 或计划工时利用率达到 ${Math.round(DENSE_CAPACITY_UTILIZATION * 100)}% 时判定为密集。行政支援岗位和行政支援人员不计入负荷。</small>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="duty-rules">
        <summary><span><strong>值班任务规则</strong><small>12点前上午航班 + 有序岗位优先 + 晚撤回退 · 当前 ${state.settings.dutyFatiguePoints} 疲劳点</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls policy-controls-three">
            <label class="form-label">每次值班疲劳点<input class="form-control" id="policy-duty-fatigue-points" type="number" min="0" max="50" step="0.5" value="${state.settings.dutyFatiguePoints}"></label>
            <div class="policy-switch"><span><strong>12点前上午航班</strong><small>值班人员必须承担一班开始时间严格早于12:00的航班；轮岗可移动具体岗位，但最终结果必须保留上午航班</small></span><i class="bi bi-sunrise"></i></div>
            <div class="policy-switch"><span><strong>指定晚撤岗位</strong><small>最晚或倒数第二晚的一号、督导、申报、送资料</small></span><i class="bi bi-moon-stars"></i></div>
          </div>
          <div class="d-flex align-items-center justify-content-between gap-2"><strong class="small">值班岗位优先顺序</strong><button class="btn btn-sm btn-outline-secondary" type="button" data-action="add-duty-priority"><i class="bi bi-plus-lg me-1"></i>新增优先项</button></div>
          <div class="duty-priority-list">${dutyPriorityRows(state) || `<div class="empty-state">尚未配置优先项，将直接使用晚撤回退规则</div>`}</div>
          <div class="policy-expression"><span>执行</span><strong>先保证最终班表保留12点前上午航班</strong><i class="bi bi-arrow-right"></i><strong>依次尝试启用的航班/岗位优先项</strong><i class="bi bi-arrow-right"></i><span>每次只启用一个晚撤候选，失败后才尝试下一项</span></div>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="next-duty-rest">
        <summary><span><strong>下班次值班人员预休</strong><small>${policyState(state.settings.nextDutyRestProtectionEnabled)} · 本班避开全部重点岗位</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="policy-switch"><span><strong>启用规则</strong><small>提前保护下个工作班的值班人员</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-next-duty-rest-enabled" type="checkbox" ${state.settings.nextDutyRestProtectionEnabled ? "checked" : ""}></span></label>
          </div>
          <div class="policy-expression"><span>本班</span><strong>读取后天值班人员</strong><i class="bi bi-arrow-right"></i><strong>避开一号、申报、督导、控制、送资料及KE166机动督导</strong><i class="bi bi-arrow-right"></i><span>无安全替代时保证岗位完整并反馈</span></div>
          <small class="text-secondary d-block mt-2">本班值班岗位、KE166机动督导、唯一合格人员和岗位完整性优先；重点岗位频率、当日在岗覆盖及工时疲劳均衡排在本规则之后。</small>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="team-leader-concurrent-supervision">
        <summary><span><strong>分队长并行督导补缺</strong><small>仅为补齐常规岗位空缺 · 最大重叠 ${state.settings.teamLeaderConcurrentSupervisionMaxOverlapMinutes} 分钟</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="form-label">最大允许重叠（分钟）<input class="form-control" id="policy-team-leader-concurrent-overlap" type="number" min="0" max="720" step="5" value="${state.settings.teamLeaderConcurrentSupervisionMaxOverlapMinutes}"></label>
          </div>
          <div class="policy-expression"><span>触发</span><strong>正常排班仍有常规岗位空缺</strong><i class="bi bi-arrow-right"></i><strong>分队长具备两个督导资质且原始保障时段重叠不超过设定值</strong><i class="bi bi-arrow-right"></i><span>安全重排并补齐空缺</span></div>
          <small class="text-secondary d-block mt-2">0 表示不允许并行督导。重叠按两个航班的原始保障开始、结束时间计算，不受分流提前撤岗影响；只允许同时承担两个督导，工时按时段并集计算，疲劳分别累计。补缺最多安全重排 3 名常规人员，每一步只传递一个空位，同一人员和岗位不重复进入一条重排链。值班锁定、KE166、人工岗位、恢复保护、资质和工时上限仍优先。</small>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="supervisor-coverage">
        <summary><span><strong>机动督导兼任范围</strong><small>${state.settings.mobileSupervisorCoverageRules.filter((item) => item.enabled && item.mode === "forbid").length} 条禁止 · ${state.settings.mobileSupervisorCoverageRules.filter((item) => item.enabled && item.mode === "allow").length} 条允许</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="d-flex align-items-center justify-content-between gap-2"><div><strong class="small">自动排班与人工拖拽共用</strong><div class="small text-secondary">航班留空表示全部航班；禁止规则优先。某航班存在允许规则时，未命中允许项的岗位也不能兼任。</div></div><button class="btn btn-sm btn-outline-secondary" type="button" data-action="add-supervisor-coverage"><i class="bi bi-plus-lg me-1"></i>新增规则</button></div>
          <div class="supervisor-coverage-list">${supervisorCoverageRows(state) || `<div class="empty-state">尚未配置限制，机动督导可兼任同航班任意空白非督导岗位</div>`}</div>
          <div class="policy-expression"><span>默认禁止</span><strong>岗位备注包含“一号、申报、排查”</strong><i class="bi bi-arrow-right"></i><span>KE166 自动兼任、空缺重排和人工拖拽均不可绕过</span></div>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="relaxed-shift-statistics">
        <summary><span><strong>月度轻松班次统计</strong><small>提前下班 + 下午无航班 · 按自然月累计</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls policy-controls-three">
            <label class="form-label">提前下班截载节点<input class="form-control" id="policy-early-departure-cutoff" type="time" value="${escapeHtml(state.settings.earlyDepartureCutoffTime)}"></label>
            <label class="form-label">下午统计开始<input class="form-control" id="policy-afternoon-rest-start" type="time" value="${escapeHtml(state.settings.afternoonRestStartTime)}"></label>
            <label class="form-label">下午统计结束<input class="form-control" id="policy-afternoon-rest-end" type="time" value="${escapeHtml(state.settings.afternoonRestEndTime)}"></label>
          </div>
          <div class="policy-expression"><span>提前下班</span><strong>最后实际航班截载严格早于 ${state.settings.earlyDepartureCutoffTime}</strong><span>当日值班人员排除，备勤照常统计</span><i class="bi bi-dot"></i><span>下午无航班</span><strong>${state.settings.afternoonRestStartTime}-${state.settings.afternoonRestEndTime} 无航班重叠</strong><span>值班、备勤均照常统计</span></div>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="high-load">
        <summary><span><strong>高负荷岗位衔接保护</strong><small>${policyState(state.settings.highLoadProtectionEnabled)} · 同日恢复保护</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="policy-switch"><span><strong>启用规则</strong><small>保护高负荷任务后的恢复时间</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-enabled" type="checkbox" ${state.settings.highLoadProtectionEnabled ? "checked" : ""}></span></label>
            <label class="form-label">高负荷疲劳阈值<input class="form-control" id="policy-fatigue-threshold" type="number" min="0.5" max="50" step="0.5" value="${state.settings.highLoadFatigueThreshold}"></label>
            <label class="form-label">恢复时间（分钟）<input class="form-control" id="policy-recovery-minutes" type="number" min="0" max="1440" step="30" value="${state.settings.highLoadRecoveryMinutes}"></label>
            <label class="policy-switch"><span><strong>备注岗位视为高负荷</strong><small>一号、申报、控制等备注均参与判定</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-remarked-high-load" type="checkbox" ${state.settings.remarkedPositionHighLoad ? "checked" : ""}></span></label>
          </div>
          <div class="policy-expression"><span>判定</span><strong>岗位有备注或疲劳点 ≥ ${state.settings.highLoadFatigueThreshold}</strong><i class="bi bi-arrow-right"></i><span>${state.settings.highLoadRecoveryMinutes} 分钟内</span><strong>优先避开，无安全替代时保证岗位完整</strong></div>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="rolling-load">
        <summary><span><strong>滚动负荷上限</strong><small>${policyState(state.settings.rollingLoadProtectionEnabled)} · 限制连续堆高疲劳</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="policy-switch"><span><strong>启用规则</strong><small>仅在投放高负荷岗位时触发</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-rolling-load-enabled" type="checkbox" ${state.settings.rollingLoadProtectionEnabled ? "checked" : ""}></span></label>
            <label class="form-label">滚动窗口（分钟）<input class="form-control" id="policy-rolling-window-minutes" type="number" min="0" max="1440" step="30" value="${state.settings.rollingLoadWindowMinutes}"></label>
            <label class="form-label">累计疲劳上限<input class="form-control" id="policy-rolling-max-fatigue" type="number" min="0.5" max="100" step="0.5" value="${state.settings.rollingLoadMaxFatigue}"></label>
          </div>
          <div class="policy-expression"><span>计算</span><strong>${state.settings.rollingLoadWindowMinutes} 分钟内已承担岗位疲劳 + 新岗位疲劳</strong><i class="bi bi-arrow-right"></i><strong>超过 ${state.settings.rollingLoadMaxFatigue} 点时优先避开，无安全替代时保证岗位完整</strong></div>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="rotation">
        <summary><span><strong>重点岗位频率均衡与分级轮岗</strong><small>${state.settings.positionRotationEnabled ? "已启用" : "已停用"} · 重点岗位优先，普通岗位防止连续第三班</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="policy-switch"><span><strong>启用规则</strong><small>重点岗位：一号、申报、督导、控制、送资料；普通岗位不比较月度频率，只防止连续第三班</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-rotation-enabled" type="checkbox" ${state.settings.positionRotationEnabled ? "checked" : ""}></span></label>
          </div>
          <div class="policy-expression"><span>生成阶段</span><strong>先确认不会造成后续岗位空缺，再选重点岗位低频人员</strong><i class="bi bi-arrow-right"></i><strong>空闲接替 → 2至5人最短闭环或开放式连续腾挪</strong><i class="bi bi-arrow-right"></i><span>KE166柜台轮换后选督导；连续独立督导可由未连续柜台人员安全兼任替换</span></div>
          <div class="policy-expression mt-2"><span>末班重点岗位</span><strong>先彻底退出晚班</strong><i class="bi bi-arrow-right"></i><strong>无解时换到疲劳点严格下降的普通岗位</strong><i class="bi bi-arrow-right"></i><span>再按参与人数最少、人员负荷与公平选择；下个工作班值班人员不能换入</span></div>
          <small class="text-secondary d-block mt-2">上一工作班末班重点岗位人员原则上不换入目标重点岗位；其他安全方案全部穷尽后才可作为软约束兜底，并显示提醒。资质、状态、夜班能力、时间冲突、工时、人工与特殊锁定、岗位完整性始终不可突破。</small>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="late-shift-recovery">
        <summary><span><strong>跨工作日恢复保护</strong><small>${policyState(state.settings.lateShiftRecoveryEnabled)} · 值班避让、早班目标、次班截止与末班保护</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="policy-switch"><span><strong>启用规则</strong><small>保护上一工作日最后一批中命中下列重点岗位规则的全部人员</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-late-shift-recovery-enabled" type="checkbox" ${state.settings.lateShiftRecoveryEnabled ? "checked" : ""}></span></label>
            <label class="form-label">晚班起点<input class="form-control" id="policy-late-shift-start-time" type="time" value="${escapeHtml(state.settings.lateShiftStartTime)}"></label>
            <label class="form-label">最后一批航班范围（分钟）<input class="form-control" id="policy-late-shift-latest-window" type="number" min="0" max="720" step="30" value="${state.settings.lateShiftLatestWindowMinutes}"></label>
          </div>
          <div class="policy-expression"><span>判定</span><strong>最近工作日 ${state.settings.lateShiftStartTime} 后最后 ${state.settings.lateShiftLatestWindowMinutes} 分钟内的末班重点岗位</strong><i class="bi bi-arrow-right"></i><strong>下个工作日先避开自动值班，再避开指定早班目标和截止时间后的航班</strong><i class="bi bi-arrow-right"></i><strong>安全方案中选择最终下班更早且不破坏重点岗位轮换与负荷均衡的安排</strong></div>
          <small class="text-secondary d-block mt-2">统一执行：优先避开，无安全替代时保证岗位完整。</small>
          <div class="d-flex justify-content-between align-items-center mt-3"><strong>末班重点岗位</strong><button class="btn btn-outline-secondary btn-sm" type="button" data-action="add-late-shift-recovery-position"><i class="bi bi-plus-lg me-1"></i>新增规则</button></div>
          <div class="supervisor-coverage-list mt-2">${lateShiftRecoveryPositionRows(state) || `<div class="empty-state">尚未配置末班重点岗位</div>`}</div>
          <div class="d-flex justify-content-between align-items-center mt-3"><strong>次班早班避让目标</strong><button class="btn btn-outline-secondary btn-sm" type="button" data-action="add-recovery-target"><i class="bi bi-plus-lg me-1"></i>新增目标</button></div>
          <div class="duty-priority-list mt-2">${nextWorkdayRecoveryTargetRows(state) || `<div class="empty-state">尚未配置早班避让目标</div>`}</div>
          <small class="text-secondary d-block mt-2">匹配方式：航班号完全一致，关键词命中岗位名称或岗位备注；次班截止时间按航班开始时间判断，留空表示不限制。人工值班、KE166机动督导、严格衔接和岗位完整性仍优先，突破时会在排班反馈中说明原因。</small>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="transition-policies">
        <summary><span><strong>岗位衔接间隔规则</strong><small>${state.settings.positionTransitionPolicies.filter((item) => item.enabled).length} 条启用 · 可继续新增具体衔接</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="d-flex justify-content-end"><button class="btn btn-outline-secondary" type="button" data-action="add-transition-policy"><i class="bi bi-plus-lg me-2"></i>新增衔接规则</button></div>
          <div class="policy-card-list">${transitionPolicyCards(state) || `<div class="empty-state">尚无岗位衔接规则</div>`}</div>
        </div>
      </details>

      <details class="policy-rule-card policy-ledger" data-policy-card="rule-ledger">
        <summary><span><strong>当前排班规则清单</strong><small>公开系统实际执行顺序与调整入口</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content table-responsive"><table class="table align-middle data-table policy-ledger-table"><thead><tr><th>编号</th><th>层级</th><th>规则</th><th>当前执行内容</th><th>调整入口</th></tr></thead><tbody>${ruleLedgerRows(state)}</tbody></table></div>
      </details>
    </section>`;
}
