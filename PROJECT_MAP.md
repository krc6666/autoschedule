# autoschedule 项目地图

更新时间：2026-08-23

这是一套运行在浏览器本地的机场地勤自动排班工作台。项目没有后端、账号、遥测或远端数据写入；配置、航班、历史和排班结果保存在浏览器 `localStorage`，Excel 用于导入导出，HiGHS 用于求解。

## 总览

```text
浏览器
  |
  v
src/main.ts
  |
  v
src/app.ts
  |
  +--> ApplicationCoordinator ------ UI 命令、视图、日期、运行生命周期
  +--> Autoschedule Store ------------ 唯一应用状态源
  |       |
  |       +--> application actions ---- 配置、规则、排班、历史、统计、工作簿
  |       +--> infrastructure ---------- localStorage、Excel、分享、浏览器偏好
  |       +--> UI model ---------------- Lit 页面与组件
  |
  +--> 排班运行
          |
          +--> schedule-runner
          |       +--> Web Worker（浏览器支持时）
          |       +--> 主线程回退（无 Worker 时）
          |
          +--> domain/kernel/scheduling-kernel
                  +--> prepareSchedule：航班、岗位、资质、运行事实
                  +--> optimizeDailySchedule：HiGHS 日模型与词典序目标
                  +--> schedule-ledger：结果账本
                  +--> coverage：岗位补全、机动督导、行政/引导处理
                  +--> post-schedule reviews：恢复、截止、轮岗、公平、CX 分散
                  +--> ScheduleResult：岗位、空缺、工时、疲劳、反馈、决策证据
```

## 目录分层

### 根目录

- `AGENTS.md`：协作纪律、职责边界、验证和推送门槛。
- `spec.md`：当前产品事实、排班规则合同、数据与导入导出边界。
- `HANDOFF.md`：窗口交接快照，不替代产品事实。
- `README.md`：面向使用者的入口说明。
- `package.json`：Vite、TypeScript、Vitest、HiGHS 运行脚本。
- `index.html`、`src/main.ts`：浏览器应用入口。
- `PROJECT_MAP.md`：本地图。

### `src/app/`：应用编排与状态变更

只负责把 UI 命令提交到唯一 Store，并协调生命周期；不承载排班业务规则。

- `application-coordinator.ts`：视图切换、命令分发、应用启动。
- `store/autoschedule-store.ts`：唯一应用状态 Store。
- `configuration-actions.ts`：人员、航班、岗位、模板等基础配置。
- `policy-actions.ts`、`policy-collection-actions.ts`：规则开关和结构化规则。
- `schedule-actions.ts`、`schedule-run-controller.ts`：生成、停止、安装排班结果。
- `history-actions.ts`、`statistics-actions.ts`：归档与统计操作。
- `workbook-actions.ts`、`workbook-import-controller.ts`：工作簿导入导出流程。
- `controllers/`：配置、规则、记录、排班、传输等类型化 UI 命令编排。

### `src/domain/`：排班领域核心

不读取 DOM，不写浏览器存储。这里是岗位、人员、时间、疲劳、轮岗和反馈的事实实现。

- `kernel/`：当天排班主流程、HiGHS 模型、结果物化、账本、覆盖和后置管线。
- `assignments/`：岗位分配工厂、时间处理、值班、`KE166`、证据和调整。
- `candidates/`：候选资质、硬约束、候选选择和候选排序。
- `coverage/`：岗位完整性、早班分流、机动督导和团队长兼任覆盖。
- `duty-roster/`：值班与备勤计算。
- `flights/`：航班计划、岗位规则、任务生成、下一工作班和周计划。
- `reviews/`：排班完成后的安全复核、公平、恢复、截止、轮岗和反馈证据。
- `rules/`：中央规则合同、规则注册表、执行计划、设置和跨航班规则。
- `solver/`：求解器端口、整体重排模型、重排安全图和用户可读错误。
- `statistics/`：疲劳、末班重点岗位次数、同岗频率、月度统计和工作负荷。
- `shared/`：排班事实、时间、跨工作日负荷和统一领域共享模型。

当前同日 CX 重点岗位规则位于：

- `reviews/same-day-cross-flight-priority-review.ts`：只对最终实际发生的早晚同人冲突尝试安全换人。
- `reviews/position-rotation-policy.ts`：识别现有重点岗位关键词及严格的 `G18`、`G20` 岗位名。
- `rules/schedule-rule-contract.ts`：中央规则 ID、阶段和 best-effort 合同。
- `rules/built-in-rule-registry.ts`：把规则接入排班后复核管线。

### `src/infrastructure/`：外部边界

- `storage.ts`、`state-restoration.ts`：版本化 `localStorage` 保存、恢复和迁移。
- `excel.ts`、`excel-worksheet.ts`：通用 Excel 工作表读写。
- `excel-rule-settings.ts`：规则设置的 Excel 合同。
- `late-priority-counts-excel.ts`：末班重点岗位次数导入导出。
- `legacy-schedule-excel.ts`：旧版手工排班历史导入与覆盖隔离。
- `duty-roster-excel.ts`：值班表导入导出。
- `share.ts`：分享文件和配置传输。
- `schedule-runner.ts`：排班运行边界、进度、安全中间结果和停止控制。
- `schedule.worker.ts`、`schedule-worker-protocol.ts`：Worker 消息协议和后台求解。
- `solver/highs-solver.ts`：HiGHS 适配、WASM/Native 初始化和求解结果转换。
- `browser-preferences.ts`、`flight-query.ts`：浏览器偏好和航班查询边界。

### `src/ui/`：展示层

基于 Lit。组件只渲染应用模型并发出 UI 命令，不直接改 Store 或调用领域规则。

- `components/autoschedule-app.ts`：根组件、导航、导入导出入口和页面挂载。
- `components/overview-page.ts`：工作台概览。
- `components/config-page.ts`、`staff-config-section.ts`、`position-rules-section.ts`：人员、岗位和航班配置。
- `components/flights-page.ts`、`weekly-flight-plan-section.ts`：航班和周计划。
- `components/schedule-page.ts`、`schedule-grid.ts`、`schedule-toolbar.ts`：排班结果、调整和工具栏。
- `components/statistics-page.ts`、`staff-load-table.ts`：负荷与末班重点岗位统计。
- `components/history-page.ts`、`archived-schedule-board.ts`：历史归档。
- `components/policy-page.ts`、`policy-settings-form.ts`、`policy-rule-ledger.ts`：规则设置和规则说明。
- `components/*dialog.ts`：导入、值班、航班选择、交换分析等对话框。
- `projections/`：把领域状态投影成页面模型和规则展示文本。
- `events/ui-command.ts`：UI 到 app 层的类型化命令。

### `tests/`

- `tests/app/`：Store、动作、控制器和应用生命周期。
- `tests/domain/`：排班规则、求解模型、资质、轮岗、反馈、统计和安全复核。
- `tests/infrastructure/`：Excel、存储、Worker/Runner、HiGHS 和分享边界。
- `tests/ui/`：Lit 组件、页面交互和视图投影。
- `tests/architecture/`：模块职责、依赖方向、边界和构建配置。
- `tests/integration/`：完整排班结果的语义质量和快照。
- `tests/performance/`：求解器、页面、周计划和大规模夹具压力测试。

## 排班执行链

```text
AppState
  |
  v
createScheduleGenerationFacts
  |
  v
prepareSchedule
  |- 航班按开始时间排序
  |- 生成自动任务
  |- 计算资质池和运行事实
  |- 锁定值班目标与跨工作日保护目标
  |
  v
optimizeDailySchedule
  |- 构造 staff/vacancy 变量
  |- 应用硬约束、覆盖、值班、资质预留和跨航班保护
  |- 运行词典序 HiGHS 目标
  |- 生成可检查的 DailySchedulePlan
  |
  v
schedule-ledger + passive positions
  |
  v
coverage mutations
  |- 岗位补全、岗位下沉、团队长/机动督导覆盖
  |
  v
post-schedule mutations
  |- 末班重点岗位公平与频率
  |- 跨工作日恢复与次班截止
  |- 同日早晚 CX 重点岗位分散
  |- 连续岗位轮岗与 KE166 收尾复核
  |
  v
最终结果
  |- assignments / vacancies
  |- 工时、疲劳和统计
  |- warnings
  |- systemNotes / decisionTrace
  |- 反馈和可解释的阻塞原因
```

## 状态与数据边界

```text
用户编辑
  -> UI command
  -> controller
  -> app action
  -> Store / AppState
  -> localStorage autoschedule.state.v1

Excel 导入
  -> workbook controller/action
  -> infrastructure parser
  -> 结构化配置或历史覆盖
  -> Store

排班结果
  -> ScheduleResult
  -> history/archive 或当前 assignments
  -> statistics / feedback / UI projections
```

关键事实源：

- 当前配置事实：`AppState.staff`、`flights`、`positionRules`、`settings`。
- 当前排班事实：`AppState.assignments`，不是页面文字或旧决策记录。
- 已归档事实：`AppState.history`；未归档结果不参与跨工作日判断。
- 规则优先级：`src/domain/rules/schedule-rule-contract.ts`，不是 UI 展示文本。
- 外部格式：`src/infrastructure/` 中的 Excel、存储和分享转换器。

## 常用开发命令

```powershell
npm.cmd run dev              # 启动 Vite 开发服务器
npm.cmd run typecheck        # TypeScript 项目检查
npm.cmd test                 # 普通测试，不含性能目录
npm.cmd run test:performance # 性能与压力测试
npm.cmd run build            # 生产构建
npm.cmd run verify           # 类型检查、普通测试、性能测试、构建
```

变更排班规则、求解器、Worker、Excel、存储或共享状态时，优先使用 `npm.cmd run verify`；推送前必须先通过该命令。纯文档变更至少运行：

```powershell
git diff --check
```

## 规则修改定位

```text
规则事实/优先级      -> spec.md + schedule-rule-contract.ts
规则注册/执行顺序    -> built-in-rule-registry.ts + scheduling-execution-plan.ts
候选资质/硬约束      -> candidates/assignment-eligibility.ts
主求解模型           -> kernel/daily-schedule-model.ts
覆盖与补缺           -> coverage/ + kernel/schedule-finalizer.ts
安全重排/后置复核    -> reviews/ + solver/reassignment-optimizer.ts
统计与公平           -> statistics/ + reviews/
页面设置             -> ui/components/ + app/controllers/ + app/*-actions.ts
导入导出             -> infrastructure/ + app/workbook-actions.ts
```

不要把新的业务规则直接堆进 `src/app.ts`、UI 组件或 `scheduling-kernel.ts` 入口；先找到拥有该业务事实的职责模块，再由中央管线接入。
