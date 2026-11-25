# Issue #163 下轮决策

2026-11-26。 [Issue #163](https://github.com/Godyu97/geo-pro/issues/163) · [S-M0-12](../specs/M0.md#s-m0-12) 第 4 条

品牌负责人在 `/dashboard/reports` 看完一份同口径比较后，保存下一步：继续内容动作、补证据、继续观察或停止。页面回读决定人、时间和动作。观察结论和快照文件保持原样。

## 范围

- 新表 `report_decision` 只追加记录。不改写快照 `conclusion`、`next_action`、JSON、HTML 或 SHA-256。
- 同一快照的同一动作只有一行。重复提交不新增，也不更新决定人或决定时间。改选另一动作时追加一行。改回已经保存过的动作不再插入，原行留在原时间。
- 决定时间保留毫秒，列表按决定时间再按编号排序。
- 只有品牌负责人可以读取和保存。其他账号与找不到快照相同，响应不含品牌结论或决策正文。没有可解析比较结论时，负责人得到 `NO_COMPARISON`，不引用快照正文。
- 保存决策不发起采样、发布或内容审批，也不删除观察、快照或费用记录。停止只结束这一轮后续动作。
- 界面 `zh-CN` / `en` 都显示四个动作和已保存结果。品牌内容导出增加决策节，只含快照编号、动作、决定人和时间。清除品牌内容时先删决策行。

## 本轮核验

- 隔离 SQLite 快照 `3c35fb35-1567-4e09-8b21-f3054cba7c0e`。保存前后 JSON SHA-256 都是 `0f35b9b4438cf59a268fbf311e56bea25587def120c09a5fd58db7fbe600be89`，HTML SHA-256 都是 `152be9cb81ca254ed0b240ebceaf284b2e852d93287f116c9fb0fae1e17784db`。提及率结论保持 `declined`。决策 `e3a3756d-9fbd-4b64-9049-2dd813637820` 为继续观察，时间 `2026-11-26T01:00:00.000Z`；同一动作在 `2026-11-26T01:05:00.000Z` 再次提交后仍是这一行。补证据为 `81f598b1-c3df-422a-90c9-24c854cae5ce`，时间 `2026-11-26T02:00:00.000Z`。列表计划为 `SEARCH report_decision USING INDEX report_decision_brand_idx (brand_id=? AND owner_id=?)`。
- 隔离 PostgreSQL 快照 `c81553c3-8678-4eef-b89f-cdedf929d016`。JSON SHA-256 `d73453518b90bfa095c33671e9a8e4809fdc5d68d356b30af05f043e65881054`，HTML SHA-256 `35eb5869e60255e1053d2f49eca1685b45a2863d5f560ac852410be8db9130c7`，保存后不变。决策 `ddb7a182-5b74-48f1-9d24-3c2e21c7d574` 为继续观察，`08d6bf24-1bce-48e7-b10b-a2119fc00a16` 为补证据。索引扫描 `report_decision_brand_idx`，2 行，执行时间 0.009 ms。
- 另一账号读取、列表和提交都是 `NOT_FOUND`，响应不含 `declined`、观察下降、动作名或品牌名。没有比较字段的历史快照返回 `NO_COMPARISON`，字节不变。清除品牌内容后决策行数为 0。
- 浏览器在隔离账号上打开诊断复跑快照 `e55823f8-5810-4085-86aa-61dc52a9f37d`。提及率显示观察下降。保存继续观察后再保存一次，仍是一行；再保存补证据后为两行。决策 `cecce1be-5d4f-477b-89a6-13db4821f79e` 时间 `2026-11-25T21:07:37.195Z`，`f2f13bd2-44fc-48c1-9dc3-bdcf63fffe26` 时间 `2026-11-25T21:07:37.494Z`。保存前后 JSON SHA-256 都是 `b9a9d81b1d595242291d94f58b2f6b5803cde8e0e9ab6416e60bc222ce741803`，提及率结论仍是 `declined`。负责人接口回读这两行，响应不含 declined 或观察下降。另一账号 GET 与 POST 都是 404，响应不含结论、动作名、快照编号或品牌名。英文 768 宽度能看到 Keep observing 与 Add evidence，两行都在，无横向溢出。没有比较的历史快照 `c3b8ecf0-4385-4600-b28b-e7dfd2e8452a` 不显示保存按钮。后继快照 `76029229-9816-4c34-959b-0da029118893` 生成后，原 JSON 字节不变。
- `pnpm db:ddl:check` 通过 PostgreSQL 与 SQLite。开发库 `pnpm db:migrate` 已应用。`pnpm env:check` 15 项通过。`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`（3841 个消息键）、`pnpm check:feature-map`、`pnpm test:reports` 与 `pnpm exec playwright test tests/e2e/report-snapshot.spec.ts` 按本轮最终代码执行。

T-M0-12 保持未勾选。正式验收仍需要获准品牌、已核验公开发布和真实前后窗口。
