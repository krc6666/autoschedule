<div align="center">

# 自动排班

### 把航班、岗位资质和人员疲劳放进同一张清楚、可调整、可分享的排班表。

[在线使用](https://krc6666.github.io/autoschedule/) · [配置模板](./public/template/排班工具配置模板.xlsx) · [GitHub](https://github.com/krc6666/autoschedule)

<p>
  <a href="https://github.com/krc6666/autoschedule/actions/workflows/deploy-pages.yml"><img alt="Deploy Pages" src="https://img.shields.io/github/actions/workflow/status/krc6666/autoschedule/deploy-pages.yml?branch=main&logo=githubactions&logoColor=white&label=Pages"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript 5.9" src="https://img.shields.io/badge/TypeScript-5.9-3178C6"></a>
  <a href="https://vite.dev/"><img alt="Vite 7" src="https://img.shields.io/badge/Vite-7-646CFF"></a>
  <a href="https://getbootstrap.com/"><img alt="Bootstrap 5" src="https://img.shields.io/badge/Bootstrap-5-7952B3"></a>
  <a href="https://vitest.dev/"><img alt="Vitest 4" src="https://img.shields.io/badge/Vitest-4-6E9F18"></a>
  <img alt="Static local-first" src="https://img.shields.io/badge/Architecture-static%20local--first-0f766e">
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/krc6666/autoschedule?color=0f766e"></a>
</p>
</div>

## 一张表，完成当天保障排班

自动排班把航班计划、岗位规则、人员资质、请休假状态和历史疲劳统一计算，生成可人工复核和调整的当天排班结果。所有业务数据默认留在当前浏览器，无需账号或服务器。

| 工作环节 | 当前能力 |
| --- | --- |
| 配置 | 管理人员、航班计划模板、按航班折叠的岗位规则、批量新增、岗位资质、疲劳点和运力阈值 |
| 排班 | 按资质、状态、夜班能力、时间冲突、工时与疲劳自动分配 |
| 调整 | 在紧凑航班列中直接编辑姓名和临时备注；常规岗位校验人员名单，支援岗位可任意输入、留空或删除 |
| 接续 | 点击“归档并排明天”，保存当天负荷并直接按历史工时和疲劳生成次日排班 |
| 分享 | 导出 Excel 保障明细、离线 HTML 排班页和高清 PNG 图片 |

## 数据留在本地

应用是可直接分发的静态前端工具。配置、排班和历史记录存储在浏览器本地；Excel 只在当前设备中解析和生成，不上传到远端服务。

## 配置与每日排班

先在“配置”中的“航班计划模板”填写固定的航班号、时间、岗位和备注。进入“航班”后新增当日航班，输入模板中的航班号会自动带出这些信息；每天只需填写当天预定人数（运力）并按需要调整岗位。

岗位规则中的“启用旅客人数”控制运力：阈值为 0 的岗位始终启用，其他岗位只有在当天预定人数达到阈值时才生成。排班页左侧人员名单可拖到任意岗位单元格，清空按钮用于减少人员，“增加临时岗位”用于现场增派人员。

岗位规则按航班折叠显示，可先选择航班和数量再批量新增。生成结果后，常规岗位在上、支援岗位在下；支援岗位可填写人员库之外的支援名称，也可以留空或删除。姓名后的岗位备注来自配置，其中“一号”不显示；下一行“临时备注”只记录当天调整。“柜台引导1”会从该航班已排且原岗位无备注的人员中复用，不重复累计工时。

当天调整完成后，点击排班页的“归档并排明天”：系统会先归档当天工时与疲劳，把日期推进一天，再以这些历史负荷自动生成次日排班。次日航班有变化时，在航班页调整计划后点击“重新排班”即可。

左侧“导入数据”是混合入口，可识别配置和历史；配置页的“导入配置模板”只更新配置，历史页的“导入历史排班结果”只导入疲劳历史。左侧按钮明确为“导出配置”，排班页的“导出排班结果”才是当天排班结果。

## 本地开发

先安装 Node.js、Python 3 和项目依赖：

```powershell
npm.cmd install
```

运行 Python 启动器后，脚本会启动支持热更新的 Vite 开发服务，并自动用 Edge、Chrome 或 Firefox 的隐私窗口打开页面：

```powershell
python dev.py
```

需要检查生产构建结果时，使用：

```powershell
python dev.py --preview
```

可通过 `--port 5173` 指定端口。按 `Ctrl+C` 会停止当前服务。

## 开源协议与贡献

本项目遵循 [MIT License](./LICENSE)。欢迎通过 Issue 或 Pull Request 改进排班规则、数据兼容和交付体验；提交前请阅读 [贡献指南](./CONTRIBUTING.md)。
