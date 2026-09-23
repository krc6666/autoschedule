# 登机口保障抽象排班逻辑的 GitHub 开源项目调研

> 调研日期：2026-09-20
>
> 本报告的排班样本唯一来源：登机口保障排班-2026年8至9月.md；不引用、不使用 Excel 提取结果。
>
> 范围：先从本地 Markdown 提炼排班事实，再比较 GitHub 项目的排班模型、可二次开发性、许可证与维护状态；不评价页面长相。
> 证据原则：只使用各仓库的 README、源码、LICENSE、提交和发布记录。一切维护状态均为调研当日快照。

## 先说结论

**没有找到“岗位行 × 航班列、同一人员当天串多个短任务、关键角色锁定、其他角色轮换、跨航班临时支援”全部现成实现的开源成品。**

最接近的三个对象是：

1. **[Shuntao-Wang/airport-staff-scheduling-optimization](https://github.com/Shuntao-Wang/airport-staff-scheduling-optimization)**：业务问题形状最像。它确实把登机口服务拆成短任务，再按时间、位置和行走时间串成一条条人员任务链。但它排的是匿名 `shift`，不是已知姓名人员；没有固定关键岗位、轮换岗或外援池，而且当前代码不能按 README 直接运行。适合借鉴“任务链构造和局部修补”，不适合作为生产底座。
2. **[TimefoldAI/timefold-quickstarts](https://github.com/TimefoldAI/timefold-quickstarts)**：工程底座最强。`task-assigning` 已有“每人一条有序任务链 + 技能硬约束 + 可留空任务”，`employee-scheduling` 已有时段、地点、技能、重叠和公平，`flight-crew-scheduling` 还有连续任务间转场检查。问题是这些能力分散在三个示例中，不能直接拼起来；若采用，需要重建登机口领域模型和 Java/Quarkus 后端。
3. **[j3soon/nurse-scheduling](https://github.com/j3soon/nurse-scheduling)**：成品度最高，有完整 Web、规则配置、求解、Excel 输出和测试。它擅长“人员 × 日期 × 班种”的覆盖、资格、顺序和搭档规则，但核心明确限制每人每天最多一个班种，和“一天内多次串岗”相反；许可证还是 AGPL-3.0。适合借鉴规则配置和排班解释，不适合直接改成登机口任务链系统。

若只问“哪一个值得 fork 后继续做”：**没有低成本、几乎同构的答案。**若允许引入 Java 后端，Timefold quickstarts 是这批中最正规的二开起点；若保持现有值机系统与技术栈，合理做法是只借 Shuntao/Timefold 的模型思想和反例，不建议推倒现有系统，也不建议为了界面或“机场”二字 fork 一个不完整仓库。

## 一、从 Markdown 确认的排班模式

### 事实边界

- **表已确认**：Markdown 共列出 30 个工作日；20260802 至 20260923 有实际排班，20260925、20260927、20260929 是空模板。每天都是“岗位行 x 航班/保障时段列”。
- **口述参考**：接机完成后通常转去登机相关岗；大件行李拦截约一人一小时轮换；关键岗位在本航班保障窗口内通常不被随意抽走。
- **推测/待确认**：Markdown 是最终矩阵，不是事件流水。它能证明同人承担多项任务，不能单独证明每项任务的准确起止、交接顺序和支援结束时间。

### 1. 任务形态：固定岗矩阵 + 高流动串岗

这不是“每个人守一个柜台”的清单，而是先列出每个航班需要哪些岗位，再让同一批人在一天内反复进入不同航班和岗位。

真实例子：20260917 的 CX937 / 1010-1130 一列基本排满，督导余雯雯、入境申报黄雪剑、接机1 李梦/陈丹丹、接机2 朱晓璐、大件行李拦截黄雪剑/杜乐乐/邓颖、登机主验李杨、登机核验李梦、登机查验余雪妮、人证核对/秩序维护陈丹丹/杜乐乐。与此同时，这些人又出现在当天其他航班列，所以从人员视角看，最终是多段任务组成的日内路径。

### 2. 人员路径：接机 -> 登机相关岗 -> 可能支援

表已确认的例子：

- 20260802，黄潇蒙在 CX937 做接机1搭档，又在同列做人证核对/秩序维护；随后还出现在 KE0166 人证岗、FD573 接机2和主验、AK151 大件和人证、TR121 人证。
- 20260917，陈丹丹在 CX937 同时出现在接机1与人证岗，晚间又出现在 CX931 接机1/人证和 AK151 大件岗。

这与“接机后转登机相关岗、空档再支援其他航班”的口述一致。不过矩阵没有岗位子时段，所以上述箭头是有业务口述支持的路径解释，不是表内写明的精确时间线。

### 3. 固定岗与流动岗

“固定”应理解为**某航班保障窗口内的一人一关键岗**，不是这个人全天不能再做别的航班。

- 督导、登机主验、登机核验通常每个航班各写一个人。20260917 的 CX937 是主验李杨、核验李梦；CX931 是主验邓颖、核验朱晓璐。
- 接机1、大件行李拦截、人证核对/秩序维护经常一格多人，也更常复用同一批人。
- 关键岗人员也会在时间分开的航班间复用。20260917 的余雯雯既是 CX937 督导，也是 AK151 督导，之后还是 TW616 主验；因此“固定”不能误建模为全天锁死。

### 4. 斜杠：轮换和搭档不能混成一种东西

表已确认：

- 20260802，CX937 大件行李拦截是“杜乐乐/李梦/李杨”；20260917 同岗是“黄雪剑/杜乐乐/邓颖”。结合口述，这类斜杠表示分时轮换。
- 20260802，CX937 接机1是“余雯雯/黄潇蒙”；这类斜杠更像同岗搭档。
- 20260901，CX937 人证核对是“陈丹丹/值机支援”，表示内部人员加外援资源。

所以自动排班时不能把斜杠只存成字符串。至少要区分“同时需要多人”“按时间分段轮换”“一名内部人员加一个外援缺口”三种语义。

### 5. 跨航班支援：谁常跨列，谁相对少

按 27 个已排工作日统计“同一人当天出现在至少两个航班列”：

- 余雪莲、邓颖各 24 天；
- 黄潇蒙、杜乐乐各 23 天；
- 李杨、刘楠、余雯雯各 22 天；
- 余雪妮在 26 个出勤日中有 13 天跨列，且单日最多 3 列，相对更少。

按岗位观察，接机1和人证核对/秩序维护最明显地复用同一批人。大件岗虽然一格常有多人轮换，但同一人在同一天多个航班的“大件”行重复反而少。督导、主验、核验也会跨列，但每个航班窗口内通常保持一人一岗，必须受时间不重叠和转场缓冲约束。

### 6. “值机支援”是什么角色

它不是一个叫“值机支援”的员工，而是外部资源来源/待落实人数。

真实例子：20260901 的 CX937 人证岗是“陈丹丹/值机支援”；20260814 同一天有 CX937“刘楠/值机支援”和 KE166“陈丹丹/值机支援”。在这份样本里，它出现在人证核对/秩序维护岗位。建模时应先产生“需要 1 名值机外援”的需求，之后才可绑定具体人员，不能把它当普通姓名参与公平统计。

### 7. 底部“0910支援 / 到岗”怎么进入逻辑

真实例子：

- 20260802：“0910支援: 余雪莲、刘楠”；
- 20260808：“1400到岗：杜乐乐、余雪莲 / 1600到岗：余雯雯”；
- 20260919：“14:00到岗:余雯雯 16:00到岗:刘楠 黄潇蒙”。

“到岗”应转成个人可用时间窗，人在该时刻前不能接任务。“0910支援”应转成会占用人员的定时支援任务或承诺，并参与冲突检查。样本没有统一写出 0910 支援的结束时间和地点，不能擅自补默认时长。

### 8. 与值机 autoschedule 的本质差异

一句话：**值机主要决定“谁在某时段守哪个柜台”，登机口保障主要决定“同一人如何在多个航班的多个短任务之间串行流动，同时锁住关键岗、安排轮换并处理临时支援”。**

## 二、项目评价口径

这次不按项目名称或行业标签打分，而看六件事：

- 能否把一天拆成有开始、结束、地点、岗位/技能的短任务；
- 同一人员能否按时间顺序连续承担多个任务；
- 能否表达岗位资格、关键角色固定或人工锁定；
- 能否表达多人覆盖、轮换、跨航班/跨地点支援；
- 后置优化会不会破坏时间、资格和覆盖硬约束；
- 许可证、测试、运行入口和维护状态是否足以支持二次开发。

“逻辑相似度”只回答业务模型像不像；“二开适用性”还包括许可证与工程质量。两者不能混为一谈。

## 三、候选项目

| 项目                                 | 逻辑相似度           | 工程底座 | 许可证           | 维护快照                                   | 判断                                     |
| ------------------------------------ | -------------------- | -------- | ---------------- | ------------------------------------------ | ---------------------------------------- |
| Shuntao airport staff scheduling     | 高                   | 低       | MIT              | 2026-01 最后提交；无 tag/release；少量脚本 | 最像任务链，当前不能直接跑               |
| Timefold quickstarts                 | 中高                 | 高       | Apache-2.0       | 2026-09 有 v2.6.0 tag；持续维护            | 最值得做领域化二开，但不是现成成品       |
| j3soon nurse-scheduling              | 中                   | 中高     | AGPL-3.0         | 2026-09 持续提交；v0.2.0 于 2026-08 发布   | 完整产品，但“每天一个班”模型不对口       |
| leone-parasporo airport ground staff | 中高                 | 很低     | **未授予许可证** | 2026-06 四次提交；无 release               | 逻辑可读，法律上不能当开源底座           |
| Google OR-Tools                      | 中（能力高，成品低） | 中       | Apache-2.0       | 活跃；最新正式 release v9.15               | 求解器工具箱，不是业务系统               |
| Staffjoy v2                          | 低                   | 很低     | MIT              | README 明示 2019 废弃                      | 只能参考班表 CRUD/发布，不含目标优化逻辑 |

### 1. Shuntao-Wang/airport-staff-scheduling-optimization

- 仓库：[README](https://github.com/Shuntao-Wang/airport-staff-scheduling-optimization/blob/bb3808adb4ed3f24fc6ccee69ab423bce8c83aae/README.md)
- 模型源码：[Problem 1](https://github.com/Shuntao-Wang/airport-staff-scheduling-optimization/blob/bb3808adb4ed3f24fc6ccee69ab423bce8c83aae/problem1_basic/problem1_solver.py)、[Problem 2](https://github.com/Shuntao-Wang/airport-staff-scheduling-optimization/blob/bb3808adb4ed3f24fc6ccee69ab423bce8c83aae/problem2_spatial/problem2_solver.py)、[Problem 3](https://github.com/Shuntao-Wang/airport-staff-scheduling-optimization/blob/bb3808adb4ed3f24fc6ccee69ab423bce8c83aae/problem3_fairness/problem3_solver.py)
- 许可证：[MIT](https://github.com/Shuntao-Wang/airport-staff-scheduling-optimization/blob/bb3808adb4ed3f24fc6ccee69ab423bce8c83aae/LICENSE)
- 维护：[提交记录](https://github.com/Shuntao-Wang/airport-staff-scheduling-optimization/commits/main/)

### 核心模型

README 列出 7 类登机口任务，包括桥位接机、桥位登机主岗/协助、远机位接机和登机等。输入任务带开始时间、结束时间、起点、终点、任务类型和关联任务。算法将不重叠且来得及转场的任务串进同一条 `shift`：

- Problem 1 先合并紧密关联任务，再用滑动窗口贪心构造任务链，并插入未分配任务；
- Problem 2 检查“前任务结束 + 行走时间 <= 后任务开始”，并把转场时间计入目标；
- Problem 3 尝试从空档大的任务链向其他任务链移动任务，以平衡跨度、利用率和“早来早走”。

### 像在哪里

- 真正处理的是登机口服务短任务，不是整天一个柜台班次；
- 一条 `shift` 内含多个有序任务，天然表达人员做完一个任务再去另一个任务；
- 任务带位置，连续任务间检查行走时间；
- 有关联任务合并和后置换任务，接近“任务链保持 + 局部支援”的抽象。

### 不像在哪里

- 输出的是匿名任务链编号，不是把任务分给一份已知人员名单；没有人员可用性、人员资格、固定关键角色或外援身份；
- `k_t` 只影响资格成本和切换成本，没有建模“岗位必须由具备某资质的人承担”；
- 没有“一个岗位多人分时轮换”的显式对象；若用多个短任务模拟轮换，也缺少轮换连续性和交接规则；
- 没有岗位 × 航班矩阵、人工锁定、保存/发布和实际调整流程。

### 代码核查与运行风险

README 写明可在各问题目录直接执行，但三个脚本都把项目根目录算成脚本目录的上两级。真实仓库布局中，`data/` 只在上一级，因此脚本实际寻找的是仓库外的 `data/`。即使依赖已安装，README 的运行命令也会因找不到数据而失败。

`problem3_solver.py` 还有两个确定的运行错误：

- `compute_fairness` 是 `fairness_optimize()` 内部函数，却在 `calculate_Z()` 中以 `fairness_optimize.compute_fairness` 调用，函数对象没有这个属性；
- 主程序把结果写进变量 `initial_shifts` 后，又直接调用尚未定义的 `optimized_shifts`。

本次把仓库克隆到系统临时目录，并在隔离虚拟环境中安装 requirements.txt 声明的全部依赖后执行入口。Problem 1 和 Problem 3 均因上述根目录计算错误而找不到仓库自带数据；后两项错误则由当前源码的符号引用直接确认。仓库无测试、无 tag、无 release，最后代码提交集中在 2026-01-24。

### 二开判断

**不适合直接 fork 成生产系统。**最值得借的是以下算法层：

- `Task(start, end, startLocation, endLocation, role)` 的任务抽象；
- 按可衔接性构造人员任务链；
- 将关联任务视为组合或相邻任务；
- 后置移动任务时重新检查整条链的时间和转场可行性。

不能照搬的是匿名 shift、加权总分和缺少最终不变量复核的随机后处理。

### 2. TimefoldAI/timefold-quickstarts

- 仓库：[README](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/README.md)
- 许可证：[Apache-2.0](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/LICENSE.txt)
- 维护：[v2.6.0 tag](https://github.com/TimefoldAI/timefold-quickstarts/releases/tag/v2.6.0)、[提交记录](https://github.com/TimefoldAI/timefold-quickstarts/commits/stable/)

### 最相关的三个官方示例

**Task Assigning**

- [说明和约束](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/use-cases/task-assigning/README.md)
- [`Employee.tasks` 是规划列表](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/use-cases/task-assigning/src/main/java/org/acme/taskassigning/domain/Employee.java)
- [`Task` 从前一任务结束时间推导自身开始时间](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/use-cases/task-assigning/src/main/java/org/acme/taskassigning/domain/Task.java)
- [技能、未分配任务和完成时间约束](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/use-cases/task-assigning/src/main/java/org/acme/taskassigning/solver/TaskAssigningConstraintProvider.java)

这部分最像“同一人一天做多项短任务”：每个员工持有一条有顺序的任务列表，任务可以未分配，任务类型声明所需技能。它的时间是“尽早开始 + 固定时长”，不是航班给定的固定时间窗，也没有地点转场。

**Employee Scheduling**

- [说明和约束](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/use-cases/employee-scheduling/README.md)
- [`Shift` 带开始、结束、地点、所需技能和人员](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/use-cases/employee-scheduling/src/main/java/org/acme/employeescheduling/domain/Shift.java)
- [技能、重叠、不可用和公平约束](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/use-cases/employee-scheduling/src/main/java/org/acme/employeescheduling/solver/EmployeeSchedulingConstraintProvider.java)

这部分有固定时间段、地点、技能资格、不可用日期和公平分配，但示例硬编码“每天最多一个 shift”，不支持同一天多个短任务。

**Flight Crew Scheduling**

- [说明和约束](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/use-cases/flight-crew-scheduling/README.md)
- [连续航班转场约束源码](https://github.com/TimefoldAI/timefold-quickstarts/blob/b9abb3bcd417d51cbd972a69744ba9fc81173b7f/use-cases/flight-crew-scheduling/src/main/java/org/acme/flighcrewscheduling/solver/FlightCrewSchedulingConstraintProvider.java)

这部分证明框架能表达同一人员连续任务间的位置衔接，但它安排的是机组随航班移动，不是航站楼内岗位支援。

### 像与不像

像：任务链、技能硬约束、时间冲突、地点/转场、未分配任务和公平，都已有可测试的源码模式。使用硬/软分层也比一个超大加权总分更适合关键岗位与一般支援的优先级。

不像：没有一个示例同时具备上述能力；没有岗位 × 航班矩阵语义，没有多人轮换对象，也没有开箱即用的“关键角色锁定”。任务链示例按工作到达顺序排时间，员工排班示例又禁止同日多班。需要把三个模型的思想重新落到一个领域模型中，不能复制粘贴合并。

### 二开判断

**是本次最可靠的工程底座，但迁移成本高。**优点是活跃维护、Apache-2.0、示例有单元和接口测试，并提供可运行的 Quarkus 应用。代价是 Java 后端、Timefold 规则体系和持续求“较好解”的语义；这与当前纯前端/现有求解链未必一致。

若只借鉴，优先借 `task-assigning` 的“每人有序任务列表”与 Timefold 的独立具名约束写法；不要因为它成品度高就替换现有 autoschedule。

### 3. j3soon/nurse-scheduling

- 仓库：[README](https://github.com/j3soon/nurse-scheduling/blob/4ccaec53dff5e47a077f1acad9ebb083777badc6/README.md)
- 规则源码：[preference_types.py](https://github.com/j3soon/nurse-scheduling/blob/4ccaec53dff5e47a077f1acad9ebb083777badc6/core/nurse_scheduling/preference_types.py)
- 许可证：[AGPL-3.0](https://github.com/j3soon/nurse-scheduling/blob/4ccaec53dff5e47a077f1acad9ebb083777badc6/LICENSE)
- 维护：[v0.2.0](https://github.com/j3soon/nurse-scheduling/releases/tag/v0.2.0)、[提交记录](https://github.com/j3soon/nurse-scheduling/commits/dev/)

### 核心模型

这是完整的自动排班 Web 应用，默认用 OR-Tools CP-SAT。官方文档和源码支持：

- [按日期、班种和合格人员定义人数覆盖](https://github.com/j3soon/nurse-scheduling/blob/4ccaec53dff5e47a077f1acad9ebb083777badc6/docs/content/user-guide/shift-type-requirements.md)；
- [鼓励、避免或禁止班种顺序](https://github.com/j3soon/nurse-scheduling/blob/4ccaec53dff5e47a077f1acad9ebb083777badc6/docs/content/user-guide/shift-type-successions.md)；
- [鼓励或避免指定人员同日搭档](https://github.com/j3soon/nurse-scheduling/blob/4ccaec53dff5e47a077f1acad9ebb083777badc6/docs/content/user-guide/shift-affinities.md)；
- [求解后导出 XLSX，并区分最优与限时可行解](https://github.com/j3soon/nurse-scheduling/blob/4ccaec53dff5e47a077f1acad9ebb083777badc6/docs/content/user-guide/optimize-and-export.md)。

### 像与不像

像：覆盖人数、资格池、班种组、人员搭档、顺序、计数、公平、Excel 输出和规则配置都很成熟。它也把规则做成结构化数据，而不是把全部特例写死。

不像：模型核心变量是“人员在某日期做某班种”，源码明确建立每人每天最多一个 shift；顺序规则是跨日班种序列，不是同一天的接机 -> 查验 -> 支援任务链。它没有航班、岗位实例、分钟级转场或岗位轮换。

### 二开判断

若目标是通用倒班，这是好成品；若目标是登机口日内任务链，改造会触及变量、页面和数据合同的核心，接近重写。AGPL-3.0 还要求认真评估网络服务修改版的源码提供义务。建议只借规则编辑、覆盖校验、求解解释和 Excel 导出方式，不作为现有系统替代品。

### 4. leone-parasporo/airport-ground-staff-scheduling

- 仓库：[README](https://github.com/leone-parasporo/airport-ground-staff-scheduling/blob/0a7651f1fe53126d0073703b963d1d01306a88df/README.md)
- 实现：[airport_staff_scheduling.ipynb](https://github.com/leone-parasporo/airport-ground-staff-scheduling/blob/0a7651f1fe53126d0073703b963d1d01306a88df/airport_staff_scheduling.ipynb)
- 维护：[提交记录](https://github.com/leone-parasporo/airport-ground-staff-scheduling/commits/main/)
- 许可证：**没有 LICENSE，GitHub 元数据也未声明许可证**

### 核心模型

Notebook 从航班装载时间窗和每航班所需人数生成需求事件，再将不重叠任务贪心组合成 work block；随后把多个 work block 依次交给可用员工，限制每日累计分钟，最后导出航班、任务块和人员表到 Excel。源码中的人员只是自动编号，不带资质或岗位。

### 像与不像

像：按航班产生短任务；一人可连续做多个不重叠 work block；会算高峰并控制日累计时长；输出能追溯人员服务过哪些航班。

不像：只有装载操作员一种资源，没有固定与流动角色、多人轮换、地点转场、外援或关键岗锁定；算法是贪心参数搜索，README 自己也把技能、公平、劳动规则和优化器列作未来改进。

### 二开判断

**不能作为开源二开底座。**公开可读不等于获得复制、修改和分发许可；在作者补充明确许可证前，只能阅读和独立借鉴思想。工程上也只有一个 Notebook、数据文件和依赖清单，无测试、API 或应用边界。

### 5. google/or-tools

- 仓库：[README](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/README.md)
- 人员覆盖示例：[nurses_sat.py](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/ortools/sat/samples/nurses_sat.py)
- 完整倒班示例：[shift_scheduling_sat.py](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/examples/python/shift_scheduling_sat.py)
- 任务顺序与切换示例：[scheduling_with_transitions_sat.py](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/examples/contrib/scheduling_with_transitions_sat.py)
- 许可证：[Apache-2.0](https://github.com/google/or-tools/blob/98c165af62df62b3056c2ee0fca66b24e79097cb/LICENSE)
- 维护：[v9.15 release](https://github.com/google/or-tools/releases/tag/v9.15)、[提交记录](https://github.com/google/or-tools/commits/main/)

### 核心模型与适配性

OR-Tools 不是排班产品，而是组合优化工具箱。官方 `nurses_sat.py` 演示“人员 × 日期 × 班次”0/1 覆盖和公平；`shift_scheduling_sat.py` 演示固定安排、连续班、班次转换、覆盖人数和软硬边界；调度与 routing 示例可表达有序任务、时间窗和转场。

它能建模本任务的绝大多数抽象约束，但需要项目自己定义航班岗位实例、人员路径、轮换、外援、锁定、回退、数据导入和 UI。换句话说，它是可用求解引擎，不是可 fork 的登机口系统。

### 二开判断

适合做算法原型或求解器对照，不适合当业务应用底座。项目活跃、Apache-2.0、文档与多语言绑定成熟；但官方没有 JavaScript 浏览器绑定，接入纯浏览器项目通常意味着增加后端或非官方移植。现有 autoschedule 已有自己的求解链，不应仅因 OR-Tools 示例多就推倒重来。

### 6. Staffjoy/v2

- 仓库：[README](https://github.com/Staffjoy/v2/blob/c34d2c7a5f5349c3e7a03b5ac52547664bd01ced/README.md)
- 班次服务：[company/server/shifts.go](https://github.com/Staffjoy/v2/blob/c34d2c7a5f5349c3e7a03b5ac52547664bd01ced/company/server/shifts.go)
- 许可证：[MIT](https://github.com/Staffjoy/v2/blob/c34d2c7a5f5349c3e7a03b5ac52547664bd01ced/LICENSE)

README 明示仓库自 2019-09 起废弃。源码能创建、查询、分配、发布和通知班次，也有公司、团队、岗位和员工等管理能力，但没有自动求解任务链、技能资格、转场或支援逻辑。它是旧式 workforce management 应用，不是本任务要找的排班算法底座。

即使 MIT 容易二开，也不值得继承其 Go/Bazel/Kubernetes 老栈和大体量单仓库。最多参考“草稿班次 -> 批量发布 -> 通知”的流程层，不应进入前三名。

## 四、最终推荐

### 按逻辑相似度

1. **Shuntao**：短任务、任务链、位置转场最接近；只借模型和局部算法。
2. **Timefold quickstarts**：把 `task-assigning`、`employee-scheduling`、`flight-crew-scheduling` 三者视作一组参考时，抽象能力最全。
3. **leone-parasporo**：短任务跨航班串联较像，但无许可证，不能列为可二开项目。若“可合法二开”是硬条件，则第三名改为 **j3soon/nurse-scheduling**，但只能借规则层。

### 按可二次开发性

1. **Timefold quickstarts**：许可证清楚、持续维护、应用和测试骨架完整；适合新建 Java 后端型原型。
2. **j3soon/nurse-scheduling**：完整产品和规则编辑能力强，但模型不对口且 AGPL-3.0 有较强义务。
3. **OR-Tools**：最可靠的求解器工具箱，但不是现成业务底座。

### 借鉴边界

- 从 Shuntao 借“短任务 -> 可衔接图 -> 每人任务链 -> 局部修补”的算法层；
- 从 Timefold 借任务列表变量、独立具名硬约束、技能和未分配任务处理；
- 从 j3soon 借规则配置、覆盖资格、解释报告和 Excel 往返；
- 从 Staffjoy 借发布/通知流程即可；
- 不 fork 无许可证的 Parasporo；不把 OR-Tools 当成现成应用。

因此，本次调研支持的方向是：**保留现有值机 autoschedule，在其旁边增加或抽取“日内任务链”领域能力时参考这些项目，而不是用任何一个候选整体替换现有系统。**
