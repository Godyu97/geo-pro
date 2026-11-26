# Issue #169 已结算周计划复盘

2026-11-26。R-M2-05 · T-M2-05 · S-M2-05 第 3 条及输出 · AC-M2-05-2 回归。 [Issue #169](https://github.com/Godyu97/geo-pro/issues/169) · [规格](../specs/M2.md#s-m2-05)

负责人可在 `/dashboard/assistant/plans` 打开已结算计划，确认一句最多 500 字的下一步建议并保存。原每周行动入口也显示复盘。服务端从同一计划的结算条目统计已执行项和事实失效受阻项，未确认项不进入两个计数。复盘保存这些计数、建议原文、计划编号和保存时间，供两种界面语言回读。

`GET / POST /api/assistant/plans/[id]/review` 校验实际会话和归属。保存沿用负责人及计划锁。一份计划只保留一条复盘，相同正文重试返回同一编号，提交不同正文返回 409。空白、多行和保证收益表述被拒绝。复盘写入只触及 `assistant_plan_review`，删除关联计划时随之清除。

## 验收结果

| 工单场景 | 实际结果 |
| --- | --- |
| 1. 在已结算计划保存与回读 | 隔离 Chrome 走查经原执行接口结算，再分别用中英文页面保存，同一计划均读回 1 项已执行、1 项因事实失效受阻。预算为 2,500 最小货币单位，品牌下计划条数为 2，保存前后相同。复盘重试返回相同编号。双方言隔离用例另核对计划、条目与额度授权全行，`guaranteed` 和策略标签保持原值。 |
| 2. 拒绝草稿与保证收益 | 草稿直接提交返回 409，空白及「必有效」或 `guaranteed improvement` 返回 400，复盘行数不增加。双方言另外覆盖「高胜率」、多行、并发同正文、不同正文冲突和事务回滚。 |
| 3. 跨账号隔离 | 两个真实登录会话使用合成账号。另一账号用现有或不存在的计划编号读复盘，均得到相同的 404 响应，页面和响应均不含建议正文。 |

| Chrome 合成用例 | 计划编号 | 复盘编号 | 保存前后预算 |
| --- | --- | --- | --- |
| `zh-CN` | `68fe8dad-b80f-4e9b-876a-7c55d87c566b` | `062410b6-73b9-4f57-8538-5554b08ff3bd` | 2,500 → 2,500 |
| `en` | `3cf695c2-f1e3-424a-8f77-0cf7c0212eeb` | `7aec7fc9-97e8-4ad4-ab51-13e2ce5bbcc8` | 2,500 → 2,500 |

## 工程与环境核验

| 命令 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。构建包含周计划入口及复盘 API。 |
| `pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check` | 通过。PostgreSQL `0093_worried_reaper` 与 SQLite `0092_hard_mathemanic` 只新增复盘表、计划外键和每计划唯一索引。 |
| `pnpm exec node --conditions=react-server --test tests/assistant/*.test.mjs` | 6 项通过。双方言从含历史草稿和已结算计划的上一版升级，另以空库导入全量 DDL 并对照。列表返回 4 条和从 1,200 条取 20 条时均执行 4 次查询，其中复盘批量读取 1 次。本轮 SQLite 分别观测 0.6 ms、1.8 ms，PostgreSQL 为 1.0 ms、7.6 ms。双方言计划查询使用 `assistant_plan_owner_idx`，复盘按计划查找使用 `assistant_plan_review_plan_uidx`。初始小表数据下 PostgreSQL 选择顺序扫描，调整隔离数据后断言通过。 |
| `pnpm check:i18n`、`pnpm test:i18n`、`pnpm check:feature-map` | 通过。3,906 个键及参数一致、7 项测试通过、70 个页面路径已登记。 |
| `pnpm test:e2e tests/e2e/assistant-plans.spec.ts tests/e2e/strategy-templates.spec.ts` | 3 项通过。隔离 PostgreSQL 与 Chrome 覆盖两种语言的键盘提交、刷新回读和 375、768、1440 像素视口。英文用例曾因测试从页面末尾按钮向后移动焦点失败，改为从复盘输入框按 Tab 到保存按钮后重跑通过。临时账号及记录已清理。375 像素截图可在本地 `.cache/issue-169/` 查看或用测试重生成。 |
| `pnpm env:check`、`pnpm db:migrate` | 通过。配置的回环开发 PostgreSQL、Redis、S3 预检共 15 项通过，已核对开发库新增表。双方言隔离库的迁移也通过。 |
| `pnpm verify:auth` | 通过。使用配置的回环开发 PostgreSQL，验证了注册、登录、授权读写、来源限制和伪造、过期、撤销会话拒绝。已清理两个临时账号及会话。 |
| `python docs/tools/validate_docs.py` | 通过。需求映射、链接与计算样例通过。 |

所有复盘样例为合成验收数据，提交路径未调用模型、采样、发布或付款。T-M2-05 与 T-M2-GATE 仍待正式验收。
