# autoschedule 新窗口交接

更新时间：2026-08-24

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

## 最近完成：值班人员中间减负优先级

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

最近一次修复后的独立验证已完成：

- 目标及相邻规则测试：6 个文件、160 项通过；
- 全量普通测试：97 个文件、663 项通过；
- `npm.cmd run typecheck`：通过；
- `npm.cmd run build`：通过；
- `npm.cmd run test:performance`：4 个文件、14 项通过；
- `git diff --check`：通过；
- 未发现调试输出残留。

注意：最新实现修改后尚未重新运行 `npm.cmd run verify`。按 `AGENTS.md`，在 commit/push 前必须补跑一次并确认退出码为 0；若失败，不得推送。

## 下一步与风险

- 新窗口先用真实 22 日、24 日、26 日数据点击“重新排班”复核华嘉慧是否保持在 `CX931/G14`，不要只刷新页面；刷新只恢复 localStorage 中的旧班表。
- 若真实页面仍显示 `G20`，导出当前配置/班表或提供浏览器控制台中的实际 `assignments`，继续对比真实数据与测试夹具。
- 任何新的排班规则改动都要先核对 `spec.md` 宏观原则和规则合同，先写失败测试，再修改所属职责模块。
- 当前未授权 commit、push 或部署；即使 owner 后续授权，也必须先通过 `npm.cmd run verify`。

## 交接文件边界

本文件只记录继续工作所需的当前快照，不替代 `AGENTS.md`、`spec.md`、Skill 或测试；新事实推翻本文件时，应先更新本文件再继续。
