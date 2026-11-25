# Issue #157 事实维护任务与影响链

2026-11-26。 [Issue #157](https://github.com/Godyu97/geo-pro/issues/157) · [S-M1-05](../specs/M1.md#s-m1-05)

内容运营在已确认事实被撤销或到期，或已发布页面被判定为线上改写、平台撤下时，在内容日历和事实页看到同一条维护任务。任务列出事实版本、稿件版本、渠道变体和线上页面。日历按渠道保存已核验或受阻。计划日不是上线日。页面撤下只保存本次核验判断，不表示系统已经远程撤下外部页面。本记录不勾选 T-M1-05，也不代替 AC-M1-05-1 的真实走查。

## 交付范围

- 维护原因增加 `mismatch` 与 `removed`。同一品牌和事实版本仍只有一条开放任务；后到的原因并入已有任务，保留先写入的原因。迁移为 `drizzle/0087_right_swarm.sql` 与 `drizzle/sqlite/0086_right_white_tiger.sql`，并已写入全量 DDL。SQLite 先复制行，再按全量 DDL 的反引号语句重建任务表和两个索引。
- 明确撤销与发布核验写在同一事务里。没有关联发布时撤销不建任务。到期由日历上的检查动作扫描，一次最多 50 条已关联事实；重复检查不另建任务。已撤下的发布仍留在影响链。单条任务最多 100 个页面。
- 日历 `/dashboard/content/calendar` 显示影响链，并按渠道提交已核验或受阻。未改动的渠道保持原状态。已核验渠道不会因其他渠道受阻被改回。事实页 `/dashboard/brands/[id]/facts` 显示开放任务并链到日历。中英文文案成对。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发库为 PostgreSQL，邮件长期 mock 开启。 |
| 结构 | `pnpm db:ddl` 后 `pnpm db:ddl:check` 通过。PostgreSQL 迁移只放宽维护原因检查。 |
| 隔离行为 | `pnpm test:continued-operations` 84 项通过，含 `tests/continued-operations/issue-157.test.mjs` 双方言 6 项。一条关联 5 个页面的事实撤销只产生 1 条任务；无关联发布时为 0。到期扫描在未到期时为 0，到期后打开 1 条、5 个页面，重复扫描不再新建。结算 2 个渠道为已核验、1 个为受阻后，已核验结果保留，其余渠道仍为计划中。先记撤下再记线上改写仍是同一条任务，原因保持撤下，撤下页面仍在链上。 |
| 查询计划 | 上述测试要求事实版本查询计划命中 `brand_fact_use`、`fact_use_content_idx` 或 `brand_fact_use_pkey`，双方言均通过。 |
| 回归 | `pnpm test:content` 54 项通过。`pnpm test:brand-facts` 5 项通过。`tests/channel-variants/maintenance.test.mjs` 3 项通过。`tests/layout/workspace-landmark.test.mjs` 30 项通过。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。`pnpm check:i18n` 3718 个键一致。`pnpm check:feature-map` 69 页通过。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/content-calendar.spec.ts` 1 项通过。中英文在 375、768、1440 像素下没有横向溢出。中文 1440 下键盘执行到期检查，结果为 0 条到期事实且撤销任务仍为 1 条；再把 site 记为已核验、zhihu 标为受阻，页面保留两种状态和核验日。 |

未连接外部 CMS，也没有远程撤下任何外部页面。AC-M1-05-1 与 T-M1-05 勾选不在本记录范围内。
