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
| 配置 | 管理人员、航班、岗位资质、疲劳点和排班约束 |
| 排班 | 按资质、状态、夜班能力、时间冲突、工时与疲劳自动分配 |
| 调整 | 逐岗位改派人员，并即时阻止无资质、冲突和超工时操作 |
| 接续 | 导入历史排班、归档当天结果，把历史负荷带入下一次排班 |
| 分享 | 导出 Excel 保障明细、离线 HTML 排班页和高清 PNG 图片 |

## 数据留在本地

应用是可直接分发的静态前端工具。配置、排班和历史记录存储在浏览器本地；Excel 只在当前设备中解析和生成，不上传到远端服务。

## 开源协议与贡献

本项目遵循 [MIT License](./LICENSE)。欢迎通过 Issue 或 Pull Request 改进排班规则、数据兼容和交付体验；提交前请阅读 [贡献指南](./CONTRIBUTING.md)。
