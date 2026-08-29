# autoschedule 项目地图

更新时间：2026-08-27

这是一套运行在浏览器本地的机场地勤自动排班工作台。项目没有后端、账号、遥测或远端数据写入；配置、航班、历史和排班结果保存在浏览器 `localStorage`，Excel 用于导入导出，HiGHS 用于求解。当前分支包含按日期选择半休人员、跨工作日恢复偏好和原生多目标排班模型。

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
                  +--> optimizeDailySchedule：日模型与词典序目标
                  |       +--> SolverPort
                  |               +--> HiGHS WebAssembly 顺序目标
                  |               +--> 项目内 HiGHS 原生多目标适配
                  +--> schedule-ledger：结果账本
                  +--> coverage：岗位补全、机动督导、行政/引导处理
                  +--> post-schedule reviews：恢复、截止、轮岗、公平、CX 分散
                  +--> ScheduleResult：岗位、空缺、工时、疲劳、反馈、决策证据
```

## 依赖方向

```text
UI（只读投影 + UICommand）
  -> app（Store、actions、controllers）
      -> domain（排班事实与规则）
      -> infrastructure（存储、Excel、Worker、求解器适配）

domain -/-> DOM、localStorage、Excel、Worker
UI     -/-> Store 直接写入、求解器直接调用
```

`src/domain/solver/solver-port.ts` 是求解器接缝：领域模型只描述变量、约束、目标和结果；具体 HiGHS/WASM 或项目内原生实现留在 `src/infrastructure/solver/`。`src/app/` 负责把领域和基础设施接到应用生命周期，`src/app.ts` 只做根组件装配。

## 目录分层

### 根目录

- `AGENTS.md`：协作纪律、职责边界、验证和推送门槛。
- `spec.md`：当前产品事实、排班规则合同、数据与导入导出边界。
- `HANDOFF.md`：窗口交接快照，不替代产品事实。
- `README.md`：面向使用者的入口说明。
- `package.json`：Vite、TypeScript、Vitest、HiGHS 运行脚本。
- `package-lock.json`：依赖锁定，包含本地 `vendor/highs-ts` 包引用。
- `index.html`、`src/main.ts`：浏览器应用入口。
- `vite.config.ts`、`tsconfig*.json`：构建、Worker、应用和 Node 配置。
- `dev.py`、`start-autoschedule.bat`：本地开发/预览启动辅助入口。
- `.github/workflows/deploy-pages.yml`：`main` 分支推送后构建并发布 GitHub Pages。
- `public/`：配置模板等不经 TypeScript 打包的静态资源。
- `vendor/highs-ts/`：项目内 HiGHS 原生多目标实现及浏览器构建产物。
- `src/model.ts`：`AppState`、人员、航班、岗位、历史、排班结果等跨层数据类型。
- `src/defaults.ts`：默认人员、航班、岗位和规则设置。
- `src/styles.css`、`src/utils.ts`：全局样式和通用前端工具。
- `src/schedule.worker.ts`：浏览器 Worker 的领域排班入口；消息协议在 `src/infrastructure/`。
- `PROJECT_MAP.md`：本地图。

### `src/app/`：应用编排与状态变更

只负责把 UI 命令提交到唯一 Store，并协调生命周期；不承载排班业务规则。

- `application-coordinator.ts`：视图切换、命令分发、应用启动。
- `store/autoschedule-store.ts`：唯一应用状态 Store。
- `configuration-actions.ts`：人员、航班、岗位、模板等基础配置。
- `policy-actions.ts`、`policy-collection-actions.ts`：规则开关和结构化规则。
- `schedule-actions.ts`、`schedule-run-controller.ts`：生成、停止、安装排班结果和运行偏好。
- `application-view-state.ts`：当前页面、日期、运行状态和视图侧状态。
- `history-actions.ts`、`statistics-actions.ts`：归档与统计操作。
- `workbook-actions.ts`、`workbook-import-controller.ts`：工作簿导入导出流程。
- `controllers/`：配置、规则、记录、排班、传输等类型化 UI 命令编排。

### `src/domain/`：排班领域核心

不读取 DOM，不写浏览器存储。这里是岗位、人员、时间、疲劳、轮岗和反馈的事实实现。

- `kernel/`：当天排班主流程、模型、结果物化、账本、覆盖和后置管线。
- `assignments/`：岗位分配工厂、时间处理、值班、`KE166`、证据和调整。
- `candidates/`：候选资质、硬约束、候选选择和候选排序。
- `coverage/`：岗位完整性、早班分流、机动督导和团队长兼任覆盖。
- `duty-roster/`：值班与备勤计算。
- `flights/`：航班计划、岗位规则、任务生成、下一工作班和周计划。
- `reviews/`：排班完成后的安全复核、公平、恢复、截止、轮岗和反馈证据。
- `rules/`：中央规则合同、规则注册表、执行计划、设置、跨航班规则和半休约束。
- `solver/`：求解器端口、整体重排模型、重排安全图和用户可读错误。
- `statistics/`：疲劳、末班重点岗位次数、同岗频率、月度统计和工作负荷。
- `shared/`：排班事实、时间、跨工作日负荷和统一领域共享模型。

当前同日同航司重点岗位规则位于：

- `rules/airline-rotation.ts`：统一解析航空公司、规范岗位和 `航空公司 + 规范岗位` 轮换键；业务备注优先于物理柜台名。
- `kernel/daily-combination-model.ts`：在 HiGHS 模型中加入同航司控制/一号人员交叉互斥硬约束。
- `candidates/assignment-eligibility.ts`：自动补位、后置安全重排和人工调整共用的资格诊断。
- `kernel/daily-schedule-safety.ts`：最终班表的防御性硬约束复核。
- `rules/schedule-rule-contract.ts`、`rules/built-in-rule-registry.ts`：中央硬约束合同和执行入口。
- `rules/half-rest.ts`：半休人员筛选、上午候选限制、后续空缺补位和半休优化变量/约束。
- `shared/schedule-run-preferences.ts`：按次排班偏好（半休人员）的清洗与传递；跨工作日恢复模式仍属于 `ScheduleSettings`。
- `kernel/daily-schedule-result.ts`：从求解变量物化完整方案、空缺原因、决策证据和安全结果。
- `kernel/schedule-preparation.ts`：把状态、日期和按次偏好整理成一次排班的唯一运行事实。

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
- `solver/highs-solver.ts`：`SolverPort` 的 HiGHS 适配、WASM/Native 初始化、顺序/原生词典序求解、目标锁定和结果转换。
- `browser-preferences.ts`、`flight-query.ts`：浏览器偏好和航班查询边界。

### `src/ui/`：展示层

基于 Lit。组件只渲染应用模型并发出 UI 命令，不直接改 Store 或调用领域规则。

- `components/autoschedule-app.ts`：根组件、导航、导入导出入口和页面挂载。
- `components/overview-page.ts`：工作台概览。
- `components/config-page.ts`、`staff-config-section.ts`、`position-rules-section.ts`：人员、岗位和航班配置。
- `components/flights-page.ts`、`weekly-flight-plan-section.ts`：航班和周计划。
- `components/schedule-page.ts`、`schedule-grid.ts`、`schedule-toolbar.ts`：排班结果、调整和工具栏。
- `components/half-rest-selector.ts`：当前日期半休人员选择，并把按次偏好提交给排班运行。
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

测试中最接近完整真实入口的辅助夹具是 `tests/helpers/generate-schedule.ts`；求解器适配边界集中在 `tests/infrastructure/highs-solver*.test.ts`，日模型和半休合同集中在 `tests/domain/daily-schedule-optimizer.test.ts`。

## 排班执行链

```text
AppState
  |
  v
createScheduleGenerationFacts
  |
  v
normalizeScheduleRunPreferences
  |- 当前日期半休人员
  |
  v
prepareSchedule
  |- 航班按开始时间排序
  |- 生成自动任务
  |- 计算资质池和运行事实
  |- 根据半休偏好收窄上午候选
  |- 锁定值班目标与跨工作日保护目标
  |
  v
optimizeDailySchedule
  |- 构造 staff/vacancy 变量
  |- 应用硬约束、覆盖、值班、资质预留和跨航班保护
  |- 构造半休变量、硬约束和目标
  |- 通过 SolverPort 运行顺序/原生词典序目标
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

一次排班偏好
  -> schedule controller
  -> normalizeScheduleRunPreferences
  -> Worker 消息或主线程回退
  -> prepareSchedule / daily model

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
- 当前排班偏好：一次性运行输入，不写入长期配置；目前为半休人员列表，由 `ScheduleRunPreferences` 规范化后进入本次运行事实。跨工作日恢复模式是长期规则设置。
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
主求解模型           -> kernel/daily-schedule-model.ts + kernel/daily-combination-model.ts
半休规则             -> rules/half-rest.ts + shared/schedule-run-preferences.ts
求解器接口/实现       -> solver/solver-port.ts + infrastructure/solver/highs-solver.ts
运行生命周期          -> app/schedule-run-controller.ts + infrastructure/schedule-runner.ts + schedule.worker.ts
最终安全与结果        -> kernel/daily-schedule-result.ts + kernel/daily-schedule-safety.ts + kernel/schedule-finalizer.ts
覆盖与补缺           -> coverage/ + kernel/schedule-finalizer.ts
安全重排/后置复核    -> reviews/ + solver/reassignment-optimizer.ts
统计与公平           -> statistics/ + reviews/
页面设置             -> ui/components/ + app/controllers/ + app/*-actions.ts
导入导出             -> infrastructure/ + app/workbook-actions.ts
构建/发布             -> vite.config.ts + .github/workflows/deploy-pages.yml
```

不要把新的业务规则直接堆进 `src/app.ts`、UI 组件或 `scheduling-kernel.ts` 入口；先找到拥有该业务事实的职责模块，再由中央管线接入。
