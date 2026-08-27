# autoschedule 新窗口交接

更新时间：2026-08-27

## 新窗口入口

项目目录：`G:\浏览器下载\codex项目\autoschedule`

owner 在新窗口可以直接说：

> 继续上次工作。

新窗口必须先读取 `AGENTS.md`、本文件，并按当前任务读取 `.agents/skills/autoschedule-dev/SKILL.md`、`spec.md` 相关章节和真实代码入口；随后检查 `git status --short`。不得回滚当前工作区改动，不得把本文件当作产品规则来源。

## 当前分支与工作区

- 分支：`全局化highs`。
- 工作区有大量未提交改动，属于 owner 现有工作和本轮排班规则修复，禁止清理或按 `HEAD` 批量恢复。
- 当前未执行 commit、push 或部署。
- 当前开发地址通常为 `http://127.0.0.1:51127/`，端口是临时状态；新窗口使用前重新检查。当前地址最近一次 HTTP 检查返回 `200`。

## 最近完成：分流仅在岗位缺口时启用

业务场景：晚间只有 `AK151` 与 `TW616` 时，如两边岗位可由不同合格人员完整覆盖，`AK151` 的分流人员不应因末班公平、轮岗或疲劳目标继续承担 `TW616`。只有不使用提前撤岗确实会留下岗位空缺时，才允许分流接续。

已完成修复：

- 新增 `src/domain/assignments/diversion-release-usage.ts`，以“关闭提前撤岗后是否产生重叠或最小航班衔接冲突”识别实际分流；统一供整体模型、结果物化、后置复核和 `KE166` 收尾消费。
- HiGHS 在“全部岗位空缺最小化”后，按现有 `minimum-flight-transition` 规则 ID 最小化分流转派次数；同等岗位完整度时不再为公平、轮岗或负荷启用分流。
- 排班结果仅对实际发生分流的来源岗位缩短工时；未分流的下午分流岗位保留完整结束时间与工时。
- 后置末班重点频率、连续轮岗和 `KE166` 独立督导收尾不得新增不必要的分流。
- `spec.md` 与 `README.md` 已同步新合同；新增“人手足够不分流、缺员仍可分流、后置公平不新增分流、KE166 收尾不新增分流”的回归。

关键文件：

- `src/domain/assignments/diversion-release-usage.ts`
- `src/domain/kernel/daily-combination-model.ts`
- `src/domain/kernel/daily-schedule-model.ts`
- `src/domain/kernel/daily-schedule-result.ts`
- `src/domain/reviews/rotation-review-safety.ts`
- `src/domain/assignments/ke166-supervisor-finalizer.ts`
- `tests/domain/scheduling-kernel.test.ts`
- `tests/domain/daily-schedule-optimizer.test.ts`
- `tests/domain/late-priority-frequency-review.test.ts`
- `spec.md`

## 之前完成：值班人员中间减负优先级

业务场景：`2026-08-26` 值班人员华嘉慧必须承担上午航班和 `TR121/H02`；中间 `CX931` 有 `G20`（重点岗位）和 `G14`（普通岗位）。22 日、24 日历史导入后，模型原本先把华嘉慧放到 `G14`，但后置 `position-frequency-review` 又把她换回 `G20`。

已确认根因：后置同岗频率/连续轮岗复核只保护值班人员仍有上午航班，没有保护已经成立的值班中间减负结果。

已完成修复：

- `daily-schedule-model.ts` 的值班减负顺序为：减少额外航班 → 避开额外重点岗位（CX 的 `G18/G20` 也计入）→ 降低额外岗位疲劳 → 普通轮岗/负荷比较。
- `rotation-review-safety.ts` 新增值班减负前后字典序比较；后置轮岗不得增加值班人员的额外航班数、重点岗位数或疲劳。
- 覆盖补缺阶段保留例外：岗位确实空缺且只有值班人员可补时，仍允许值班人员补齐岗位。
- `spec.md` 已同步上述规则合同。
- 新增真实回归：带 22 日、24 日 `CX931/G20` 历史的完整生成管线，确认 26 日值班人员保持在 `G14`，不会被后置轮岗换回 `G20`。

关键文件：

- `src/domain/kernel/daily-schedule-model.ts`
- `src/domain/reviews/position-rotation-policy.ts`
- `src/domain/reviews/rotation-review-safety.ts`
- `src/domain/rules/scheduling-execution-plan.ts`
- `tests/domain/scheduling-kernel.test.ts`
- `tests/domain/scheduling-execution-plan.test.ts`
- `spec.md`

## 同一工作区内已有改动

不要误删以下未提交内容：

- 值班目标优先级、末班重点岗位公平、跨工作日恢复和截止保护；
- 同日早晚 CX 重点岗位分散复核；
- 末班重点岗位次数按月份统计、手工修正、清零、导入导出；
- 旧版手工排班 Excel 的末班重点记录隔离；
- 配置导入导出、localStorage 恢复、排班失败提示和下载修复；
- `PROJECT_MAP.md` 以及现有测试和协作规范改动。

具体行为以当前代码、测试、`spec.md` 和中央规则合同为准。

## 最近真实验证

本次分流修复后的独立验证已完成：

- 目标及相邻规则测试：7 个文件、195 项通过；
- `npm.cmd run typecheck`：通过；
- `npm.cmd run build`：通过；
- `npm.cmd run test:performance`：4 个文件、14 项通过；
- `git diff --check`：通过；
- 未发现调试输出残留。

`npm.cmd run verify` 已实际运行但退出码为 `1`：普通测试 98 个文件中 97 通过、1 失败，682/683 项通过。失败为 `tests/app/application-coordinator.test.ts` 的“rechecks a proposed swap before applying it”，其预期手工换岗分析为 `safe`，实际为 `soft-tradeoff`。该用例仅交换同一航班两个常规岗位，分流计数为 0；可在本次修改前后的当前工作区独立复现，尚未处理，禁止将完整门禁写成通过，也不得 commit/push。

## 下一步与风险

- 新窗口如继续排班规则开发，先保留当前未提交分流改动，不得按 `HEAD` 恢复或清理工作区。
- 可以用真实晚间 `AK151`、`TW616` 数据点击“重新排班”复核：两边有独立合格人员时不得同人分流；缺员时仍应允许提前撤岗接续。不要仅刷新页面，刷新只恢复 localStorage 中旧班表。
- 若下一任务需要 commit/push，先定位并修复上述手工换岗测试的 `safe`/`soft-tradeoff` 基线差异，再重新运行 `npm.cmd run verify`，必须退出码为 0。
- 值班人员中间减负的真实页面复核仍有效：22 日、24 日历史导入后，26 日值班人员应保持在 `CX931/G14`，不要只刷新页面。
- 任何新的排班规则改动都要先核对 `spec.md` 宏观原则和规则合同，先写失败测试，再修改所属职责模块。
- 当前未授权 commit、push 或部署。

## 交接文件边界

本文件只记录继续工作所需的当前快照，不替代 `AGENTS.md`、`spec.md`、Skill 或测试；新事实推翻本文件时，应先更新本文件再继续。
