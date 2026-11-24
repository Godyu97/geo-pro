# M0-135 跨源事件

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M2-04](../specs/M2.md#s-m2-04)

市场运营从「复测与报告」进入 `/dashboard/reports/connector-events`，可从页首聚焦夹具行。没有可导入的品牌时，可前往品牌资料。读取失败时，可在原路由重新载入。事件卡片显示品牌、事件键、咨询计数、摘要状态和来源。页面明确标示使用合成行验收。

基线 `a7356fbcf8c40372a72d0c8161516e1d3d7276e5` 在隔离 Chrome 中文 375 像素下复现。用 Enter 从报告区打开跨源事件后，「开始导入」入口断言预期为 1，实际为 0。基线截图为本地 `.cache/issue-135/connector-events/baseline-zh-CN-375.png`。

## 隔离验收

Chrome 使用新建并迁移的回环 PostgreSQL、临时账号、合成品牌和非客户事件键及摘要。表单经实际应用接口写入并读取。加载和读取故障由应用副本注入，保存故障由浏览器返回 HTTP 503。

| 场景 | 实际结果 |
| --- | --- |
| 页面覆盖与双语布局 | 有品牌无事件、已有事件、无品牌在 `zh-CN` / `en` 的 375、768、1440 像素下均显示报告区位置和唯一主内容区。页首主要操作完整位于视口，页面无横向溢出。中文窄屏用 Enter 聚焦夹具行，焦点环可见。英文无品牌可键盘进入品牌资料。长品牌名、事件键和摘要在卡片内换行。原生下拉框收起时会截断长选项。 |
| 导入校验与反馈 | 无效摘要保留输入并标记字段，API 回读无写入。保存 503 后保留输入与按钮焦点，切换英文后文案更新、输入保留，API 回读一致。重新用 Enter 提交后显示保存成功，表单清空。 |
| 来源、去重与冲突 | 先导入 CSV，再导入同键、同摘要的连接器行。列表和单条 API 回读同一事件，计数为 1，两条来源都保留。重投连接器行回读完全相同。改投不同摘要后，同一事件标为冲突，计数和两条已保存的来源摘要保持一致。两种语言的记录卡片明确说明该事件未写成推荐或收录。覆盖 AC-M2-04-1 的隔离页面与数据路径。 |
| 加载、失败恢复与权限 | 双语窄屏可见加载提示。品牌标签读取失败时保留标题及重新载入入口，品牌、表单、事件和内部异常均不显示。清除故障后按 Enter 恢复，回读与故障前一致。第二账号读取原事件和向原品牌导入均返回 404，且自己的列表为空。数据库回读确认临时账号、品牌、品牌版本、事件和来源均已清理。 |

十九张交付截图和一张基线截图保存在本地 `.cache/issue-135/connector-events/`，包括空态、记录、无品牌、加载、读取失败和中文字段焦点。交付截图可由浏览器用例重建。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3171 个消息键、7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，17 项。 |
| `node --conditions=react-server --test tests/data-connections/events.test.mjs` | 通过，4 项、零跳过，含 SQLite3 和 PostgreSQL。 |
| `pnpm exec playwright test tests/e2e/connector-events.spec.ts tests/e2e/crawler-visits.spec.ts tests/e2e/m0-flow.spec.ts` | 通过，隔离 Chrome 3 项。 |
| `pnpm exec playwright test tests/e2e/connector-events.spec.ts` | 通过，配置的回环开发 PostgreSQL 1 项。使用合成输入，临时账号和业务记录清理后回读为空。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过，开发预检 15 项，文档校验 81 个验收 ID 和 846 个本地链接。 |

隔离浏览器使用 `tests/maintenance/helpers.mjs` 的 `testDatabase("postgresql")` 创建临时库。将返回的 `env` 交给 Playwright，开启两项邮件 Mock，结束后调用 `cleanup()`。

## 剩余验收

#135 保持开放。下一步可从 `/dashboard/settings/data-connections` 走查预览、审批状态、无品牌和读取恢复，补齐双语及视口证据。本轮浏览器用一个活动品牌核对导入，多活动品牌选择和仅存历史事件的状态待单独走查。AC-M2-04-1 真实连接器同步依赖获准数据源和最小字段范围，真实授权、撤销和正式阶段验收待对应条件具备后核验。
