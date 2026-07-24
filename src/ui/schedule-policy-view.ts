import type { AppState } from "../model";
import { escapeHtml } from "../utils";

function policyState(enabled: boolean, mode: "prefer" | "forbid"): string {
  if (!enabled) return "已停用";
  return mode === "forbid" ? "强保护（无替代时回填）" : "优先避开";
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

function dutyPriorityRows(state: AppState): string {
  return state.settings.dutyPositionPriorities.map((priority, index) => `
    <div class="duty-priority-row">
      <span class="duty-priority-order">${index + 1}</span>
      <label class="form-label">航班号<input class="form-control form-control-sm code-input" value="${escapeHtml(priority.flightNo)}" data-entity="duty-priority" data-id="${escapeHtml(priority.id)}" data-field="flightNo"></label>
      <label class="form-label">岗位或备注关键词<input class="form-control form-control-sm" value="${escapeHtml(priority.positionKeyword)}" data-entity="duty-priority" data-id="${escapeHtml(priority.id)}" data-field="positionKeyword"></label>
      <label class="form-check form-switch duty-priority-switch"><input class="form-check-input" type="checkbox" ${priority.enabled ? "checked" : ""} data-entity="duty-priority" data-id="${escapeHtml(priority.id)}" data-field="enabled"><span class="form-check-label">启用</span></label>
      <div class="duty-priority-actions"><button class="btn btn-sm icon-btn" type="button" data-action="move-duty-priority-up" data-id="${escapeHtml(priority.id)}" title="提高优先级" ${index === 0 ? "disabled" : ""}><i class="bi bi-arrow-up"></i></button><button class="btn btn-sm icon-btn" type="button" data-action="move-duty-priority-down" data-id="${escapeHtml(priority.id)}" title="降低优先级" ${index === state.settings.dutyPositionPriorities.length - 1 ? "disabled" : ""}><i class="bi bi-arrow-down"></i></button><button class="btn btn-sm icon-btn text-danger" type="button" data-action="delete-duty-priority" data-id="${escapeHtml(priority.id)}" title="删除优先项"><i class="bi bi-trash3"></i></button></div>
    </div>`).join("");
}

function supervisorCoverageRows(state: AppState): string {
  return state.settings.mobileSupervisorCoverageRules.map((rule) => `
    <div class="supervisor-coverage-row">
      <label class="form-check form-switch supervisor-coverage-switch"><input class="form-check-input" type="checkbox" ${rule.enabled ? "checked" : ""} data-entity="supervisor-coverage" data-id="${escapeHtml(rule.id)}" data-field="enabled"><span class="form-check-label">启用</span></label>
      <label class="form-label">适用航班<input class="form-control form-control-sm code-input" value="${escapeHtml(rule.flightNo)}" placeholder="留空=全部航班" data-entity="supervisor-coverage" data-id="${escapeHtml(rule.id)}" data-field="flightNo"></label>
      <label class="form-label">匹配位置<select class="form-select form-select-sm" data-entity="supervisor-coverage" data-id="${escapeHtml(rule.id)}" data-field="matchField"><option value="position" ${rule.matchField === "position" ? "selected" : ""}>岗位名称</option><option value="remark" ${rule.matchField === "remark" ? "selected" : ""}>岗位备注</option></select></label>
      <label class="form-label">关键词<input class="form-control form-control-sm" value="${escapeHtml(rule.keyword)}" placeholder="例如：一号" data-entity="supervisor-coverage" data-id="${escapeHtml(rule.id)}" data-field="keyword"></label>
      <label class="form-label">处理方式<select class="form-select form-select-sm" data-entity="supervisor-coverage" data-id="${escapeHtml(rule.id)}" data-field="mode"><option value="forbid" ${rule.mode === "forbid" ? "selected" : ""}>禁止兼任</option><option value="allow" ${rule.mode === "allow" ? "selected" : ""}>允许兼任</option></select></label>
      <button class="btn btn-sm icon-btn text-danger" type="button" data-action="delete-supervisor-coverage" data-id="${escapeHtml(rule.id)}" title="删除兼任规则"><i class="bi bi-trash3"></i></button>
    </div>`).join("");
}

function ruleLedgerRows(state: AppState): string {
  const rows = [
    ["R01", "硬约束", "人员可用状态", "仅状态为正常的人员可参与排班；状态变化后立即重新计算当前排班", "人员信息"],
    ["R02", "硬约束", "岗位资质硬约束", "常规与行政支援人员均须具备已配置岗位资质", "岗位规则 / 资质人员"],
    ["R03", "硬约束", "夜班能力", `与 ${state.settings.nightStart}-${state.settings.nightEnd} 重叠时必须具备夜班能力`, "人员信息 / 排班约束"],
    ["R04", "硬约束", "时段冲突", "同一人员不得承担时间重叠的两个常规任务", "航班时间"],
    ["R05", "硬约束", "每日工时上限", `每天不超过 ${state.settings.maxDailyHours} 小时`, "排班约束"],
    ["R06", "岗位生成", "行政支援替换", "行政模式下同航班同名行政岗位替换常规岗位；仅在无可用常规人员时允许合格行政人员手动补位", "岗位分类 / 行政模式"],
    ["R07", "岗位生成", "运力阈值", "低于启用旅客人数时岗位保留；12点前常规岗位仍自动派人", "岗位规则 / 启用旅客人数"],
    ["R08", "分配优先级", "12点前单岗位稀缺优先", "汇总所有12点前常规岗位，按每个岗位可胜任人数从少到多安排", "岗位资质"],
    ["R09", "分配优先级", "在岗人员全覆盖", "岗位与资质允许时，优先安排当天尚未获得实际工时的常规人员", "人员状态 / 岗位资质"],
    ["R10", "月度轮值", "值班绝对优先与三级均衡", `先排值班且与CX航前、备勤互斥；CX航前可兼任备勤；值班计 ${state.settings.dutyFatiguePoints} 点并依次尝试 ${state.settings.dutyPositionPriorities.filter((item) => item.enabled).length} 个岗位优先项`, "规则 / 排班页轮值表"],
    ["R11", "分配优先级", "12点前岗位完整性", state.settings.workloadBalanceEnabled ? `12点前常规岗位优先于阈值、手动标记和疲劳保护，再尽量将工时差控制在 ${state.settings.maxWorkHoursDifference} 小时、疲劳差控制在 ${state.settings.maxTodayFatigueDifference} 点` : "负荷均衡已停用，12点前常规岗位完整性仍为最高优先级", "规则 / 负荷均衡"],
    ["R12", "分配优先级", "特殊岗位衔接", `${state.settings.positionTransitionPolicies.filter((item) => item.enabled).length} 条启用；12点前无人替代时可突破严格限制并反馈留痕`, "规则 / 岗位衔接"],
    ["R13", "分配优先级", "高负荷衔接保护", state.settings.highLoadProtectionEnabled ? `疲劳点 ≥ ${state.settings.highLoadFatigueThreshold} 或带备注，恢复 ${state.settings.highLoadRecoveryMinutes} 分钟` : "已停用", "规则"],
    ["R14", "分配优先级", "滚动负荷上限", state.settings.rollingLoadProtectionEnabled ? `${state.settings.rollingLoadWindowMinutes} 分钟内投放新岗位后不超过 ${state.settings.rollingLoadMaxFatigue} 疲劳点` : "已停用", "规则"],
    ["R15", "分配优先级", "同岗轮换", state.settings.positionRotationEnabled ? `回看 ${state.settings.positionRotationLookbackDays} 天，同航班同岗位优先更换合格人员` : "已停用", "规则 / 历史"],
    ["R16", "分配优先级", "跨工作日晚班减负", state.settings.lateShiftRecoveryEnabled ? `最近工作日最后一批晚班高负荷人员，下个工作日晚班岗位负荷优先不超过 ${state.settings.nextDayLateMaxFatigue} 点` : "已停用", "规则 / 历史"],
    ["R17", "分配优先级", "历史疲劳均衡", `历史 ${state.settings.historyWindowDays} 天 + 当日岗位疲劳 + 连续工作惩罚`, "排班约束 / 历史"],
    ["R18", "岗位调整", "引导复用与机动督导", `引导复用同航班常规人员；KE166明确配置机动督导时，在常规及行政支援模式下均先保留一名机动督导资质人员到允许兼任的常规岗位，再同步顶部督导；自动兼任和人工拖拽统一执行 ${state.settings.mobileSupervisorCoverageRules.filter((item) => item.enabled).length} 条兼任范围规则`, "规则 / 机动督导兼任范围"],
    ["R19", "岗位衔接", "分流提前撤岗", "下午及晚间按岗位提前撤岗分钟释放人员，早班不适用", "岗位规则 / 提前撤岗"],
    ["R20", "稳定排序", "同分人员顺序", "规则风险、在岗覆盖、稀缺预留和疲劳相同时按人员编号稳定排序", "人员编号"],
    ["R21", "岗位完整性", "常规岗位空缺下沉", "自动排班完成后重新匹配同航班合格人员，保持已填岗位数不下降，优先填满上方常规岗位并将无法避免的空缺尽量沉底", "岗位顺序 / 岗位资质"],
    ["R22", "值班落位", "值班岗位有序优先", `按启用顺序依次尝试航班号与岗位关键词；均不可执行时回退到最晚两档的一号、督导、申报、送资料`, "规则 / 值班任务规则"],
    ["R23", "月度统计", "轻松班次统计", `最后航班截载严格早于 ${state.settings.earlyDepartureCutoffTime} 计提前下班；${state.settings.afternoonRestStartTime}-${state.settings.afternoonRestEndTime} 无航班重叠计下午无航班`, "规则 / 排班结果"],
    ["R24", "硬约束", "机动督导兼任范围", "禁止规则优先；配置允许规则后，只能兼任命中允许项且未命中禁止项的岗位", "规则 / 机动督导兼任范围"],
    ["R25", "分配优先级", "分队长督导补缺", `人员信息中标记的 ${state.staff.filter((person) => person.staffType === "常规" && person.teamLeader).length} 名分队长仅作为督导岗位兜底；有其他满足硬约束的非分队长候选时优先使用其他人`, "人员信息 / 分队长"]
  ];
  return rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`).join("");
}

export function renderSchedulePolicy(state: AppState): string {
  return `
    <section class="workspace-section schedule-policy-section">
      <div class="section-heading"><div><h3>排班规则</h3><span>${state.settings.positionTransitionPolicies.length + 9} 条可编辑规则 · 点击规则可展开编辑</span></div><button class="btn btn-primary" type="button" data-action="save-schedule-policy"><i class="bi bi-check2-circle me-2"></i>保存并应用</button></div>
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
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="duty-rules">
        <summary><span><strong>值班任务规则</strong><small>08:30前早班 + 有序岗位优先 + 晚撤回退 · 当前 ${state.settings.dutyFatiguePoints} 疲劳点</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls policy-controls-three">
            <label class="form-label">每次值班疲劳点<input class="form-control" id="policy-duty-fatigue-points" type="number" min="0" max="50" step="0.5" value="${state.settings.dutyFatiguePoints}"></label>
            <div class="policy-switch"><span><strong>08:30前早班</strong><small>值班人员必须承担一班08:30及以前开始的航班</small></span><i class="bi bi-sunrise"></i></div>
            <div class="policy-switch"><span><strong>指定晚撤岗位</strong><small>最晚或倒数第二晚的一号、督导、申报、送资料</small></span><i class="bi bi-moon-stars"></i></div>
          </div>
          <div class="d-flex align-items-center justify-content-between gap-2"><strong class="small">值班岗位优先顺序</strong><button class="btn btn-sm btn-outline-secondary" type="button" data-action="add-duty-priority"><i class="bi bi-plus-lg me-1"></i>新增优先项</button></div>
          <div class="duty-priority-list">${dutyPriorityRows(state) || `<div class="empty-state">尚未配置优先项，将直接使用晚撤回退规则</div>`}</div>
          <div class="policy-expression"><span>执行</span><strong>先锁定08:30前早班</strong><i class="bi bi-arrow-right"></i><strong>依次尝试启用的航班/岗位优先项</strong><i class="bi bi-arrow-right"></i><span>全部不可执行时回退到最晚两档晚撤岗位</span></div>
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
        <summary><span><strong>高负荷岗位衔接保护</strong><small>${policyState(state.settings.highLoadProtectionEnabled, state.settings.highLoadTransitionMode)} · 同日恢复保护</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="policy-switch"><span><strong>启用规则</strong><small>保护高负荷任务后的恢复时间</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-enabled" type="checkbox" ${state.settings.highLoadProtectionEnabled ? "checked" : ""}></span></label>
            <label class="form-label">高负荷疲劳阈值<input class="form-control" id="policy-fatigue-threshold" type="number" min="0.5" max="50" step="0.5" value="${state.settings.highLoadFatigueThreshold}"></label>
            <label class="form-label">恢复时间（分钟）<input class="form-control" id="policy-recovery-minutes" type="number" min="0" max="1440" step="30" value="${state.settings.highLoadRecoveryMinutes}"></label>
            <label class="form-label">执行强度<select class="form-select" id="policy-transition-mode"><option value="prefer" ${state.settings.highLoadTransitionMode === "prefer" ? "selected" : ""}>优先避开（人手不足可兜底）</option><option value="forbid" ${state.settings.highLoadTransitionMode === "forbid" ? "selected" : ""}>强保护（无替代时仍回填）</option></select></label>
            <label class="policy-switch"><span><strong>备注岗位视为高负荷</strong><small>一号、申报、控制等备注均参与判定</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-remarked-high-load" type="checkbox" ${state.settings.remarkedPositionHighLoad ? "checked" : ""}></span></label>
          </div>
          <div class="policy-expression"><span>判定</span><strong>岗位有备注或疲劳点 ≥ ${state.settings.highLoadFatigueThreshold}</strong><i class="bi bi-arrow-right"></i><span>${state.settings.highLoadRecoveryMinutes} 分钟内</span><strong>优先安排其他人员；无替代时已超保护仍安排</strong></div>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="rolling-load">
        <summary><span><strong>滚动负荷上限</strong><small>${policyState(state.settings.rollingLoadProtectionEnabled, state.settings.rollingLoadMode)} · 限制连续堆高疲劳</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls">
            <label class="policy-switch"><span><strong>启用规则</strong><small>仅在投放高负荷岗位时触发</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-rolling-load-enabled" type="checkbox" ${state.settings.rollingLoadProtectionEnabled ? "checked" : ""}></span></label>
            <label class="form-label">滚动窗口（分钟）<input class="form-control" id="policy-rolling-window-minutes" type="number" min="0" max="1440" step="30" value="${state.settings.rollingLoadWindowMinutes}"></label>
            <label class="form-label">累计疲劳上限<input class="form-control" id="policy-rolling-max-fatigue" type="number" min="0.5" max="100" step="0.5" value="${state.settings.rollingLoadMaxFatigue}"></label>
            <label class="form-label">执行强度<select class="form-select" id="policy-rolling-load-mode"><option value="prefer" ${state.settings.rollingLoadMode === "prefer" ? "selected" : ""}>优先避开（人手不足可兜底）</option><option value="forbid" ${state.settings.rollingLoadMode === "forbid" ? "selected" : ""}>强保护（无替代时仍回填）</option></select></label>
          </div>
          <div class="policy-expression"><span>计算</span><strong>${state.settings.rollingLoadWindowMinutes} 分钟内已承担岗位疲劳 + 新岗位疲劳</strong><i class="bi bi-arrow-right"></i><strong>超过 ${state.settings.rollingLoadMaxFatigue} 点时优先换人，无替代时仍回填</strong></div>
        </div>
      </details>

      <details class="policy-rule-card" data-policy-card="rotation">
        <summary><span><strong>同岗轮换</strong><small>${policyState(state.settings.positionRotationEnabled, state.settings.positionRotationMode)} · 避免长期固定岗位</small></span><i class="bi bi-chevron-down"></i></summary>
        <div class="policy-rule-content">
          <div class="schedule-policy-controls policy-controls-three">
            <label class="policy-switch"><span><strong>启用规则</strong><small>依据已归档排班判断近期重复</small></span><span class="form-check form-switch m-0"><input class="form-check-input" id="policy-rotation-enabled" type="checkbox" ${state.settings.positionRotationEnabled ? "checked" : ""}></span></label>
            <label class="form-label">轮换回看天数<input class="form-control" id="policy-rotation-lookback-days" type="number" min="1" max="90" step="1" value="${state.settings.positionRotationLookbackDays}"></label>
            <label class="form-label">执行强度<select class="form-select" id="policy-rotation-mode"><option value="prefer" ${state.settings.positionRotationMode === "prefer" ? "selected" : ""}>优先轮换（无人可换时兜底）</option><option value="forbid" ${state.settings.positionRotationMode === "forbid" ? "selected" : ""}>强轮换（无人可换时仍回填）</option></select></label>
          </div>
          <div class="policy-expression"><span>判定</span><strong>最近 ${state.settings.positionRotationLookbackDays} 天已承担同航班同岗位</strong><i class="bi bi-arrow-right"></i><strong>优先选择其他合格人员；全部重复时仍安排</strong></div>
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
            <label class="form-label">执行强度<select class="form-select" id="policy-late-shift-recovery-mode"><option value="prefer" ${state.settings.lateShiftRecoveryMode === "prefer" ? "selected" : ""}>优先减负（人手不足可兜底）</option><option value="forbid" ${state.settings.lateShiftRecoveryMode === "forbid" ? "selected" : ""}>强保护（无替代时仍回填）</option></select></label>
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
