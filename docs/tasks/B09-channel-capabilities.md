# B09 通道能力台账、维护入口与用户能力说明

> Issue [#9](https://github.com/Godyu97/geo-pro/issues/9)｜2026-11-19｜M0 软件基础；完整 [T-M0-04](M0.md#t-m0-04) 保持未完成，真实官方 API 与消费者入口核验仍外部受阻。

## 范围与关键决定

- 平台级通道台账：稳定通道 ID、厂商分组、`consumer_ui` / `model_api` / `custom_pipeline` 分轨、不可变能力版本、验证记录与人工 SOP。
- 仅 `capabilities.manage` 可写入验证结果；默认验证有效期 30 天，显著变化立即失效并产生新版本，不覆盖旧口径。
- 设置页展示用户可用范围；运行确认拒绝未验证/过期/降级/禁用通道，合格时仍明确运行执行未开放，不返回模拟成功。
- 保存回答联网证据时，配置联网但无触发证据则实际联网为 `unknown`，不得进入 required 联网合格分母。禁用后历史版本与联网元数据仍可按品牌归属查看。
- 维护页与接口不展示客户正文、密钥或内部端点。官网仅在存在未过期且允许公开的 verified 记录时投影名称、范围、状态、限制和验证信息。

## 修改入口

领域在 `src/features/capabilities/`；薄路由在 `src/app/(dashboard)/dashboard/maintenance/capabilities/`、`src/app/(dashboard)/dashboard/monitoring/new/`、`src/app/api/maintenance/capabilities/`、`src/app/api/monitoring/runs/` 与 `src/app/api/monitoring/answers/network/`。专项测试在 `tests/capabilities/`，HTTP 验证在 `scripts/verify-capabilities.mjs`。工程事实和门禁随实现同步，未修改产品验收口径，不勾选 T-M0-04。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`、`pnpm test:i18n` | 通过。 |
| `pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check`、`pnpm test:capabilities` | 双方言增量迁移及 DDL 检查通过。测试从品牌事实基线升级，两次 `pnpm db:migrate`，对照全量 DDL。3 项通过，覆盖双轨 ID、验证有效期、显著变化失效、未验证门禁、联网 unknown 不合格分母、禁用后历史、越权、并发、审计回滚和单次列表查询。 |
| `pnpm verify:capabilities` | SQLite3/PostgreSQL 生产 HTTP 和 Chrome 通过。覆盖真实会话、伪造/过期会话、拒绝越权、同源和身份切换，以及中英文设置的 375/768/1440、AA 正文对比度、运行确认拒绝未验证通道、合格时不创建模拟成功、维护页 SOP 与无客户正文。 |
| `python docs/tools/validate_docs.py`、OpenSpec 校验 | 通过。 |

真实官方 API 与消费者人工入口核验仍外部受阻，不能标通道已支持，不勾选 T-M0-04。本轮验收使用隔离库中的合成通道与 SOP。
