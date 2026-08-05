# GitHub 开源排班项目与求解器使用方式调研

> 调研日期：2026-08-05
>
> 调研范围：机场人员/机组排班、员工和护士倒班、工厂任务排程、设备维护排程，以及只提供班表管理但不自动求解的系统。
>
> 证据原则：项目状态、许可证和实现方式只引用官方 GitHub 仓库、官方文档、官方发布页和实际源码。Stars 是调研当天的快照，会继续变化。

本报告只把 MIT 或 Apache-2.0 社区版能力计入推荐；需要商业许可证、付费版本或云端付费服务的能力不作为可用方案。

## 先说结论

对于当前约 15 人、每天不超过 10 个航班、只排当前一天的项目，**把所有岗位和所有合格人员一起求解是成熟求解器的标准用法**。这个规模长期出现 30 秒超时，不应简单归因于“全局排班本来就慢”，更应先检查模型怎样表示人员冲突、岗位组合和多层目标。

这次源码对照后的推荐顺序是：

1. **先保留现在的 HiGHS 和纯浏览器离线方式，做两项不改规则的实验。** 第一项是在条件目标的前后两批求解之间复用同一个 HiGHS 模型，并把前一批的完整结果作为下一批起点；第二项是继续压缩 `combinationModel`，先按时间建立索引，只比较真的可能形成衔接或负荷组合的岗位。
2. **同时做一个小型 OR-Tools CP-SAT 对照原型，而不是立即替换。** OR-Tools 对“一个岗位选一个人、一个人不能同时做两个岗位、人员有资质、存在连续与公平规则”更直接；但官方没有 JavaScript/WebAssembly 版本，接入当前网页需要本机 EXE 或后端，会明显增加开发和运行难度。
3. **Timefold 适合规则很多、经常临时变动的长期 Java 后端系统，但不是当前最省事的迁移目标。** 它的规则表达、滚动修改和人工锁定很成熟；不过官方员工排班示例按 30 秒返回时间内最好方案，并不保证已经证明所有目标最优，这与当前“没有全部最优就不采用”的合同不同。
4. **不要照搬 GitHub 上任何一个项目。** 有些高 star 项目只是手工班表管理；有些排班示例接受 `FEASIBLE`（找到可用方案但未证明最好）；还有些把全部偏好放进一个大权重总分。它们都不能直接满足当前严格的“督导 → 一号 → 申报 → 送资料”优先顺序。

## 已克隆的仓库

参考源码位于根目录 `clone/`。10 个仓库总占用约 509.7 MB，均已通过 Git 仓库连通性检查。

| 本地目录                     | 官方仓库                                                                                | 2026-08-05 状态                                                                                                           | 协议                                                                                                                       | 本次定位                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `clone/or-tools`             | [google/or-tools](https://github.com/google/or-tools)                                   | 13,856 stars；未归档；最新正式版 [v9.15](https://github.com/google/or-tools/releases/tag/v9.15)（2026-01-12）             | [Apache-2.0](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/LICENSE)                     | 最重要的 CP-SAT 对照                     |
| `clone/timefold-solver`      | [TimefoldAI/timefold-solver](https://github.com/TimefoldAI/timefold-solver)             | 1,741 stars；未归档；最新正式版 [v2.4.0](https://github.com/TimefoldAI/timefold-solver/releases/tag/v2.4.0)（2026-07-30） | [Apache-2.0](https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/LICENSE.txt)      | 规则型/持续优化求解框架                  |
| `clone/timefold-quickstarts` | [TimefoldAI/timefold-quickstarts](https://github.com/TimefoldAI/timefold-quickstarts)   | 574 stars；未归档；本地提交对应 2.4.0                                                                                     | [Apache-2.0](https://github.com/TimefoldAI/timefold-quickstarts/blob/1b38f00ede91e069429dd2a2c7545821fe9fd23e/LICENSE.txt) | 员工、机组、维护三个完整示例             |
| `clone/highs`                | [ERGO-Code/HiGHS](https://github.com/ERGO-Code/HiGHS)                                   | 1,769 stars；未归档；最新正式版 v1.15.1（2026-07-02）                                                                     | [MIT](https://github.com/ERGO-Code/HiGHS/blob/04024d701f79feb8e2f18bc3df0dffc04ef05088/LICENSE.txt)                        | 当前求解器的一手依据                     |
| `clone/pyworkforce`          | [rodrigo-arenas/pyworkforce](https://github.com/rodrigo-arenas/pyworkforce)             | 86 stars；未归档；0.5.4（2026-06-26）；官方标注 beta                                                                      | [MIT](https://github.com/rodrigo-arenas/pyworkforce/blob/ca4892502d2d92cc996c9fde96293ff90b560426/LICENSE)                 | OR-Tools 员工排班薄封装                  |
| `clone/roster-wizard`        | [galojix/roster-wizard](https://github.com/galojix/roster-wizard)                       | 57 stars；未归档；2026-07 仍有维护提交                                                                                    | [MIT](https://github.com/galojix/roster-wizard/blob/b677c947c1f1acc1492effe1f2a7aa2d684e621a/LICENSE.md)                   | 有真实页面、请求和技能组合的 CP-SAT 应用 |
| `clone/optaplanner`          | [apache/incubator-kie-optaplanner](https://github.com/apache/incubator-kie-optaplanner) | 已归档的迁移快照；本地最后提交说明代码正在并入 Drools                                                                     | [Apache-2.0](https://github.com/apache/incubator-kie-optaplanner/blob/741992b410cbd03b9b7db79f575f13b9ec6becd0/LICENSE)    | 读取护士/机组案例和基准测试的历史参考    |
| `clone/unitime`              | [UniTime/unitime](https://github.com/UniTime/unitime)                                   | 346 stars；未归档；最新正式版 v4.9.135（2026-05-26）                                                                      | [Apache-2.0](https://github.com/UniTime/unitime/blob/dd58115328bfe5bac2efc2fa9ea886b83d127afa/LICENSE)                     | 成熟课程/教师排课系统，不是员工倒班模板  |
| `clone/staffjoy-v2`          | [Staffjoy/v2](https://github.com/Staffjoy/v2)                                           | 1,683 stars；README 明确写明 2019 年已废弃                                                                                | [MIT](https://github.com/Staffjoy/v2/blob/c34d2c7a5f5349c3e7a03b5ac52547664bd01ced/LICENSE)                                | 只有班表管理，不含核心自动优化器         |
| `clone/shift-scheduling-mip` | [lbiedma/shift-scheduling](https://github.com/lbiedma/shift-scheduling)                 | 78 stars；最后提交 2024-05                                                                                                | [MIT](https://github.com/lbiedma/shift-scheduling/blob/c484c303f47510c158c5921de229f56e7beb1cd5/LICENSE.txt)               | 简单 PuLP/MIP 教学项目，作为反例         |

### OptaPlanner 当前维护链说明

OptaPlanner 的仓库迁移较复杂，不能把本地 `clone/optaplanner` 当成最新官方入口。官方 [apache/incubator-kie-optaplanner](https://github.com/apache/incubator-kie-optaplanner) 已归档，README 说明源码并入 Drools；该地址随后又指向活跃的 [apache/incubator-kie](https://github.com/apache/incubator-kie) 单仓库。当前 Apache KIE 已发布 [10.2.0](https://github.com/apache/incubator-kie/releases/tag/10.2.0)（2026-04-28），当前 `clone/optaplanner` 只用于阅读保留下来的成熟示例和基准配置，不建议作为新项目依赖入口。

## 1. OR-Tools CP-SAT：最值得做对照实验

### 标准员工排班怎样建模

Google 官方[员工排班教程](https://developers.google.com/optimization/scheduling/employee_scheduling)和对应 [`nurses_sat.py`](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/ortools/sat/samples/nurses_sat.py#L39) 使用一个最直接的 0/1 变量：

`x[人员, 日期, 班次] = 1` 表示这个人承担这个班次。

然后一次把全部人员和班次放入同一模型：

- 每个班次恰好一个人：`ExactlyOne`；
- 每人每天最多一个班次：`AtMostOne`；
- 公平不是“看起来差不多”，而是把每个人总次数限制在总席位的向下取整与向上取整之间，因此差值最多 1；
- 有偏好时，再把满足请求的数量作为目标。

这证明“15 人与几十个当天岗位同时考虑”本身完全正常。真正决定速度的是候选变量、冲突表达和目标数量。

### 更完整的倒班示例

官方 [`shift_scheduling_sat.py`](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/examples/python/shift_scheduling_sat.py#L295) 比简单护士示例更接近工厂/生产倒班：

- 变量是 `work[员工, 班次, 日期]`；
- 人工固定班次直接写成 `work == 1`，不是额外写一套排班算法；
- 连续上班天数、每周最少/最多班次都有“绝对不可突破范围”和“尽量做到范围”；
- 夜班接早班等不良衔接单独表达；
- 覆盖人数与超额人数分开；
- 默认求解时间就是 10 秒；
- 示例接受 `FEASIBLE` 或 `OPTIMAL`，并输出每种惩罚的实际值。

值得借鉴的是规则分层表达；不能直接照搬的是它最终把软规则加成一个总分。当前项目要求前一类公平不能被后一类补偿，因此仍需逐层求解并锁住上一层最优值。

### 机场和工厂场景的全局约束

OR-Tools 源码还提供了几种很适合当前项目的表达方式：

- [`gate_scheduling_sat.py`](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/examples/python/gate_scheduling_sat.py#L70) 把任务表示为时间区间，用“可选区间”决定在哪个资源上执行，再用 `NoOverlap` 一次说明同一资源不能同时做两件事。这个示例名称虽叫 Gate Scheduling，但源码是抽象的双资源任务，不是完整机场登机口系统；可借它的冲突表达，不能照抄业务。
- [`flexible_job_shop_sat.py`](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/examples/python/flexible_job_shop_sat.py#L133) 让每个工序在多个合格机器中恰选一个，再对每台机器做 `NoOverlap`。这与“每个岗位在多个有资质人员中恰选一个，每个人的重叠岗位不能同时选”高度相似。
- [`jobshop_with_maintenance_sat.py`](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/examples/python/jobshop_with_maintenance_sat.py#L63) 把机器不可用期也作为区间放进同一个冲突集合。对应到人员排班，就是把请假、恢复时段或硬锁定当成已占用时间。
- [`crew.py`](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/examples/contrib/crew.py#L21) 同时考虑 20 名乘务员、10 个航班、人数、语言资质和飞完后休息两个航班。它使用的是旧 Constraint Solver API，只适合读业务建模，不应照抄技术接口；新实现应使用 CP-SAT。

### 时间、旧班表和无解诊断

- 官方[限制求解时间](https://developers.google.com/optimization/cp/cp_tasks)使用 `max_time_in_seconds`。官方[状态说明](https://developers.google.com/optimization/cp/cp_solver)区分 `OPTIMAL`、`FEASIBLE`、`INFEASIBLE` 和 `UNKNOWN`：超时未找到解是 `UNKNOWN`，不能误报成已证明无解。
- [`add_hint()`](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/ortools/sat/python/cp_model.py#L1650) 可以把上一版解当成搜索起点，但不会锁死人选。人工锁定则直接加 `x == 1`。这正好符合“质量优先、不要求保持旧人选”的当前方向。
- [`add_assumption()` 与 sufficient_assumptions_for_infeasibility()`](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/ortools/sat/python/cp_model.py#L1668) 可以给规则组贴标签，并在证明无解时返回一组足以造成冲突的标签。应用仍需维护“标签 → 中文业务规则”映射，它不会自动说出“缺少某岗位资质人员”。
- [CP-SAT 参数](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/ortools/sat/sat_parameters.proto#L693)支持多工作线程；但线程越多不等于一定越快，必须用相同真实数据做重复基准。

### 接入当前项目的现实限制

OR-Tools 官方 [README](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/README.md)提供 C++、Python、Java 和 .NET 包装，没有官方 JavaScript/WebAssembly 包。因此它不能像当前 HiGHS 一样直接放进纯浏览器。可行形态只有：

- Python/C++ 打包成本机 EXE，网页调用本机服务；
- Java/Python 后端提供本机或局域网 API；
- 自行维护非官方 WebAssembly 移植。

前两种开发和发布难度高于继续使用 HiGHS；第三种对当前项目和编程小白最不合适。

## 2. Timefold：规则表达与滚动重排最成熟

### 员工排班示例

Timefold 官方员工排班 quickstart 把 `Shift` 作为待安排对象，把 `Employee` 作为它唯一会变化的值，见 [`Shift.java`](https://github.com/TimefoldAI/timefold-quickstarts/blob/1b38f00ede91e069429dd2a2c7545821fe9fd23e/use-cases/employee-scheduling/src/main/java/org/acme/employeescheduling/domain/Shift.java#L15)。[`EmployeeSchedulingConstraintProvider.java`](https://github.com/TimefoldAI/timefold-quickstarts/blob/1b38f00ede91e069429dd2a2c7545821fe9fd23e/use-cases/employee-scheduling/src/main/java/org/acme/employeescheduling/solver/EmployeeSchedulingConstraintProvider.java#L31)明确分为：

- 硬规则：岗位技能、时间重叠、两班至少间隔 10 小时、每天最多一个班、不可用日期；
- 软规则：不希望/希望上班日期、人员班次数公平。

公平实现有一个特别值得当前项目核对的细节：它使用 `complement(Employee.class, e -> 0L)`，把一次都没排到的人也以 0 次放进公平比较，然后计算整体不公平度。这样不会出现“只比较已经上过该岗位的人，把 0 次人员漏掉”的错误。

### 机场机组与维护示例

- [`FlightCrewSchedulingConstraintProvider.java`](https://github.com/TimefoldAI/timefold-quickstarts/blob/1b38f00ede91e069429dd2a2c7545821fe9fd23e/use-cases/flight-crew-scheduling/src/main/java/org/acme/flighcrewscheduling/solver/FlightCrewSchedulingConstraintProvider.java#L20)处理必需技能、航班重叠、相邻航班转场、人员不可用，以及首末航班是否回到基地。它与当前机场地勤的共同点是资格、时段、前后衔接；不同点是当前岗位不涉及跨机场转场，不能把机组规则原样搬来。
- [`MaintenanceScheduleConstraintProvider.java`](https://github.com/TimefoldAI/timefold-quickstarts/blob/1b38f00ede91e069429dd2a2c7545821fe9fd23e/use-cases/maintenance-scheduling/src/main/java/org/acme/maintenancescheduling/solver/MaintenanceScheduleConstraintProvider.java#L21)处理同一班组不能同时做两个维护任务、允许开始/结束窗口和理想完成时间。它说明成熟系统会把资源冲突与质量目标分开，但示例用 `1`、`1,000`、`1,000,000` 大权重排列软规则，不符合当前禁止综合大权重的合同。

三个 quickstart 的生产配置都把求解时间设为 30 秒，见员工示例 [`application.properties`](https://github.com/TimefoldAI/timefold-quickstarts/blob/1b38f00ede91e069429dd2a2c7545821fe9fd23e/use-cases/employee-scheduling/src/main/resources/application.properties#L5)。它们通过异步 job 启动求解，并在 [`EmployeeScheduleResource.java`](https://github.com/TimefoldAI/timefold-quickstarts/blob/1b38f00ede91e069429dd2a2c7545821fe9fd23e/use-cases/employee-scheduling/src/main/java/org/acme/employeescheduling/rest/EmployeeScheduleResource.java#L62)的 best-solution 事件里持续保存当前最好方案。

Timefold 默认采用“先快速构造一个完整方案，再通过换人/交换持续改进”的阶段，官方[优化算法说明](https://docs.timefold.ai/timefold-solver/latest/optimization-algorithms/overview)把它称为 Construction Heuristic 与 Local Search。它不会预先枚举所有完整班表。

这是一种成熟运行模式，但与当前合同有关键差别：Timefold 示例在时间到时可以返回“目前最好”；当前项目只有所有业务目标都证明最优才采用，超时丢弃整个结果。未经 owner 正式修改 `spec.md`，不能把 Timefold 的做法静默搬进来。

### 严格优先级、人工锁定和动态变化

- Timefold 的 [`BendableScore`](https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/core/src/main/java/ai/timefold/solver/core/api/score/BendableScore.java#L277)逐层比较多个硬分和软分：前一层不同就立即返回，不会让后一层补偿前一层。若以后采用 Timefold，当前“督导 → 一号 → 申报 → 送资料”应使用多个分层，不应继续用大权重猜比例。
- [`@PlanningPin`](https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/core/src/main/java/ai/timefold/solver/core/api/domain/entity/PlanningPin.java#L13)让人工锁定的班次永远不被求解器移动。
- [`ProblemChange`](https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/core/src/main/java/ai/timefold/solver/core/api/solver/change/ProblemChange.java#L13)支持求解过程中增加/删除人员或任务并重新继续，但官方源码明确提醒要批量提交变化；变化过密会让求解器不断重启，来不及产生新方案。
- Timefold 官方[持续规划说明](https://docs.timefold.ai/timefold-solver/latest/responding-to-change/continuous-planning)把数据分为历史、已发布和草稿窗口，并明确提醒不要把多年全部历史都装进求解问题。对应当前项目，只应传入仍会影响本班的月度次数、最近恢复窗口和必要历史常量，而不是把几千条旧班表格子都变成求解变量。
- 当前 Timefold 源码把 `SolutionManager.analyze()` 的详细 score analysis 标为 Enterprise Edition，见 [`SolutionManager.java`](https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/core/src/main/java/ai/timefold/solver/core/api/solver/SolutionManager.java#L135)。本项目要求免费，因此不能把企业版诊断能力算进推荐收益。

还有一个不能混淆的状态差异：Timefold 会持续给出当前最高分方案；如果没有可行方案，最高分方案仍可能带硬规则扣分，调用方必须检查 score 是否 feasible。它不像 CP-SAT 那样给出“已证明 INFEASIBLE”的同类结论。因此当前项目的免费、用户可读无解诊断仍需自己维护。

### 为什么不作为第一步迁移

Timefold Community Edition 本身是 Apache-2.0、免费且活跃，但它需要 Java/Kotlin 后端。其优势是大量规则可以用业务对象和索引连接表达，并能持续改进现有方案；代价是新增 Java 服务、接口、打包、进程管理、数据同步和错误恢复。当前源码还把单次求解的多线程能力列为企业功能，不能把付费版速度宣传算进免费方案。对当前单机浏览器项目，这比做 OR-Tools 小型本机服务还要重。

## 3. HiGHS：当前用法并没有走错，重点在模型结构

HiGHS 是通用线性/混合整数求解器，不是专门的排班框架。当前用 0/1 变量表示“人员是否承担岗位”是正确的 MIP 建模；它缺少 OR-Tools 的 `NoOverlap` 这类时间专用表达，因此应用层需要自己生成冲突关系，模型结构更容易膨胀。

当前项目已经正确使用了官方成熟能力：

- 官方[多目标文档](https://github.com/ERGO-Code/HiGHS/blob/04024d701f79feb8e2f18bc3df0dffc04ef05088/docs/src/guide/further.md#L133)说明 `blend_multi_objectives=false` 时，HiGHS 按 priority 从高到低求解，每完成一层就加约束锁住该层，再求下一层；当前项目正使用这种原生分层模式，并把容差设为 0。
- 官方 [`multi_objective.py`](https://github.com/ERGO-Code/HiGHS/blob/04024d701f79feb8e2f18bc3df0dffc04ef05088/examples/multi_objective.py#L38)同时展示手工逐层锁定和内置分层求解，证明当前设计不是自创接口。
- 官方选项默认开启 presolve 和 MIP 对称性检测，见 [`definitions.md`](https://github.com/ERGO-Code/HiGHS/blob/04024d701f79feb8e2f18bc3df0dffc04ef05088/docs/src/options/definitions.md#L3)。

### 当前最值得做的三个实验

1. **条件目标之间复用同一个 HiGHS 模型。** 当前 [`solveNativeLexicographic()`](../../src/infrastructure/solver/highs-solver.ts#L292)会把普通目标先成批求解，再根据前一批结果决定是否求解三个工作量差值目标；但每一批都会重新 `NativeHiGHS.create()` 并再次传入完整模型。项目自己的 WebAssembly 封装已经提供 [`addRows()` 与 `setSolutionValues()`](../../vendor/highs-ts/src/solver.ts#L282)。可以按 HiGHS 官方手工分层示例的方式，只装载一次模型：清除上一批目标、追加上一批最优值锁定、把上一批完整解设为下一批起点，再继续求解。这不会锁定人员，也不改变目标顺序或最优值，是最直接的适配层性能实验。
2. **组合模型按时间索引剪枝。** 当前 `src/domain/kernel/daily-schedule-optimizer.ts` 已经只为合格人员创建变量，也会把同航班和两组完全冲突的候选压成一个约束；但 `combinationModel` 仍对每个人的 choices 做两层循环，再检查衔接、恢复和滚动负荷。成熟做法不是让所有组合先生成再交给求解器，而是先按开始/结束时间和航班分桶，只枚举真正可能连续、重叠或触发窗口的组合。
3. **只把旧方案作为 MIP 起点，不增加“保持旧人选”目标。** HiGHS 官方 [`knapsack.py`](https://github.com/ERGO-Code/HiGHS/blob/04024d701f79feb8e2f18bc3df0dffc04ef05088/examples/knapsack.py#L20)展示 `setSolution` 提供完整或部分初始解。可以把同一天重排前仍然合法的部分结果当起点实验；它只是帮助更快找到好解，不锁人，也不改变质量目标。由于当前仍要求证明 `OPTIMAL`，MIP 起点是否能显著缩短总时间必须用真实 6/8/10 航班夹具测量，不能凭感觉上线。

HiGHS 的 IIS 无解集合功能在当前官方文档中仍标注主要用于 LP，不能直接依赖它解释含大量 0/1 变量的排班 MIP。当前继续维护业务级候选拒绝原因仍有必要。

## 4. PyWorkforce 与 Roster Wizard：接近业务，但不是性能标杆

### PyWorkforce

PyWorkforce 官方 README 明确标注 beta。它的 [`MinHoursRoster`](https://github.com/rodrigo-arenas/pyworkforce/blob/ca4892502d2d92cc996c9fde96293ff90b560426/pyworkforce/rostering/binary_programming.py#L7)使用 OR-Tools CP-SAT，支持：

- 每天/班次所需人数；
- 每人每天最多一个班；
- 禁止人员在某日上某班；
- 夜班后不能接早班一类非连续规则；
- 每人最少工时、最大休息天数；
- 班次偏好和人员偏好权重；
- 时间上限和搜索线程数。

它适合学习“薄业务层怎样包装 CP-SAT”，但目标只是最少总工时减去偏好奖励，没有当前的岗位级资质、当日多航班重叠、严格公平层级和特殊锁定。它同样接受 `FEASIBLE`。

### Roster Wizard

Roster Wizard 是这批项目里少数既有真实 Django 页面、人员请求、技能组合规则，又实际调用 CP-SAT 的完整应用。其 [`logic.py`](https://github.com/galojix/roster-wizard/blob/b677c947c1f1acc1492effe1f2a7aa2d684e621a/roster_wizard/rosters/logic.py#L183)按人员、角色、日期、时段创建变量，固定上一周期、排除请假、控制人数并最大化人员请求；求解时间上限是 120 秒，`FEASIBLE` 和 `OPTIMAL` 都采用。后台通过 [`tasks.py`](https://github.com/galojix/roster-wizard/blob/b677c947c1f1acc1492effe1f2a7aa2d684e621a/roster_wizard/rosters/tasks.py#L1)交给 Celery 异步执行。

它的业务完整度值得参考，但只有 57 stars，默认时限也远高于当前 30 秒，不应把它当作性能或质量基准。源码还使用较宽的人员×角色×日期×时段变量组合，当前已有的合格候选稀疏建模反而更适合本项目。

## 5. OptaPlanner：历史案例和基准测试值得保留

本地 OptaPlanner 护士排班示例覆盖技能、每天一个班、连续工作/休息天数、完整周末、上班/休班请求等大量真实规则，见 [`NurseRosteringConstraintProvider.java`](https://github.com/apache/incubator-kie-optaplanner/blob/741992b410cbd03b9b7db79f575f13b9ec6becd0/optaplanner-examples/src/main/java/org/optaplanner/examples/nurserostering/score/NurseRosteringConstraintProvider.java#L60)。

本次还逐字核对了护士排班的 constraint provider、岗位实体、pinning filter 和 solver config；本地迁移快照与当前 Apache KIE 单仓库中的对应文件一致。因此这些具体示例仍可读，但新增依赖应从当前 Apache KIE 发布链评估。

其 [`nurseRosteringSolverConfig.xml`](https://github.com/apache/incubator-kie-optaplanner/blob/741992b410cbd03b9b7db79f575f13b9ec6becd0/optaplanner-examples/src/main/resources/org/optaplanner/examples/nurserostering/nurseRosteringSolverConfig.xml#L35)采用两阶段：先快速构造完整班表，再通过单人换岗、两人交换、连续岗位块移动/交换继续改进。这解释了成熟规则型求解器为何不只尝试“逐格塞人”。人工/历史窗口以 pinning filter 排除在移动范围外。

更值得当前项目借鉴的是 benchmark 方式，而不是迁移旧库：仓库包含真实 nurse 数据、warmup、10 秒限时和多算法对照配置。当前性能测试也应固定 6/8/10 航班、行政支援开/关、同一历史窗口，分别记录：

- 建模时间；
- 变量数、约束数、非零系数数；
- 每个目标层耗时；
- 最终状态与质量向量；
- 重复多次的中位数和最慢值。

只看一次“总共几秒”无法判断是建模膨胀、WASM 启动、第一层可行性，还是后面的公平目标证明最优耗时。

## 6. 哪些项目不能当自动排班求解参考

- **Staffjoy V2**：README [明确标注 deprecated](https://github.com/Staffjoy/v2/blob/c34d2c7a5f5349c3e7a03b5ac52547664bd01ced/README.md#L7)，源码提供班次增删、人员和通知等管理功能，但没有核心自动优化器。它的高 star 不能证明排班算法成熟。
- **UniTime**：官方 [README](https://github.com/UniTime/unitime/blob/dd58115328bfe5bac2efc2fa9ea886b83d127afa/README.md)说明它是大学课程、考试、学生和教师排课系统。它很成熟，但面向教室、课程选择和学生冲突，部署体系庞大，不适合 15 人机场当天班表。只可参考“求解、人工修改、发布结果”分离的产品流程。
- **shift-scheduling-mip**：[`model.py`](https://github.com/lbiedma/shift-scheduling/blob/c484c303f47510c158c5921de229f56e7beb1cd5/model.py#L42)是 PuLP 的固定 4 小时时段教学模型；README 自述约一分钟，没有明确求解时限、严格状态处理或多目标公平。不能用它证明 MIP 适合或不适合当前项目。
- **OptaWeb Employee Rostering**：官方仓库 [kiegroup/optaweb-employee-rostering](https://github.com/kiegroup/optaweb-employee-rostering)的描述直接写明“不再维护”。可读旧交互设计，不应作为新依赖。

## 当前项目的本机性能基线

2026-08-05 在当前工作区运行 `npm.cmd run test:performance -- --reporter=verbose`，11 个性能测试全部通过。本机实际记录包括：

- 15 人、10 航班、40 个岗位：约 1.58 秒；
- 15 人、8 航班、32 个密集岗位：约 1.01 秒；
- 32 个岗位并带 5000 条历史记录：约 3.10 秒；
- 10 航班、5000 条历史记录，并连续切换行政支援模式计算 6 次：总计约 30.46 秒。

这组结果说明当前版本在标准夹具下没有“航班一多就必然超时”的普遍问题，也没有证据支持立即更换求解器。但夹具不能代替 owner 的真实航班、资质和规则组合；真实慢例仍应匿名固化后记录建模时间、模型规模和每层求解时间，再判断上述哪项实验有十几秒级收益。

## 可以直接落到当前项目的成熟做法

| 问题                   | 成熟项目做法                                                                      | 当前项目情况                                   | 建议                                                             |
| ---------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| 不合格组合太多         | 只创建合格替代项；每个任务恰选一个                                                | 已按资质预筛 StaffChoice                       | 保留，不退回完整人员×岗位矩阵                                    |
| 时间冲突组合膨胀       | OR-Tools 对每个资源用可选区间 + `NoOverlap`；Timefold 用 indexed overlapping join | 已压缩同航班和整组完全冲突；部分组合仍两两扫描 | 先做时间索引/最大冲突组压缩，再比较 OR-Tools 原型                |
| 多条公平规则互相顶掉   | 分层分数或逐层求解，先锁前一层                                                    | 已用 HiGHS 原生分层且零容差                    | 保留；禁止随意改为一个大权重总分                                 |
| 0 次人员被公平统计漏掉 | Timefold 显式把未分配人员补成 0                                                   | 当前重点岗位规则要求所有合格人员滚动一轮       | 核心测试必须包含“4 次对 0 次”一类夹具                            |
| 航班变动后重新排       | 硬锁人工项；旧解只作 hint/MIP start                                               | 当前不要求保持旧班表人员不变                   | 可实验起点，不增加“少换人”目标                                   |
| 无解误报               | 区分模型错误、已证明无解、超时未知；规则标签映射业务原因                          | 当前已有业务拒绝原因，超时整单失败             | OR-Tools 原型用 validate + assumptions；HiGHS 路线继续业务级诊断 |
| 计算过程卡页面         | 后台 job/Worker；阻止并发修改；始终释放资源                                       | 当前已有 Web Worker 生命周期                   | 保留，不为换求解器重写 UI 规则                                   |
| 性能结论不稳定         | 固定真实数据、warmup、多次重复、分阶段指标                                        | 已有性能测试，但需继续看模型各阶段             | 先补指标，再决定是否迁移                                         |

## 建议的 OR-Tools 对照原型形状

这只是后续验证方案，不是本次已经实现的功能：

1. 每个当天岗位任务一个对象；只为实际合格的“岗位-人员”组合创建 0/1 变量和固定时间可选区间。
2. 每个岗位对“合格人员变量 + 空缺变量”做 `ExactlyOne`。
3. 每个人把所有普通候选区间放进一个 `NoOverlap`；明确允许的同航班督导兼任单独建例外，不扩大语义。
4. 资质、状态、夜班、每日工时、值班/KE166 锁定和严格衔接继续是硬规则。
5. 按现有中央合同逐层求解：岗位完整性 → 督导公平 → 一号公平 → 申报 → 送资料 → 恢复/疲劳/普通衔接。每层只有得到 `OPTIMAL` 才锁住最优值进入下一层；全程共享 30 秒 deadline，并把上一层结果作为下一层 hint。
6. 人工固定写硬等式；未固定的旧班表只作 hint，不加入“保持旧人选”目标。
7. 规则组使用 assumptions，并维护规则 ID 到简洁中文原因的映射。
8. 用同一批匿名真实夹具与当前 HiGHS 比较质量向量和时间，至少覆盖 6、8、10 航班及行政支援开/关。

只有当 OR-Tools 在相同硬规则、相同严格优先级、相同“不接受未证明最优结果”条件下，稳定减少十几秒或解决 30 秒超时，迁移才有事实依据。

## 不应照搬的做法

- 不接受“找到一个能用的班表就算成功”，除非 owner 正式授权修改当前质量合同。
- 不用姓名特例、任意大权重或“最后谁排到都行”的随机兜底掩盖规则冲突。
- 不为 15 人的单日排班引入 UniTime 级别的分布式系统。
- 不把 Staffjoy 一类班表管理页面当成自动求解器。
- 不把 OR-Tools 旧 `constraint_solver` crew 示例当成 CP-SAT 新接口。
- 不因为某个 GitHub 示例跑得快就认为当前真实规则也会快；示例约束远少于当前项目。
- 不先换求解器再补基准。必须先记录当前模型规模与质量，迁移后才能知道究竟变好还是只是规则少了。

## 最终建议

**短期最优解：继续 HiGHS，但按成熟排班项目的方式优化求解过程和模型输入。** 第一优先是让条件目标复用同一个模型和上一批解，第二优先是对 `combinationModel` 做按时间/航班索引的等价剪枝，第三优先是同一天重排的无锁定 MIP start 对照实验，随后补齐分阶段模型指标。这些实验不改变现有业务顺序，也不要求新增后端。

**中期最有价值的技术验证：OR-Tools CP-SAT 本机服务或 EXE 原型。** 从求解问题类型看，CP-SAT 的 `ExactlyOne`、可选区间和 `NoOverlap` 比通用 MIP 更贴近机场岗位排班；从项目形态看，它又比当前 HiGHS 难接入。应先用真实 10 航班数据证明确有十几秒级收益，再决定是否承担这部分开发复杂度。

**Timefold 保留为未来后端化、规则继续大幅增长时的方案。** 它最值得借的是规则索引、分层分数、人工 pin、动态 problem change 和 benchmark 方法，而不是现在直接把整个网页改成 Java 系统。
