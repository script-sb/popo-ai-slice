# POPO 助手

这是一个用于验证 POPO 助手核心体验的 MVP 原型。页面可静态运行，也可以连接本机常驻后端，从 POPO 报价群同步消息并生成分析建议。

## 当前能力

- 日报 / 周报收集生成审核：整理 POPO 群消息的进展、风险、待办和确认项。
- 供应商报价 Check：检查报价、人天、排期、材料和采购风险。
- 待办事项提醒：根据群讨论提取负责人、截止时间和下一步动作。
- POPO 文件调取：根据文件名、群线索和附件生成调取清单。
- 本地同步服务：通过 `popo-cli` 轮询报价群，推送消息数、风险数和今日日报。

## 本地后端

后端只监听本机地址 `127.0.0.1:8787`，不会对公网开放。

```powershell
npm run server
```

默认监听群配置在 `server/config.json`：

- `6065488` H55-动作-益格-报价群
- `7461410` H55-场景制作-点晴-报价群

可用接口：

- `GET /api/health`
- `GET /api/groups`
- `GET /api/messages`
- `GET /api/alerts`
- `GET /api/digest/today`
- `POST /api/sync-now`
- `GET /events`

本地消息状态保存在 `server/state/`，该目录已加入 `.gitignore`，避免提交真实消息数据。

## 后续接入建议

1. 将本地 JSON 状态替换为 SQLite。
2. 增加私聊和群聊分流。
3. 增加 @我、待回复、待确认的独立队列。
4. 接入模型生成回复草稿，但发送前必须人工确认。
5. 补齐附件权限、审计日志、归档字段映射和 Muse / ArcoLab 同步。

## POPO 切片验证

- 已用 `popo-cli` 做只读验证，`报价` 和 `验收` 能命中真实 POPO 群消息。
- 页面中的“载入 POPO 切片”会读取 `data/popo-slice.json`，用于本地验证摘要、供应商摘要和流程提醒；该文件只保留脱敏后的代表性示例。
- 后续可运行 `scripts/popo-slice.ps1 -Keyword 报价 -PageSize 10 -Days 1` 拉取新的只读切片，再替换 `data/popo-slice.json`。
