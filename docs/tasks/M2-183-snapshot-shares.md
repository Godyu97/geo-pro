# Issue #183 从真实报告快照创建受控白标分享

2026-11-27。 [Issue #183](https://github.com/Godyu97/geo-pro/issues/183) · [S-M2-03](../specs/M2.md#s-m2-03) · [AC-M2-03-2](../specs/M2.md#s-m2-03)

在 `/dashboard/reports/shares` 移除手填轨道、样本量和结论等级表单，改为从已有报告快照（`report_snapshot`）创建受控预览并同步沿用品牌授权（`authorizeBrandActor` / `accessibleBrands`），同时提供受控预览页面 `/dashboard/reports/shares/[id]`。获准查看者（`owner`、`member`、`read_only`）可查看与原快照一致的样本统计、轨道、结论等级和限制说明，撤销或过期后原预览入口与接口立即失效，历史访问记录保留实际访客 ID。本记录不勾选 `T-M2-03`。

## 交付范围

- **数据库与迁移**：PostgreSQL（`0101_nervous_ken_ellis.sql`）与 SQLite（`0100_safe_the_hunter.sql`）在 `whitelabel_share` 新增 `snapshot_id`（外键级联 `report_snapshot.id`）、`limitations_json` 与 `sample_summary_json` 及品牌/快照索引与约束校验，并同步更新全量 DDL。
- **领域与品牌授权**：`shareRegistrationInput` 仅接收 `{ brandId, snapshotId, expiresAt }` 并继续拦截效果保证文案和手填指标字段；`registerWhitelabelShare` 校验 `write` 品牌授权并从真实快照读取轨道、样本计数、结论等级与限制说明；`viewWhitelabelShare` 与 `loadShareWorkspace` 复用 `read` 品牌授权（支持 `read_only` 查看者并记录实际 `visitor_id`）；`revokeWhitelabelShare` 校验 `write` 授权并保留既有访问记录；待 `#182` 接入外部委托后可直接复用同一授权边界。
- **页面与双语**：`/dashboard/reports/shares` 按所选品牌列出可选报告快照，`/dashboard/reports/shares/[id]` 展示受控白标预览，撤销或过期或无权访问返回 `NOT_FOUND`；同步更新 `zh-CN` / `en` 消息与 `docs/feature-map/reports-commercial.md`。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 静态、双语与 DDL | `pnpm lint`（0 错误，8 条既有告警）、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`（4119 键）、`pnpm test:i18n`（7/7）、`pnpm check:feature-map`（71/71）、`pnpm db:ddl:check` 与 `python3 docs/tools/validate_docs.py` 均通过。 |
| 迁移与双库测试 | 开发 PostgreSQL 执行 `pnpm db:migrate` 成功。`node --conditions=react-server --test tests/commercial/*.test.mjs tests/team-access/*.test.mjs`（29/29，覆盖 SQLite3/PostgreSQL 迁移、DDL 对照、快照提取、`read_only`/`member`/`outsider` 授权、撤销保留记录与索引计划）、`pnpm test:reports` 与 `pnpm test:query-plans`（4/4）均通过。 |
| 隔离 Chrome E2E | `pnpm exec playwright test tests/e2e/white-label-shares.spec.ts` 通过，覆盖无快照引导、从真实快照创建分享、中英文 375/768/1440 布局、获准只读查看者打开 `/dashboard/reports/shares/[id]`、禁止只读新建/撤销（403）、外部账号 404 及撤销后原入口失效。 |
| 开发环境实测 | 在本地启动连接开发 PostgreSQL、Redis、私有 S3 与官方 Responses 配置的服务（`http://localhost:3115`），以持久 `owner` 为主品牌 `674a4755` 完成官方监测运行 `7f74ee06`（3 槽位已知费用 CNY 0.03）并生成真实诊断快照 `9359028f`（`incomparable` / `model_api` / 冻结 3 题 / 共同 0 / 样本 0）；创建分享 `3e413526` 后，持久 `readonly` 与 `member` 分别在中英文与 375/768/1440 视口打开 `/dashboard/reports/shares` 与 `/dashboard/reports/shares/3e413526` 回读一致轨道、样本与限制说明并记下 6 条访问记录；`readonly` 新建/撤销返回 403，`outsider` 返回 404；`owner` 撤销分享后，`readonly` 重开原入口 `/dashboard/reports/shares/3e413526` 与读取接口返回不存在/404，访问历史保留。 |
| 未验证 / 阻塞项 | 跨组客户委托分享待 `#182` 解除阻塞并接入统一品牌授权后复验；商业交付闭环与阶段验收仍由 `T-M2-03` 及 `#190` 跟踪。 |
