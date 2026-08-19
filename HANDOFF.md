# autoschedule 新窗口交接

更新时间：2026-08-19

## 新窗口自动入口

项目目录：`G:\浏览器下载\codex项目\autoschedule`

owner 在新窗口只需说：

> 继续上次工作。

收到后依次执行：

1. 完整读取 `AGENTS.md` 和本文件。
2. 根据任务读取 `.agents/skills/autoschedule-dev/SKILL.md`、`spec.md` 相关章节和真实代码入口。
3. 检查 `git status --short` 和任务相关差异。
4. 先说明当前完成事实、剩余风险和准备处理的范围，再按 `AGENTS.md` 判断是否需要 owner 确认。

不得回滚已有工作区改动。不得 commit、push 或部署，除非 owner 在当前窗口明确授权。

## 当前状态

- 当前没有正在开发到一半的新功能；等待 owner 提出下一项需求。
- `plan.md` 是已经完成的“每周航班计划与下一工作日确认”旧计划，不是当前活动计划。除非 owner 明确要求，不要继续执行或重写它。
- 工作区有大量未提交改动，包含多个此前已完成功能。它们属于 owner，禁止清理、覆盖或按 `HEAD` 批量恢复。
- 最近确认的开发地址是 `http://127.0.0.1:5173/`。端口是临时状态，新窗口使用前应重新检查，不得假设始终有效。

## 最近完成：旧版手工排班导入隔离

旧版 Excel 导入只写入“末班重点岗位”部分历史，并用 `historyCoverage: "late-priority-only"` 与完整班表分开。

此类记录继续参与：

- 末班重点岗位次数；
- H02 月度轮换和上限；
- 跨工作日恢复保护；
- 已知重点岗位疲劳。

此类记录明确不参与：

- 下午无航班统计；
- 提前下班统计；
- 完整班次滚动工时；
- 完整连续工作日证据。

导入时保留岗位配置业务备注和疲劳点：H02 为“一号”、H04 为“申报”、H05 为“送资料”；人员单元格原文保留在 `rawText`。重复导入和 localStorage 恢复会修复旧 `legacy-history-*` 记录。历史页面会标明“仅末班重点记录”。

关键文件：

- `src/infrastructure/legacy-schedule-excel.ts`
- `src/app/workbook-actions.ts`
- `src/infrastructure/state-restoration.ts`
- `src/model.ts`
- `src/domain/statistics/relaxed-shift-statistics.ts`
- `src/domain/statistics/fatigue.ts`
- `src/domain/reviews/workload-balance.ts`
- `src/domain/shared/previous-workday-load.ts`

## 同一工作区内其他已完成改动

当前未提交差异还包含以下功能，不得在新任务中误删：

- 人工调整可对资质、时间重叠、最小衔接和每日工时进行受控越权，并持续显示警告；自动排班硬约束不变。
- 旧版手工排班 Excel 的日期选择、预览和导入界面。
- 排班页提前下班名单、下午无航班名单及提前下班绿色标记。
- 每周航班计划、“归档并排后天”确认和每班预定人数。
- 持续显示的排班失败红色提示。
- 分流时间重算、重点岗位轮换、跨工作日恢复、截止保护及此前求解安全修复。

以上是工作区事实摘要。具体行为仍以当前 `spec.md`、代码和测试为准；本文件不得替代产品合同。

## 防耦合开发规则

`AGENTS.md` 和 `.agents/skills/autoschedule-dev/SKILL.md` 已加入永久门禁。以后 owner 无需重复粘贴长提示词。每次行为变更自动执行：

1. 定义数据语义。
2. 确定唯一事实源。
3. 列出允许影响和明确不变范围。
4. 先写新行为失败测试和关键不变行为防回归测试。
5. 只修改拥有该事实的职责模块。
6. 按风险运行相关验证。

需求有歧义、优先级或回退不清时才使用 `grilling`。出现多个事实源、跨模块职责泄漏或共享状态扩散时才使用 `improve-codebase-architecture` 与 `codebase-design`。普通局部改动不得机械运行全仓架构扫描。

## 最近真实验证

最后一次代码修改后的完整验证：

```powershell
npm.cmd run verify
```

结果：退出码 `0`。

- 类型检查通过；
- 普通测试：95 个文件、631 项通过；
- 性能测试：4 个文件、13 项通过；
- 生产构建通过；
- `git diff --check` 通过；
- `src`、`tests` 中未发现 `[DEBUG-` 残留。

构建仅出现已有的 `node:module` 浏览器外部化警告，没有导致构建失败。

完整验证之后只修改了协作文档 `AGENTS.md`、`.agents/skills/autoschedule-dev/SKILL.md` 和本交接文件；这些文档修改按仓库规则只需 `git diff --check` 和人工核对，不需要重复运行应用测试。

## 剩余风险和操作边界

- 工作区改动很多且互相重叠，新任务必须先检查相关差异，不能把整份 `git diff` 都认作当前任务产生。
- 旧版 Excel 格式可能继续出现新布局；未识别格式应停在预览或待确认状态，不得猜测后直接写入历史。
- 部分历史和完整历史必须继续隔离。新增统计消费者时必须显式判断它需要哪种覆盖范围。
- 排班规则变化必须核对 `spec.md` 的宏观原则和中央合同，不得改变既有优先级，不得把新规则堆入 `scheduling-kernel.ts`。
- 未执行 commit、push 或部署。

## 结束窗口前

owner 说“更新交接，我要开新窗口”时，更新本文件中的日期、当前任务、完成事实、真实验证、未验证风险和下一步。删除已经失效的旧进度，不追加整段聊天记录，不把推测写成完成事实。
