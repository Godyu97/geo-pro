# Issue #140 资料片段与未批准冲突

2026-11-24。 [Issue #140](https://github.com/Godyu97/geo-pro/issues/140) · [R-M1-04](../02-产品需求文档-PRD.md) · [S-M1-04](../specs/M1.md#s-m1-04) 第 2 条 · AC-M1-04-1

## 交付范围

- 内容运营在 `/dashboard/content/sources` 导入可提取文本后，能看到每个片段、已有页码或缺失，以及与同品牌已批准事实的冲突。
- 文本里的换页符 `\f` 分成明确页。没有换页符时保留正文，页码记为缺失，不补页码。空页保留页码，正文记为缺失。PDF 仍不调用外部抽取，不能识别的页只记缺失。
- 片段与同品牌已批准事实的 `claim` 逐条比较。文本不同才指向该事实版本；相同或没有已批准事实则没有冲突。候选状态固定为 `unapproved`，导入不写入事实审批。
- 加密、超限、无法识别和超过 10 个的文件仍然失败，不产生片段。同批成功文件只上传一次。
- 品牌负责人和有效成员可以阅读片段。另一品牌的成员、过期授权和无授权的人被拒绝，响应里没有片段正文。
- 权利撤销或到期后不能再下载。片段行和冲突仍留在库里；页面不再显示正文，并标成不可读。
- `zh-CN` / `en` 都说明未批准、缺失和不可读。本记录不勾选 T-M1-04。

## 查询路径

导入在同一事务里读取该品牌 `state = 'approved'` 的事实版本，再各批量写入 `source_original`、`source_original_fragment` 和 `source_original_fragment_conflict`。失败文件不写片段。列表先按原有原件查询取出最多 50 条，再按来源 id 分块读取片段和冲突，每块最多 100 个 id。

片段列表走 `source_original_fragment_brand_idx`。冲突列表走 `source_original_fragment_conflict_brand_idx`。SQLite 计划是 `SEARCH source_original_fragment USING INDEX source_original_fragment_brand_idx`，冲突是该索引上的 covering search。PostgreSQL 计划是 `Index Scan using source_original_fragment_brand_idx`，冲突是 `Index Only Scan using source_original_fragment_conflict_brand_idx`。隔离测试里一次列表是 1 次片段查询和 1 次冲突查询。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发 PostgreSQL、Redis 和对象存储探针通过。邮件仍是长期 mock。`pnpm db:migrate` 已把本迁移应用到开发 PostgreSQL。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。 |
| 双语 | `pnpm check:i18n` 通过，3028 个键。 |
| 结构 | `pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check` 通过。隔离库从既有迁移升级到最新，并与全量 DDL 结构一致。 |
| 隔离行为 | `pnpm test:asset-reuse` 13 项通过，`pnpm test:brand-facts` 3 项通过。两页文本里第一页保留正文和页码，第二页正文缺失，文件为部分成功，已批准事实条数不变。不同的事实版本出现在冲突里，相同文本和另一品牌的事实不出现。第 11 个文件和加密文件没有片段，成功文件的对象上传次数不包含它们。另一品牌成员和过期成员得到 `NOT_FOUND`，查询没有读取片段表。撤销后页面正文为空，库里的 excerpt 和冲突行仍在。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/source-fragments.spec.ts` 1 项通过。隔离账号导入含换页符的 `two.txt` 后，中文页看到第一页正文、页码 1、第二页缺失、页码 2，以及指向该事实版本的冲突和未批准说明。事实版本仍是导入前的 1 条。英文页显示 “Page 1”、“Page 2” 和 “The candidate is not approved.”。1440 与 375 宽度没有横向溢出。临时账号和本次 `stored_object` 行已清理。 |
| 未验证 | 没有用获准客户资料或扫描件走查。PDF 不抽取正文。不把本次结果写成 T-M1-04 或阶段门禁通过。 |
