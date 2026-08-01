<div align="center">

# 自动排班

### 把航班、岗位资质、人员状态和历史负荷整理成可执行的机场保障班表。

[在线使用](https://krc6666.github.io/autoschedule/) · [配置模板](./public/template/排班工具配置模板.xlsx) · [产品规格](./spec.md) · [GitHub](https://github.com/krc6666/autoschedule)

<p>
  <a href="https://github.com/krc6666/autoschedule/actions/workflows/deploy-pages.yml"><img alt="Deploy Pages" src="https://img.shields.io/github/actions/workflow/status/krc6666/autoschedule/deploy-pages.yml?branch=main&logo=githubactions&logoColor=white&label=Pages"></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/krc6666/autoschedule?color=0f766e"></a>
</p>
</div>

## 日常使用

1. 在“配置”中维护人员、航班模板、岗位和规则，或导入配置模板。
2. 在“航班”中确认当天航班、时间、运力和岗位；也可以使用在线查询生成增删建议。
3. 选择工作日期并生成排班，在真实任务进度完成后查看班表、人员负荷和规则反馈。
4. 按需要拖拽换人、交换岗位、填写临时岗位或调整当日轮值。
5. 在“统计”中核对月度值班、CX航前、备勤和岗位承担次数，在“历史”中复核已归档班表。
6. 导出 Excel、离线 HTML 或 PNG；确认当天结果后可以仅归档，或“归档并排后天”。

## 页面入口

| 页面 | 用途                                           |
| ---- | ---------------------------------------------- |
| 总览 | 查看当前日期、航班、人员和排班状态             |
| 配置 | 维护人员、模板、岗位和通用参数，导入或导出配置 |
| 航班 | 管理当天航班并进行线上计划对账                 |
| 排班 | 生成、复核、人工调整和导出当天班表             |
| 规则 | 用中文查看、启停和调整允许配置的排班规则       |
| 统计 | 管理月度轮值并核对人员与岗位统计               |
| 历史 | 查看、导入、删除和清空已归档排班               |

班表根据当前航班和岗位自动生成。航班增加到 5、6、7、8 个或更多时会继续扩展，超过可读宽度后仅班表区域横向滚动；当日轮值在桌面端固定显示于班表右侧，窄屏时自动移到班表上方。

业务数据默认保存在当前浏览器本地，配置和历史 Excel 也只在当前设备中解析。应用没有账号或远端数据写入。

详细规则、数据边界、实现说明和验收标准统一以 [spec.md](./spec.md) 为准，README 不重复维护第二套说明。

## 本地开发

安装依赖并启动开发服务：

```powershell
npm.cmd ci
python dev.py
```

检查生产构建：

```powershell
python dev.py --preview
```

完整验证：

```powershell
npm.cmd run verify
```

## 开源协议

本项目遵循 [MIT License](./LICENSE)。提交改动前请阅读 [贡献指南](./CONTRIBUTING.md)。
