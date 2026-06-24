# POPO AI

这是一个用于复刻 POPO AI 模块核心体验的本地 MVP 原型。当前版本不依赖后端和构建工具，直接打开 `index.html` 即可运行。

## 当前能力

- 群消息日报 / 周报：自动整理某个群过去一天或一周的进展、风险、待办和需要确认的问题。
- 供应商沟通摘要：把报价、交付时间、修改意见、待补材料整理成结构化记录。
- 会议后行动项：根据会议纪要或群讨论，提取负责人、截止时间和下一步动作。
- 流程提醒：根据关键词识别合同、立项、结算、验收等流程，并提示需要准备的材料。
- 文件归档入口：模拟群内 @机器人 + 附件，生成归档检查清单，后续可接 Muse / ArcoLab。

## 后续接入建议

1. 接入 POPO 群消息、附件和 @机器人事件。
2. 后端新增 `/api/group-digest`、`/api/supplier-summary`、`/api/meeting-actions`、`/api/process-reminder`、`/api/archive-checklist`。
3. 将 `app.js` 中的模拟函数替换为真实 API 调用。
4. 补齐群权限、附件权限、审计日志、归档字段映射和 Muse / ArcoLab 同步。

## POPO 切片验证

- 已用 `popo-cli` 做只读验证，`报价` 和 `验收` 能命中真实 POPO 群消息。
- 页面中的“载入 POPO 切片”会读取 `data/popo-slice.json`，用于本地验证摘要、供应商摘要和流程提醒；该文件只保留脱敏后的代表性示例。
- 后续可运行 `scripts/popo-slice.ps1 -Keyword 报价 -PageSize 10 -Days 1` 拉取新的只读切片，再替换 `data/popo-slice.json`。
