# Issue #141 到期人工题单列出冻结题目

2026-11-24。 [Issue #141](https://github.com/Godyu97/geo-pro/issues/141) · [R-M1-01](../02-产品需求文档-PRD.md) · [S-M1-01](../specs/M1.md#s-m1-01)

## 交付范围

- 负责人在 `/dashboard/monitoring/plans` 看到已保存人工题单时，每道题显示冻结正文、题目 id，以及“人工，非自动采集”。正文来自该品牌最新一份可解析的冻结题集。
- 题单 id 不在这份题集里时保留 id，并标缺失。不改用旧版正文，也不拿另一品牌或另一道题填上。
- 再次处理同一到期窗口不新增人工行，也不再调用官方执行器。页面上的处理表单现在会提交计划 id；之前缺这个字段时，按钮会以无效输入返回。
- `zh-CN` / `en` 都标明这是人工题单。题目正文不随界面语言改变。
- 本记录不勾选 T-M1-01，也不替代 #31 的消费者入口实测。

## 查询路径

计划页先按负责人和计划 id 读取到期行，再在存在人工题单时读取该品牌最新题集一行：`prompt_set` 按 `brand_id` 过滤，`created_at DESC, id DESC`，`LIMIT 1`。没有人工题单时不读题集。另一品牌的题集不在这次查询里。

隔离库插入 500 个更早版本并 `ANALYZE` 后，双方言的这条查询都使用 `prompt_set_recent_idx`。一次题单解析是 1 次 `prompt_set` 查询。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发 PostgreSQL、Redis 和对象存储探针通过。邮件仍是长期 mock。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。 |
| 双语 | `pnpm check:i18n` 通过，3030 个键。 |
| 隔离行为 | `node --conditions=react-server --test tests/sampling-plans/*.test.mjs` 9 项通过。SQLite 与 PostgreSQL 都覆盖：两道最新冻结题显示正文，已从最新题集删除的 id 和另一品牌的 id 标缺失，旧正文和另一品牌正文不出现。同一窗口再驱动时人工行仍是 1、官方行仍是 1，执行器仍只调用 1 次，题单 id 不被第二次提交改写。`pnpm test:prompts` 5 项通过。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/manual-sheet.spec.ts`。隔离账号在计划页提交到期窗口后，中文页看到两道冻结正文、缺失 id 和“人工，非自动采集”。换一批题目编号再提交，人工行仍是 1，该品牌 `monitoring_run` 仍是 0。英文页题目正文不变，并显示 “Manual, not automatic collection” 与 “Question missing”。1440、768、375 没有横向溢出。临时账号已清理。 |
| 未验证 | 没有用获准消费者入口实测人工采集。不把本次结果写成 T-M1-01 或阶段门禁通过。没有单独做纯键盘走查。 |
