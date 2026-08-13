# HiGHS 分层排班与负荷均衡超时研究

研究日期：2026-08-11

## 结论摘要

这次超时不能简单归结为“8 个航班正常就要算很久”，也不能仅靠继续增加秒数解决。

已确认有两个不同层面的问题：

1. **真实慢点是负荷均衡中的“当天疲劳差额”最优性证明。** 使用 owner 提供的 `排班工具配置 (5).xlsx` 复现时，模型包含 1302 个变量、1516 条约束和 26 个字典序目标；前 21 层完成后，第 22 层 `candidate:workload-balance:today-fatigue-excess` 用尽求解时间。关闭全部负荷均衡目标后，同一状态约 49.4 秒得到最优解。这说明航班数量只是放大搜索空间，当前直接卡住的是低优先级疲劳公平层。
2. **当前 120 秒总时限没有按产品合同真正执行。** HiGHS 原生字典序 MIP 会为每个目标新建一次 MIP 求解器，每层使用独立计时器。项目在一个批次开始时只设置一次“剩余 120 秒”，却一次传入 20 多个目标；这实际表示“每层最多 120 秒”，而不是“整次排班最多 120 秒”。理论最坏时间接近目标层数乘以 120 秒。

因此，**长时间证明低优先级疲劳目标最优是正常的组合优化风险，但当前时限用法本身也有实现缺陷**。把 120 秒改成 300 秒会同时把每一层的上限放大到 300 秒，不能建立可靠的整次计算边界。

在不修改现行 `spec.md` 业务语义的前提下，最成熟的处理顺序是：

1. 先把原生多目标批次改为逐目标执行，继续复用同一模型、目标锁定和上一层 MIP start，并在每层按应用剩余墙钟时间设置 `time_limit`。
2. 每次重复 `Highs_run` 前调用官方 `Highs_zeroAllClocks`，修正累计主时钟重复扣时。
3. 暴露每层节点数、上下界、gap、求解时间和可行解状态，确认疲劳层究竟卡在找解还是证明下界。
4. 在真实夹具上依次验证 HiGHS 升级、疲劳量整数化、变量界收紧、空目标/常量目标删除；每项都必须保持完整业务目标向量最优。
5. 只有 owner 愿意正式修改 `spec.md` 时，才能采用 Timefold、OR-Tools 常见的“有限时间返回最佳可行方案”或合并低优先级公平分数。

## 本项目的已确认事实

### 真实复现

本轮诊断使用 owner 指定的真实配置文件和当前排班入口，得到：

| 项目                      | 结果                                                    |
| ------------------------- | ------------------------------------------------------- |
| 航班规模                  | 当前增加后的 8 个航班状态                               |
| 模型规模                  | 1302 个变量、1516 条约束                                |
| 目标层数                  | 26 层                                                   |
| 120 秒结果                | 在第 22 层 `today-fatigue-excess` 超时                  |
| 去掉负荷均衡目标          | 约 49.4 秒，`optimal`                                   |
| 删除完全重复的 `CX937` 后 | 120 秒内仍未完成，墙钟约 154.9 秒后返回超时             |
| 原始数据改用 300 秒预算   | 墙钟约 302.6 秒，完成前 22 层后仍未完成后续 spread 目标 |
| 仅收紧安全负荷上界        | 120 秒内仍未完成，不足以单独解决慢点                    |
| 当前慢点性质              | 已找到更高层最优结果后，继续证明疲劳差额的全局最优      |

诊断时临时创建了 `tests/performance/current-state-solver-diagnostic.test.ts`。该文件含真实本机路径和真实配置依赖，已在收口时删除，没有原样进入长期 CI；后续应把这个场景匿名化为仓库内固定输入。

真实工作簿的 `航班计划` 中还有两行航班号、时段、岗位和备注完全相同的 `CX937 08:30-10:30`。这是应由排班员确认的数据问题；它会放大模型，但去重对照仍超时，因此不是本次性能问题的唯一根因。

### 当前产品合同

`spec.md` 当前明确规定：

- 所有业务质量目标都必须保持最优；
- 每层按中央规则合同逐项锁定，不允许换成跨规则综合权重；
- 整次当天模型最多 120 秒；
- 超时不采用中间结果，也不返回部分班表。

所以在现行合同下，低优先级疲劳层尚未证明最优时，系统只能宣告整次失败。不能一边跳过该层，一边仍声称所有目标已经最优。

### 当前负荷均衡模型

`src/domain/kernel/daily-schedule-model.ts:524-699` 为 `today-hours`、`rolling-hours` 和 `today-fatigue` 各建立四个连续辅助变量：

- `maximum`：不小于每个人的负荷；
- `minimum`：不大于每个人的负荷；
- `spread`：不小于 `maximum - minimum`；
- `excess`：不小于 `spread - target`。

随后依次最小化：

1. 三项配置目标是否能同时满足；
2. 当天工时超额；
3. 滚动工时超额；
4. 当天疲劳超额；
5. 仅在对应超额为 0 时继续最小化三个 spread。

这个 max/min 表达在数学上是正规的，但当前疲劳点以 0.5 为页面步长，辅助变量仍声明为连续变量。HiGHS 只有在目标中的非零变量都属于整数变量时，才会识别目标的离散步长并做整数目标界收紧。[HiGHS v1.13 `HighsObjectiveFunction.cpp`](https://github.com/ERGO-Code/HiGHS/blob/v1.13.0/highs/mip/HighsObjectiveFunction.cpp#L115-L123) 与 [`HighsMipSolverData.cpp`](https://github.com/ERGO-Code/HiGHS/blob/v1.13.0/highs/mip/HighsMipSolverData.cpp#L570-L595) 展示了这一路径。

因此“把疲劳辅助变量按 0.5 缩放成整数”是值得验证的精确建模候选，但目前还不能直接实施：必须先证明页面、Excel 导入、默认值和所有现行数据都严格落在同一离散格点上，并扩展当前只支持 `binary/continuous` 的中性求解变量合同。未经这项证明，整数化会改变可接受输入和业务结果。

## HiGHS 原生字典序实际上如何工作

### 每层都是一次新的 MIP 最优性证明

HiGHS 的原生字典序流程不是“一次分支搜索同时证明 26 个目标”：

1. 按 priority 从高到低排列目标；
2. 为当前目标调用一次 `optimizeModel()`；
3. 当前层只有达到 `kOptimal` 才继续；
4. 把当前最优值变成下一层的锁定约束；
5. 把当前 MIP 解作为下一层的初始解。

官方 v1.13 源码见 [`HighsInterface.cpp`](https://github.com/ERGO-Code/HiGHS/blob/v1.13.0/highs/lp_data/HighsInterface.cpp#L4054-L4321)，v1.15.1 仍采用同一结构。上一层解只是 MIP start；分支树、cuts、节点队列和 presolve 结果不跨层复用。

这表示 26 个严格目标最多会触发 26 次完整 MIP 最优性证明。20 多层在语义上受支持，但性能风险是结构性的。

### `time_limit` 对 MIP 是逐层计时

HiGHS 每次 `callSolveMip()` 都新建 `HighsMipSolver`，而该对象拥有独立计时器。v1.15.1 源码甚至明确注释该 timer 独立于外层 `Highs` timer：[`HighsMipSolver.cpp`](https://github.com/ERGO-Code/HiGHS/blob/v1.15.1/highs/mip/HighsMipSolver.cpp#L95-L101)。MIP 超时检查直接拿这个本地计时器与同一个 `options.time_limit` 比较：[`HighsMipSolverData.cpp`](https://github.com/ERGO-Code/HiGHS/blob/v1.13.0/highs/mip/HighsMipSolverData.cpp#L2541-L2548)。

项目当前 `solveNativeLexicographic()` 在批次开始时执行一次：

```ts
highs.setParam("time_limit", remainingMs / 1000);
highs.passLinearObjectives(objectives);
await highs.solve();
```

如果 `objectives` 有 22 层且 `remainingMs` 为 120 秒，HiGHS 的 MIP 语义不是整批共用 120 秒，而是每一层都可使用至多 120 秒。浏览器 Worker 中的同步 WASM 调用也无法被 JavaScript 的普通计时器在函数中途抢占。

### 重复 `Highs_run` 还有另一种累计时钟问题

HiGHS C API 明确说明，同一个 `Highs` 实例的主时钟不会在每次 `Highs_run` 前自动清零；后续运行会累计此前时间。官方建议在重复运行前调用 `Highs_zeroAllClocks`：[`highs_c_api.h`](https://github.com/ERGO-Code/HiGHS/blob/v1.13.0/highs/interfaces/highs_c_api.h#L1326-L1351)。

当前实现会在条件目标出现时复用同一实例执行第二个批次，却再次把“剩余墙钟时间”直接写入 `time_limit`。这会让第一批的主时钟时间在第二批再次参与扣减。它不解释本次第一批疲劳层超时，但会缩短后续条件批次的真实预算。

两个计时问题必须一起修：

- 原生多目标内部的 MIP 本地 timer 让每层都获得整批预算；
- 多次 `Highs_run` 的外层主 timer 又会跨批累计。

### 超时结果不能无条件读取 solution

项目本地 `vendor/highs-ts/src/solver.ts:468-483` 对 `timelimit` 无条件读取 solution，却没有查询 `primal_solution_status`。官方状态合同中，MIP 超时可能有 incumbent，也可能根本没有可行解；是否可用必须检查 primal solution status，而不是只看 `timelimit`。

目前产品会丢弃所有超时方案，所以该缺陷没有造成“半成品班表被采用”；但包装层仍可能把无有效 incumbent 的 WASM 缓冲区读成 solution。修正适配器时应一并暴露并校验官方解状态。

## 成熟排班项目如何处理相同矛盾

### Timefold Solver

Timefold 官方文档指出，多数用例只有 hard/soft 两层，通常总共使用两到三个 score level；公平或负荷均衡不需要为每条约束单独建立许多层。[Score levels](https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/docs/src/modules/ROOT/pages/constraints-and-score/overview.adoc#L104-L165) 还明确警告，不要因为存在七条约束就建立七层 `BendableScore`。

其官方公平方案使用 `ConstraintCollectors.loadBalance(...)` 生成一个 `unfairness` 指标，而不是依次证明多个 max/min 公平层：[Load balancing and fairness](https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/docs/src/modules/ROOT/pages/constraints-and-score/load-balancing-and-fairness.adoc#L133-L175)。

同时，Timefold 明确把生产目标定义为“在可用时间内找到最佳方案”，而不是保证全局最优：[Optimization algorithms](https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/docs/src/modules/ROOT/pages/optimization-algorithms/overview.adoc#L43-L75)。

这些是成熟做法，但直接套用会同时改变两项现行产品事实：

- 合并公平层会改变当前严格的逐项优先级；
- 有限时间返回最佳方案会违反“超时不采用部分结果、所有目标必须最优”。

所以 Timefold 适合作为 owner 将来调整产品合同的参考，不是本轮无行为变化修复。

### Google OR-Tools

OR-Tools 官方员工排班示例把覆盖、连续班次、软上下限和请求偏好汇总为一个惩罚目标，默认求解时间为 10 秒，并接受 `OPTIMAL` 或 `FEASIBLE`：[官方示例](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/examples/python/shift_scheduling_sat.py#L289-L417)。这同样体现“硬约束必须满足，软质量在有限时间内尽量优化”的生产取舍。

OR-Tools 还有一条对本项目很有价值、且不必改变业务语义的官方结论：如果目标是整数，绝对 gap 小于 1 就足以证明真实最优。[`sat_parameters.proto`](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/ortools/sat/sat_parameters.proto#L360-L376) 明确记录了这一点。

这支持“先证明疲劳目标的最小离散步长，再使用小于该步长的绝对 gap 或整数目标界”的方向。关键是先证明离散格点，不能把普通近似 gap 冒充精确最优。

OR-Tools 官方没有浏览器 JavaScript/WASM 发行入口，直接迁移还会引入服务端或非官方运行包，并重做所有模型与等价验证，因此不是本次最小风险方案。

### HiGHS 新版本

项目本地 WASM 基于 HiGHS v1.13.0。HiGHS v1.14.0 官方发布说明确认，PR #2865 为 MIP presolve probing 增加日志和超时预算检查：[v1.14.0 release](https://github.com/ERGO-Code/HiGHS/releases/tag/v1.14.0)、[PR #2865](https://github.com/ERGO-Code/HiGHS/pull/2865)。当前最新本地对照源码为 v1.15.1。

升级是合理候选，因为它包含求解器修复和新的超时检查；但它不能保证解决本次疲劳目标的最优性证明，也没有改变“每个字典序 MIP 目标新建独立 solver/timer”的结构。必须用同一匿名真实夹具对照 v1.13 与 v1.15.1 的完整业务目标向量和耗时。

HiGHS 官方 issue #2478 还记录了某些 MIP 在 presolve 开启时极慢、关闭后反而很快的真实案例：[Issue #2478](https://github.com/ERGO-Code/HiGHS/issues/2478)。这说明 `presolve=off` 可以作为诊断实验，但不能全局盲目关闭；presolve 对多数模型仍然有益。

## 与现行规范兼容的技术路线

### 第一阶段：先修正求解边界

1. **每次只求一个字典序目标。** 同一 HiGHS 实例继续常驻，基础模型只传一次；每层完成后追加该目标的锁定行，再把上一层完整解作为 MIP start。HiGHS 原生字典序内部本来也采用“求一层、锁一层、传上一解”的方式，因此不损失其不存在的分支树复用。
2. **按整次 deadline 计算每层预算。** 每层开始前计算 `deadline - Date.now()`，仅把剩余时间交给当前这一层。达到 deadline 立即停止，不启动下一层。
3. **每次 `Highs_run` 前清零官方主时钟。** 暴露 `Highs_zeroAllClocks`，再设置本层剩余墙钟预算，避免重复运行累计时钟二次扣减。
4. **保留严格目标锁定。** 不放宽原生 `absTolerance: 0`、`relTolerance: 0`；若改用应用层锁定行，必须用语义等价测试证明目标向量与当前原生模式一致，不能顺手采用更宽容差。
5. **校验解有效性。** 包装层读取 `primal_solution_status`，只在官方确认存在可行解时返回 solution；产品层继续按规范拒绝超时中间方案。

这一步主要修复“120 秒究竟代表什么”，不会让困难疲劳层自动变快。它会使系统可靠地在整次 120 秒附近失败，而不是后台继续执行远超合同的时间。

### 第二阶段：建立每层证据

在求解器基础设施边界记录以下诊断字段，不向普通业务页面显示内部术语：

- 目标 ID；
- 本层墙钟时间；
- presolve 后行列数；
- MIP 节点数与 LP 迭代数；
- incumbent、dual bound 和绝对/相对 gap；
- 本层是否已有可行解；
- 模型行、列、非零系数数量。

这些信息能区分：

- 很久找不到任何满足前 21 层锁定的班表；
- 很快找到班表，但迟迟无法证明没有更好的疲劳差；
- presolve 本身耗时；
- 大量等价人员/岗位组合造成分支对称。

没有这些证据时，调整 `presolve`、随机种子、heuristic 或目标顺序都属于猜参数。

### 第三阶段：逐项验证精确性能优化

按风险和收益建议依次验证：

1. **删除可证明为空、常量或重复的目标。** 只有目标没有有效系数、其值已被变量界固定，或被前层完整决定时才能跳过；必须证明目标向量不变。
2. **补齐组合辅助变量的完整线性化。** `daily-combination-model.ts` 中的组合变量当前只有“目标与来源同时选中时必须为 1”的下界，没有“目标或来源未选中时必须为 0”的上界。这会给后续目标留下大量退化的辅助变量空间；补全标准 AND 关系上界后，必须比较全部目标向量和最终业务事实，证明它是修复表达而非改写规则。本轮尚未对完整线性化做真实夹具耗时对照，不能先声称它会足够快。
3. **收紧负荷辅助变量上界。** 当前 `maximumLoad` 把某人全部候选岗位的系数相加，即使其中许多候选因时间冲突和工时上限不可能同时选择。可以利用已经存在的工时上限、互斥组和每岗位唯一选择事实计算更紧但仍安全的人员上界。本轮仅收紧该上界的单项对照仍超时，因此必须与其他模型强化分别组合验证，不得将它单独当作已证明的修复。
4. **证明并利用疲劳离散步长。** 若所有岗位疲劳点和目标值经配置、Excel 和状态清洗后都严格是 0.5 的整数倍，可统一乘 2，把 max/min/spread/excess 声明为有界整数变量，使 HiGHS 识别整数目标。随后可评估小于 1 个缩放单位的 `mip_abs_gap`；因为可行目标值之间至少相差 1，这仍能证明目标值真实最优，而不是近似。若输入合同不能保证该步长，则不得采用。
5. **验证真正不可区分人员的对称消除。** 只有两人的资质、可选岗位、全部高低优先级目标系数、历史负荷和锁定状态完全一致时，才能添加稳定对称约束；配置顺序只能用于选择等价解，不能改变任何业务目标。HiGHS 默认已开启自身的 MIP symmetry detection，不应只重复设置同一参数。
6. **对照升级 HiGHS v1.15.1。** 使用完全相同的模型、单线程 WASM 构建、deadline 和随机种子，至少多次记录冷启动与热启动；比较完整目标向量、岗位完整性、工时、疲劳、锁定、反馈事实和耗时。
7. **只把 `presolve=off` 当 A/B 诊断。** 若日志证明疲劳层主要耗在 probing/presolve，再决定是否针对该类模型选择策略；不能因一个案例全局关闭。

### 真实性能验收建议

把当前工作簿匿名化为仓库内固定夹具，并至少比较：

| 方案                       | 必须保持                       | 观察指标                             |
| -------------------------- | ------------------------------ | ------------------------------------ |
| v1.13、逐目标总 deadline   | 当前 26 层语义                 | 整次时间、失败层、实际 deadline 偏差 |
| v1.15.1、逐目标总 deadline | 与 v1.13 完整目标向量一致      | 每层时间、节点、gap                  |
| 收紧变量界                 | 完整目标向量一致               | 疲劳层 presolve 规模与节点数         |
| 疲劳整数化                 | 完整目标向量一致、输入合同一致 | 疲劳层下界、gap 和证明时间           |
| presolve on/off            | 完整目标向量一致               | presolve 时间与总时间                |

由于规范允许“所有业务质量目标相同的等价班表”在少数同分人员间互换，性能等价测试不应只要求人员 ID 逐格完全相同；应先比较完整目标向量、硬约束、岗位完整性、锁定、工时和疲劳事实，再判断人员互换是否只是合法等价解。

## 需要 owner 正式修改规范才能采用的方案

以下做法在成熟排班产品中很常见，但与当前 `spec.md` 冲突：

- 120 秒后采用已有 incumbent；
- 返回 `FEASIBLE` 而非必须 `OPTIMAL`；
- 低优先级疲劳目标超时后跳过，保留前 21 层最优班表；
- 先发布完整可行班表，再后台继续改善；
- 放宽普通相对 MIP gap；
- 允许前层目标按 abs/rel tolerance 退化；
- 把多个现行严格层合成 Timefold/OR-Tools 风格的加权软分数。

如果前述精确优化仍无法让真实 10 航班规模稳定完成，owner 需要在以下产品取舍中明确选择：

- 继续要求所有 26 层全局最优，并接受部分日期可能等待很久或失败；
- 保证硬约束和前若干关键层最优，低优先级公平在时限内尽量改善；
- 减少业务上真正需要严格压过后层的 score level 数量。

这不是单纯技术参数问题，而是“证明全部最优”和“固定时间一定交付班表”之间的产品合同选择。

## 明确不建议

- 不继续只提高 120 秒；当前实现会把每一层的预算一起提高。
- 不关闭负荷均衡开关作为永久修复；真实测试已经证明它会避开超时，但也删除了现行业务目标。
- 不用超大权重合并 26 层；这违反中央规则合同，也容易产生数值问题。
- 不直接采用超时 incumbent；当前规范禁止，且包装层尚未可靠校验解有效性。
- 不通过随机种子重试或挑最快结果掩盖证明困难。
- 不盲设 `parallel=on`；当前 WASM 构建没有浏览器 pthread 运行合同，多线程还涉及 SharedArrayBuffer、跨源隔离响应头、部署和回归验证。
- 不为了“主流”直接换 OR-Tools/Timefold；两者的默认最优性语义和浏览器部署形态都与当前项目不同。

## 最终判断

对当前 8 航班真实数据，系统不是因为明显死循环而卡住；它在执行一个合法但昂贵的严格字典序 MIP，并在“当天疲劳差额”层证明全局最优时耗尽时间。这个计算确实可能很久。

但当前代码也不能被视为“正常算满 120 秒就结束”：它误把 HiGHS 的逐目标 `time_limit` 当成了整批总 deadline，并在重复批次中没有清零累计主时钟。**先修正计时边界，再评估疲劳整数化、界收紧和 HiGHS 升级，才是符合成熟求解器实践且不改变排班规则的路线。**

## 主要资料

- HiGHS v1.13 原生多目标源码：<https://github.com/ERGO-Code/HiGHS/blob/v1.13.0/highs/lp_data/HighsInterface.cpp#L4054-L4321>
- HiGHS v1.15.1 独立 MIP timer：<https://github.com/ERGO-Code/HiGHS/blob/v1.15.1/highs/mip/HighsMipSolver.cpp#L95-L101>
- HiGHS C API 累计时钟与清零说明：<https://github.com/ERGO-Code/HiGHS/blob/v1.13.0/highs/interfaces/highs_c_api.h#L1326-L1351>
- HiGHS v1.14.0 release：<https://github.com/ERGO-Code/HiGHS/releases/tag/v1.14.0>
- HiGHS probing 超时预算 PR：<https://github.com/ERGO-Code/HiGHS/pull/2865>
- HiGHS presolve 慢案例：<https://github.com/ERGO-Code/HiGHS/issues/2478>
- Timefold score levels：<https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/docs/src/modules/ROOT/pages/constraints-and-score/overview.adoc#L104-L165>
- Timefold load balancing：<https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/docs/src/modules/ROOT/pages/constraints-and-score/load-balancing-and-fairness.adoc#L133-L175>
- Timefold 有限时间优化哲学：<https://github.com/TimefoldAI/timefold-solver/blob/01be36b60c2c9cbf0b71c310ee4334e12e006008/docs/src/modules/ROOT/pages/optimization-algorithms/overview.adoc#L43-L75>
- OR-Tools 官方员工排班示例：<https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/examples/python/shift_scheduling_sat.py#L289-L417>
- OR-Tools 整数目标绝对 gap 说明：<https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/ortools/sat/sat_parameters.proto#L360-L376>
