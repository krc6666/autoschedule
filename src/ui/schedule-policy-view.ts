import type { AppState } from "../model";
import { escapeHtml } from "../utils";

function policyState(enabled: boolean, mode: "prefer" | "forbid"): string {
  if (!enabled) return "已停用";
  return mode === "forbid" ? "严格限制" : "优先避开";
}

function transitionPolicyCards(state: AppState): string {
  return state.settings.positionTransitionPolicies.map((policy) => `
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
    </details>`).join("");
}

function ruleLedgerRows(state: AppState): string {
  const rows = [
    ["R01", "硬约束", "人员可用状态", "仅状态为正常的人员可参与排班", "人员信息"],
    ["R02", "硬约束", "岗位资质硬约束", "常规岗位仅使用已配置资质人员", "岗位规则 / 资质人员"],
    ["R03", "硬约束", "夜班能力", `与 ${state.settings.nightStart}-${state.settings.nightEnd} 重叠时必须具备夜班能力`, "人员信息 / 排班约束"],
    ["R04", "硬约束", "时段冲突", "同一人员不得承担时间重叠的两个常规任务", "航班时间"],
    ["R05", "硬约束", "每日工时上限", `每天不超过 ${state.settings.maxDailyHours} 小时`, "排班约束"],
    ["R06", "岗位生成", "行政支援替换", "行政模式下同航班同名行政岗位替换常规岗位并留空", "岗位分类 / 行政模式"],
    ["R07", "岗位生成", "运力阈值", "低于启用旅客人数时岗位保留但不自动派人", "岗位规则 / 启用旅客人数"],
    ["R08", "分配优先级", "稀缺岗位优先", "先处理合格人数更少的岗位，并为后续重叠稀缺岗位预留人员", "岗位资质"],
    ["R09", "分配优先级", "在岗人员全覆盖", "岗位与资质允许时，优先安排当天尚未获得实际工时的常规人员", "人员状态 / 岗位资质"],
    ["R10", "月度轮值", "CX航前 / 值班 / 备勤", `四个人选互不重复并按月均衡；CX航前和值班分别限资质人员；值班计 ${state.settings.dutyFatiguePoints} 点并优先最晚航班的一号、督导、申报或送资料岗位`, "人员信息 / 排班页轮值表"],
    ["R11", "分配优先级", "特殊岗位衔接", `${state.settings.positionTransitionPolicies.filter((item) => item.enabled).length} 条启用，按前序晚撤岗位和最小间隔判断`, "策略 / 岗位衔接"],
    ["R12", "分配优先级", "高负荷衔接保护", state.settings.highLoadProtectionEnabled ? `疲劳点 ≥ ${state.settings.highLoadFatigueThreshold} 或带备注，恢复 ${state.settings.highLoadRecoveryMinutes} 分钟` : "已停用", "策略"],
    ["R13", "分配优先级", "滚动负荷上限", state.settings.rollingLoadProtectionEnabled ? `${state.settings.rollingLoadWindowMinutes} 分钟内投放新岗位后不超过 ${state.settings.rollingLoadMaxFatigue} 疲劳点` : "已停用", "策略"],
    ["R14", "分配优先级", "同岗轮换", state.settings.positionRotationEnabled ? `回看 ${state.settings.positionRotationLookbackDays} 天，同航班同岗位优先更换合格人员` : "已停用", "策略 / 历史"],
    ["R15", "分配优先级", "跨工作日晚班减负", state.settings.lateShiftRecoveryEnabled ? `最近工作日最后一批晚班高负荷人员，下个工作日晚班岗位负荷优先不超过 ${state.settings.nextDayLateMaxFatigue} 点` : "已停用", "策略 / 历史"],
    ["R16", "分配优先级", "疲劳均衡", `历史 ${state.settings.historyWindowDays} 天 + 当日岗位疲劳 + 连续工作惩罚`, "排班约束 / 历史"],
    ["R17", "岗位复用", "引导岗位", "按显示顺序从下向上复用同航班常规岗位人员，不重复累计工时", "岗位分类 / 岗位顺序"],
    ["R18", "岗位衔接", "分流提前撤岗", "下午及晚间按岗位提前撤岗分钟释放人员，早班不适用", "岗位规则 / 提前撤岗"],
    ["R19", "稳定排序", "同分人员顺序", "策略风险、在岗覆盖、稀缺预留和疲劳相同时按人员编号稳定排序", "人员编号"]
  ];
  return rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`).join("");
}

export function renderSchedulePolicy(state: AppState): string {
  return `
    <section class="workspace-section schedule-policy-section">
      <div class="section-heading"><div><h3>排班策略</h3><span>${state.settings.positionTransitionPolicies.length + 4} 条可编辑规则 · 点击规则可展开编辑</span></div><button class="btn btn-primary" type="button" data-action="save-schedule-policy"><i class="bi bi-check2-circle me-2"></i>保存并应用</button></div>

      <details class="policy-rule-card" data-policy-card="high-load">
        <summary><span><strong>高负荷岗位衔接保护</strong><small>${policyState(state.settings.highLoadProtectionEnabled, state.settings.highLoadTransitionMode)} · 同日恢复保护</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="policy-switch"><span><strong>启用规则</strong><small>保护高负荷任务后的恢复时间</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-enabled" type="checkbox" ${state.settings.highLoadProtectionEnabled ? "checked" : ""}></span></label>
            <label class="form-label">高负荷疲劳阈值<input class="form-control" id="policy-fatigue-threshold" type="number" min="0.5" max="50" step="0.5" value="${state.settings.highLoadFatigueThreshold}"></label>
            <label class="form-label">恢复时间（分钟）<input class="form-control" id="policy-recovery-minutes" type="number" min="0" max="1440" step="30" value="${state.settings.highLoadRecoveryMinutes}"></label>
            <label class="form-label">执行强度<select class="form-select" id="policy-transition-mode"><option value="prefer" ${state.settings.highLoadTransitionMode === "prefer" ? "selected" : ""}>优先避开（人手不足可兜底）</option><option value="forbid" ${state.settings.highLoadTransitionMode === "forbid" ? "selected" : ""}>严格限制（宁可留空）</option></select></label>
            <label class="policy-switch"><span><strong>备注岗位视为高负荷</strong><small>一号、申报、控制等备注均参与判定</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-remarked-high-load" type="checkbox" ${state.settings.remarkedPositionHighLoad ? "checked" : ""}></span></label>
          </div>
          <div class="policy-expression"><span>判定</span><strong>岗位有备注或疲劳点 ≥ ${state.settings.highLoadFatigueThreshold}</strong><i class="bi bi-arrow-right"></i><span>${state.settings.highLoadRecoveryMinutes} 分钟内</span><strong>${state.settings.highLoadTransitionMode === "forbid" ? "禁止再次承担高负荷岗位" : "优先安排其他人员承担高负荷岗位"}</strong></div>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="rolling-load">
        <summary><span><strong>滚动负荷上限</strong><small>${policyState(state.settings.rollingLoadProtectionEnabled, state.settings.rollingLoadMode)} · 限制连续堆高疲劳</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="policy-switch"><span><strong>启用规则</strong><small>仅在投放高负荷岗位时触发</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-rolling-load-enabled" type="checkbox" ${state.settings.rollingLoadProtectionEnabled ? "checked" : ""}></span></label>
            <label class="form-label">滚动窗口（分钟）<input class="form-control" id="policy-rolling-window-minutes" type="number" min="0" max="1440" step="30" value="${state.settings.rollingLoadWindowMinutes}"></label>
            <label class="form-label">累计疲劳上限<input class="form-control" id="policy-rolling-max-fatigue" type="number" min="0.5" max="100" step="0.5" value="${state.settings.rollingLoadMaxFatigue}"></label>
            <label class="form-label">执行强度<select class="form-select" id="policy-rolling-load-mode"><option value="prefer" ${state.settings.rollingLoadMode === "prefer" ? "selected" : ""}>优先避开（人手不足可兜底）</option><option value="forbid" ${state.settings.rollingLoadMode === "forbid" ? "selected" : ""}>严格限制（宁可留空）</option></select></label>
          </div>
          <div class="policy-expression"><span>计算</span><strong>${state.settings.rollingLoadWindowMinutes} 分钟内已承担岗位疲劳 + 新岗位疲劳</strong><i class="bi bi-arrow-right"></i><strong>超过 ${state.settings.rollingLoadMaxFatigue} 点时${state.settings.rollingLoadMode === "forbid" ? "禁止安排" : "优先换人"}</strong></div>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="rotation">
        <summary><span><strong>同岗轮换</strong><small>${policyState(state.settings.positionRotationEnabled, state.settings.positionRotationMode)} · 避免长期固定岗位</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls policy-controls-three">
            <label class="policy-switch"><span><strong>启用规则</strong><small>依据已归档排班判断近期重复</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-rotation-enabled" type="checkbox" ${state.settings.positionRotationEnabled ? "checked" : ""}></span></label>
            <label class="form-label">轮换回看天数<input class="form-control" id="policy-rotation-lookback-days" type="number" min="1" max="90" step="1" value="${state.settings.positionRotationLookbackDays}"></label>
            <label class="form-label">执行强度<select class="form-select" id="policy-rotation-mode"><option value="prefer" ${state.settings.positionRotationMode === "prefer" ? "selected" : ""}>优先轮换（无人可换时兜底）</option><option value="forbid" ${state.settings.positionRotationMode === "forbid" ? "selected" : ""}>严格轮换（宁可留空）</option></select></label>
          </div>
          <div class="policy-expression"><span>判定</span><strong>最近 ${state.settings.positionRotationLookbackDays} 天已承担同航班同岗位</strong><i class="bi bi-arrow-right"></i><strong>${state.settings.positionRotationMode === "forbid" ? "本次禁止重复安排" : "本次优先选择其他合格人员"}</strong></div>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="late-shift-recovery">
        <summary><span><strong>跨工作日晚班减负</strong><small>${policyState(state.settings.lateShiftRecoveryEnabled, state.settings.lateShiftRecoveryMode)} · 最近工作日晚班高负荷后的下个工作日晚班保护</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="policy-switch"><span><strong>启用规则</strong><small>规则依据最近工作日已归档排班执行</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-late-shift-recovery-enabled" type="checkbox" ${state.settings.lateShiftRecoveryEnabled ? "checked" : ""}></span></label>
            <label class="form-label">晚班起点<input class="form-control" id="policy-late-shift-start-time" type="time" value="${escapeHtml(state.settings.lateShiftStartTime)}"></label>
            <label class="form-label">最后一批航班范围（分钟）<input class="form-control" id="policy-late-shift-latest-window" type="number" min="0" max="720" step="30" value="${state.settings.lateShiftLatestWindowMinutes}"></label>
            <label class="form-label">下个工作日晚班疲劳上限<input class="form-control" id="policy-next-day-late-max-fatigue" type="number" min="0" max="50" step="0.5" value="${state.settings.nextDayLateMaxFatigue}"></label>
            <label class="form-label">执行强度<select class="form-select" id="policy-late-shift-recovery-mode"><option value="prefer" ${state.settings.lateShiftRecoveryMode === "prefer" ? "selected" : ""}>优先减负（人手不足可兜底）</option><option value="forbid" ${state.settings.lateShiftRecoveryMode === "forbid" ? "selected" : ""}>严格上限（超限岗位留空）</option></select></label>
          </div>
          <div class="policy-expression"><span>判定</span><strong>最近工作日 ${state.settings.lateShiftStartTime} 后最后 ${state.settings.lateShiftLatestWindowMinutes} 分钟航班承担高负荷岗位</strong><i class="bi bi-arrow-right"></i><strong>下个工作日最后一批晚班优先安排到不超过 ${state.settings.nextDayLateMaxFatigue} 点的靠后岗位</strong></div>
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
