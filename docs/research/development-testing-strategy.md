# autoschedule 开发测试策略调研

- 调研日期：2026-08-15
- 调研目标：在不降低回归保护的前提下，减少局部开发中反复运行无关测试的时间
- 资料范围：Google Testing Blog、Microsoft Learn、ISTQB、Vitest、GitHub Docs、Google Benchmark 的官方或一手资料，以及当前仓库的真实脚本、Git Hook、工作流和测试结构
- 本文性质：研究与落地建议，不代表相关脚本、Hook、CI 或协作规范已经修改

## 结论摘要

成熟测试体系的核心不是“每次都跑全部测试”，也不是“只跑改动文件对应的测试”，而是把不同测试放到不同反馈周期：

1. 开发内循环只运行最接近改动的快速测试，行为变化先写能稳定失败的测试。
2. 用变更影响分析缩小本地测试范围，但不能把它当作唯一安全依据；动态导入、读取源码文本的架构测试和隐式共享合同都可能不在静态依赖图中。[S4][S5]
3. 根据产品风险决定补充范围。排班核心、共享状态、导入导出、Worker/solver、构建和依赖变更应扩大验证，不能只按改动文件数量判断风险。[S3]
4. 所有准备合并的代码都应经过一次完整的功能回归、类型检查和生产构建；这个门禁更适合放在 PR 必需检查，而不是在每次局部编辑后重复执行。[S2][S6]
5. 性能测试应独立成一条验证通道：性能相关改动时运行，并在受控环境定期运行。带墙钟阈值的性能测试不适合作为每次局部改动的默认门禁，因为可靠基准需要预热、重复采样和稳定环境。[S8]
6. 当前仓库不能立即删掉提交前的完整普通测试：GitHub Actions 目前只在 `main` 已收到 push 后执行部署验证，没有 PR 必需检查。应先建立 PR 功能门禁，再缩短本地 Hook。

建议最终形成四条独立通道，而不是继续让一个 `verify` 承担所有场景：

| 通道         | 目的                                   | 推荐触发时机                  | 当前能力                                |
| ------------ | -------------------------------------- | ----------------------------- | --------------------------------------- |
| 相关测试     | 最快发现本次改动的直接错误             | 编写过程中、修复后立即运行    | Vitest 文件过滤、`related`、`--changed` |
| 完整功能验证 | 阻止功能、类型和构建回归进入受保护分支 | 每个 PR/合并、发布前          | `typecheck` + 普通 `test` + `build`     |
| 性能验证     | 发现求解、渲染和大数据路径退化         | 性能相关 PR、定时任务、发布前 | `test:performance`                      |
| 完整发布验证 | 汇总全部发布条件                       | 发布或 owner 明确要求完整验收 | 当前 `verify`                           |

## 一手资料给出的共同模式

### 1. 测试应分层，快速且稳定的测试占主体

Google 的测试金字塔把测试分为小型、集成和端到端层级，并指出端到端测试通常更慢、更不稳定且失败后更难定位；建议让快速、隔离的小测试构成主体，用更少的集成和端到端测试保护边界与关键流程。[S1]

这不意味着机械追求某个百分比。对 autoschedule 更有用的原则是：

- 纯领域函数用小型领域测试保护；
- Store、controller、Worker、Excel 等边界用集成测试保护；
- 少量关键用户流程再由真实浏览器烟雾测试保护；
- 不用大量高层测试重复覆盖所有领域组合。

### 2. 左移是尽早得到有价值的反馈，不是把所有重测试都搬到本地

Microsoft 的工程实践把 shift-left 描述为尽早测试，并强调快速、可靠的测试反馈；其建议包括把单元测试放入构建、保持测试可靠，并把较慢的测试安排到合适的流水线阶段。[S2]

因此“开发内循环跑相关测试、PR 跑完整功能回归、定时跑性能”比“每次编辑都执行完整 `verify`”更符合左移：错误仍在进入主分支前被拦截，但开发者不用反复等待与当前改动无关的性能和构建步骤。

### 3. 测试范围应由风险决定，不只由文件数量决定

ISTQB 官方 Foundation Level 4.0.1 syllabus 将风险测试定义为依据风险分析安排测试，并说明产品风险会影响测试范围、测试级别与类型、技术、覆盖、工作量和优先级。[S3]

映射到本项目：

- 修改一个纯展示文案和修改 `AppState` 都可能只改一个文件，但风险完全不同；
- 修改排班硬约束或 solver 适配器，即使代码行很少，也属于高影响面；
- 修改多个 UI 文件，如果只影响一个局部对话框且接口不变，风险可能仍然有限；
- 所以“改了几个文件”不能作为是否全量验证的唯一标准。

### 4. 变更影响测试是加速器，不是完整回归的替代品

Vitest 官方提供两类能力：

- `vitest related <source files>`：运行与给定源文件有关的测试；官方说明它依赖静态导入关系，动态导入无法可靠发现。[S4]
- `--changed [since]`：运行与未提交改动或指定 Git 基线以来改动有关的测试。[S5]

当前仓库存在 10 处动态 `import()`，并且 6 个 `tests/architecture/*` 测试文件中有多个通过 `readFileSync` 读取源码或配置来检查合同。它们不一定能由源文件静态导入图自动关联。因此：

- 本地可以使用显式测试文件、`related` 或 `--changed` 获得快速反馈；
- 对动态导入、源码文本合同、配置文件和共享数据合同必须维护显式风险映射；
- PR 合并前仍运行完整普通测试，兜住影响分析无法识别的关系。

### 5. 合并门禁应由受保护分支的必需检查承担

GitHub 官方文档说明，受保护分支可以要求状态检查通过后才允许合并；必需检查能够把测试结果变成服务端、不可依赖个人记忆的合并条件。[S6]

当前 `.github/workflows/deploy-pages.yml` 只监听对 `main` 的 push，并在部署前运行 `npm run verify`。这能阻止失败版本部署，但不能阻止失败提交先进入 `main`。成熟迁移顺序应是：

1. 先增加 `pull_request` 功能验证工作流；
2. 把它设为 `main` 的必需状态检查；
3. 确认稳定后，再缩短 `.husky/pre-commit`；
4. 保留发布或定时的完整验证。

如果工作流使用路径过滤，GitHub 文档提醒：被路径或分支过滤跳过的工作流可能让关联的必需检查保持 Pending，从而阻止合并。[S7] 因此建议让 PR 功能门禁始终创建，内部再决定执行哪些补充任务，不要用容易消失的顶层路径过滤来实现必需检查。

### 6. 性能验证需要稳定环境、预热和重复采样

Google Benchmark 官方指南提供了最小运行时间、重复次数、聚合统计和 CPU 频率缩放警告等机制，说明可信性能判断不能只依赖一次普通测试进程中的墙钟耗时。[S8]

当前 `tests/performance` 有 3 个测试文件，其中：

- 多处使用 `performance.now()` 和绝对秒数阈值；
- `scheduling-kernel.benchmark.test.ts` 对每个场景只执行 1 次预热和 2 个正式样本，却输出 `p50`/`p99`；两个样本不足以让 `p99` 具有稳定的统计解释；
- 性能测试同时断言了岗位完整性、空缺和时间冲突等功能事实。

由此得到两项落地要求：

1. 功能正确性必须在普通测试中独立覆盖，不能因为局部验证跳过性能目录就同时失去唯一的正确性保护。
2. 性能目录用于退化检测：在固定 Node/浏览器、固定机器档位、固定夹具和足够重复采样下比较基线；本地偶发超时只能作为调查信号，不能直接证明产品退化。

“性能测试不应每次运行”是基于上述证据对本项目的工程判断，不是说性能不重要。推荐在以下情况运行：

- 修改 `scheduling-kernel`、solver、Worker、候选搜索、历史预处理或性能夹具；
- 修改依赖、构建方式、WASM 加载或运行时版本；
- 定时基线任务，例如每日或每周在固定 runner 执行；
- 发布前，或 owner 明确要求性能验收时。

## 当前仓库基线

以下事实于 2026-08-15 从当前工作区核对：

| 项目               | 当前事实                                      | 影响                                     |
| ------------------ | --------------------------------------------- | ---------------------------------------- |
| `typecheck`        | `tsc -b --pretty false`                       | 快速发现跨文件类型合同错误               |
| `test`             | 运行 Vitest，排除 `tests/performance/**`      | 85 个普通测试文件，是完整功能回归主体    |
| `test:performance` | 运行 `tests/performance`                      | 3 个文件，含求解、历史页面和基准场景     |
| `build`            | `tsc -b && vite build`                        | 验证生产打包、动态导入、Worker/WASM 接线 |
| `verify`           | 顺序执行 typecheck、普通测试、性能测试、build | 同时承担功能、性能和发布验证，粒度过粗   |
| pre-commit         | lint-staged、完整 typecheck、全部普通测试     | 每次 commit 都承担完整普通功能回归       |
| GitHub Actions     | 仅 `main` push 后部署前执行 `verify`          | 没有 PR 合并前的服务端功能门禁           |
| 架构测试           | 多个测试直接读取源码文本                      | 静态依赖影响分析可能漏选                 |
| 动态导入           | `src` 中存在 10 处 `import()`                 | `related` 不能作为唯一选测依据           |

## 推荐的分级模型

### L0：编辑反馈

目标：几十秒内定位直接错误。

触发：每次行为修改、修复或小范围重构。

执行：

```powershell
npm.cmd exec vitest -- run tests/domain/example.test.ts
npm.cmd exec vitest -- run tests/app/example.test.ts tests/ui/example.test.ts
```

规则：

- 先运行能复现问题的失败测试；
- 只选择本职责及直接消费者测试；
- 不运行性能测试和生产构建；
- 纯文档变更只运行 `git diff --check`。

### L1：本地变更集验证

目标：在准备交付或 commit 前检查当前变更的直接影响。

执行：

```powershell
npm.cmd test -- --changed
npm.cmd run typecheck
git diff --check
```

`--changed` 只作为候选集合。出现以下任一情况时必须显式追加测试：

- 修改动态导入入口或其加载目标；
- 修改 `package.json`、Vite、Worker、WASM 或依赖；
- 修改公共命令、`AppState`、Store、迁移或序列化；
- 修改被架构测试以文本方式检查的模块；
- 修改排班规则合同、硬约束或共享资格判定。

建议把“文件/合同 -> 必跑测试”维护为仓库内可审查的稳定映射，而不是让 agent 临时猜测。例如：

| 改动面                                           | 至少追加                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `package.json`、Vite、动态加载、Worker/WASM 接线 | `tests/architecture/build-config.test.ts`                         |
| UI command 或 coordinator 命令合同               | `tests/architecture/app-command-contract.test.ts` + 对应 app 测试 |
| eligibility 公共判定                             | eligibility 架构测试 + 相关 domain/app 测试                       |
| daily schedule 模块边界                          | daily-schedule 架构测试 + 排班集成测试                            |
| 全局 facade/目录职责迁移                         | `tests/architecture/no-facade-migration.test.ts`                  |

### L2：PR 完整功能门禁

目标：任何代码进入 `main` 前完成一次完整、确定性的功能回归。

推荐组合：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

建议新增一个语义明确的脚本名，例如 `verify:functional`，并让所有 PR 必须通过该状态检查。它不默认包含性能目录。

这一层应覆盖所有代码 PR，而不只覆盖“高风险 PR”，原因是它同时兜底静态影响分析遗漏、测试间隐式合同和生产打包问题。若耗时变长，应优先使用缓存、并行、测试分片或拆分 CI job，而不是删除回归保护。[S9]

### L3：性能门禁与定时基线

目标：发现真实的速度、资源和规模退化。

执行：

```powershell
npm.cmd run test:performance
```

触发策略：

- 性能相关文件或依赖改变：PR 中必跑并阻塞合并；
- 非性能相关 PR：不作为本地和 PR 默认步骤；
- 默认分支：每日或每周定时运行，并保存趋势；
- 发布：使用固定环境执行，失败时阻止发布或要求明确风险接受。

在把定时性能结果设为硬门禁前，应先完成：

- 固定 runner 和 Node 版本；
- 增加正式样本数量，不把两次采样称为可靠 `p99`；
- 区分产品硬超时、性能基线和普通功能断言；
- 记录中位数、尾延迟、方差和与基线的变化；
- 建立重跑与判定规则，避免偶发机器抖动造成随机失败。

### L4：发布完整验证

目标：汇总功能、构建和性能发布条件。

当前 `npm.cmd run verify` 可以保留为发布、部署或 owner 明确要求完整验收时的入口：

```powershell
npm.cmd run verify
```

不建议继续把它定义为所有代码修改的本地默认收尾命令，也不建议每次 commit 都运行它。

## 风险到验证范围的决策表

| 改动类型                                    | 本地开发                                 | PR 必需      | 性能通道           |
| ------------------------------------------- | ---------------------------------------- | ------------ | ------------------ |
| 纯协作文档                                  | `git diff --check`                       | 文档检查     | 不跑               |
| 单一纯领域函数                              | 目标 domain 测试 + typecheck             | 完整功能验证 | 不跑               |
| 单一 UI 组件或样式                          | 目标 UI 测试 + 相关 app 测试 + typecheck | 完整功能验证 | 仅渲染性能相关时   |
| controller/coordinator 流程                 | 相关 app/UI/domain 测试 + typecheck      | 完整功能验证 | 通常不跑           |
| `AppState`、Store、迁移、Excel/localStorage | 相关往返/集成测试 + typecheck            | 完整功能验证 | 大数据路径变化时   |
| 排班规则合同、kernel、solver/Worker         | 相关失败测试、核心合同和 typecheck       | 完整功能验证 | 必跑               |
| 依赖、Vite、Worker/WASM、构建配置           | build-config 测试 + typecheck + build    | 完整功能验证 | 影响运行性能时必跑 |
| 性能优化或性能阈值                          | 正确性测试 + 目标性能测试                | 完整功能验证 | 必跑并比较基线     |

这里的“PR 必需”是一致的完整功能验证；风险分层主要决定开发内循环是否扩大，以及是否附加性能和专门入口测试。这样既避免每次局部编辑跑 85+3 个文件，也避免不同 agent 对“窄改动”作出不一致判断。

## 推荐迁移顺序

### 第一阶段：先建立服务端安全网

1. 增加 `verify:functional`：typecheck + 普通测试 + build。
2. 增加 `pull_request` 工作流，并将该 job 配置为 `main` 的必需状态检查。
3. 保留当前 pre-commit 和 `verify`，观察一段时间确保 CI 稳定。

### 第二阶段：缩短本地反馈

1. pre-commit 保留 lint-staged 和 typecheck。
2. 普通测试改为 `--changed`/`related` 加显式风险映射。
3. 完整普通测试由 PR 必需检查统一承担。
4. agent 开发过程只跑 L0/L1，不在每次修改后重复运行 L2/L4。

### 第三阶段：独立性能治理

1. 从性能目录识别只存在于该目录的功能断言，并在普通测试补齐。
2. 建立固定环境的定时性能工作流。
3. 提高采样质量并保存趋势，再决定哪些阈值可以稳定阻塞合并。
4. `verify` 保持发布语义；日常 PR 使用 `verify:functional`，性能相关 PR再附加 `test:performance`。

## 不推荐的做法

- 不推荐所有实现改动都在本地运行 `verify`：它把性能与发布验证错误地放进了每次开发反馈周期。
- 不推荐完全取消完整普通回归：静态影响分析无法覆盖本仓库所有动态和文本合同。
- 不推荐在建立 PR 必需检查前先削弱 pre-commit：当前没有其他合并前服务端安全网。
- 不推荐只按文件数量区分风险：一个共享状态字段可能比十个局部样式文件影响更大。
- 不推荐让不稳定的墙钟性能阈值阻塞所有无关 PR：应先固定环境、提高采样质量并分离性能通道。
- 不推荐让性能目录承担唯一功能正确性断言：跳过性能验证时仍必须保留完整功能保护。

## 来源

- [S1] Google Testing Blog, “Just Say No to More End-to-End Tests”, https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html ，访问日期：2026-08-15。
- [S2] Microsoft Learn, “Shift testing left with unit tests”, https://learn.microsoft.com/en-us/devops/develop/shift-left-make-testing-fast-reliable ，访问日期：2026-08-15。
- [S3] ISTQB, “Certified Tester Foundation Level Syllabus v4.0.1”, https://www.istqb.org/certifications/certified-tester-foundation-level ，访问日期：2026-08-15。
- [S4] Vitest, “Test Filtering - Running Tests Related to Source Files”, https://vitest.dev/guide/filtering.html#running-tests-related-to-source-files ，访问日期：2026-08-15。
- [S5] Vitest, “CLI - changed”, https://vitest.dev/guide/cli.html#changed ，访问日期：2026-08-15。
- [S6] GitHub Docs, “About protected branches”, https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches ，访问日期：2026-08-15。
- [S7] GitHub Docs, “Workflow syntax for GitHub Actions - paths / paths-ignore”, https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore ，访问日期：2026-08-15。
- [S8] Google Benchmark, “User Guide - Runtime and Reporting Considerations”, https://google.github.io/benchmark/user_guide.html#runtime-and-reporting-considerations ，访问日期：2026-08-15。
- [S9] Vitest, “Improving Performance”, https://vitest.dev/guide/improving-performance.html ，访问日期：2026-08-15。
