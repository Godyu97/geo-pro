# M0-135 线索有效性

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M1-07、AC-M1-07-2 和 AC-M1-07-3](../specs/M1.md#s-m1-07)

市场运营从「复测与报告」打开 `/dashboard/reports/lead-quality`，可以先确认活动品牌，再设置第一版规则或查看现有版本。设置入口聚焦第一个条件，查看入口聚焦规则版本标题，冻结完成后焦点转到该版本的第一个判定条件。读取故障时保留页面标题和重新载入操作。

基线 `480534698a6f4d26db959ddd8bb820a6858fdff6` 在隔离 Chrome 的中文 375 像素下复现。从报告区进入后，页面没有能直接聚焦规则表单的「设置规则」入口。

## 隔离验收

Chrome 使用回环开发 PostgreSQL、合成品牌和两个临时账号。读取故障仅在隔离源码副本注入。计数来自手工输入的合成数据。

| 场景 | 实际结果 |
| --- | --- |
| 报告入口和视口 | 从复测与报告用 Enter 打开线索有效性。有品牌的空态与已有规则状态，以及无品牌状态，在中文和英文的 375、768、1440 像素下均显示报告区位置和唯一主内容区。主要操作完整位于视口，页面无横向溢出，80 字符品牌名可以换行。 |
| 资格规则 | 中文 375 像素用键盘选择三个条件并保存版本 1。冻结前的判定不计入合格数。冻结后，条件不齐时判定不合格，齐备时判定合格。API 回读合格数为 1，三条判定均绑定版本 1。修改目标行业条件后建立未冻结的版本 2，版本 1 仍冻结，条件及历史判定保持原值。 |
| 转化和访问观察 | 中文 375 像素递交负分母时被原生校验阻止，API 回读仍为空。留空并保存后，引荐计数为 17，转化率为 N/A，并显示分母缺失原因。通过 API 另登记零分母和正分母记录，前者保留引荐计数 3 并显示 N/A，后者把 4/10 显示为 40.0%，API 回读仍为 0.4。爬虫访问 4 和回答引用 0 分开展示，API 回读 `calledIncluded: false`。两种语言和三种宽度的记录对应同一份数据，覆盖 AC-M1-07-2 和 AC-M1-07-3 的隔离场景。 |
| 读取失败与恢复 | 两种语言在 375 像素下注入读取失败，保留标题、提示及重新载入；隐藏品牌、计数、表单和内部错误。解除故障后用 Enter 重新载入，API 回读与故障前一致。 |
| 权限与清理 | 第二账号看到建档入口。读取原品牌、保存规则和冻结其规则均返回 404。原记录未发生变化。清理后按临时账号和品牌 ID 回读，账号、品牌、品牌版本、资格规则、判定和观察计数均为零。 |

改动后的十张合成数据截图保存在本地 `.cache/issue-135/lead-quality/`，可用下列浏览器命令重建。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3160 个消息键、7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，17 项。 |
| `node --conditions=react-server --test tests/business-feedback/quality.test.mjs` | 通过，3 项、零跳过，覆盖 SQLite3 与 PostgreSQL。 |
| `pnpm exec playwright test tests/e2e/lead-quality.spec.ts tests/e2e/business-leads.spec.ts tests/e2e/m0-flow.spec.ts` | 通过，3 项隔离 Chrome 验收与回归。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过，开发预检 15 项，文档校验 26 项需求、29 项任务、81 个验收 ID 和 836 个本地链接。 |

## 剩余验收

全站路由与界面状态覆盖仍待继续。下一步可从 `/dashboard/reports/lead-suggestions` 走查草稿的空态、状态变化和失败恢复。活动品牌读取期间发生归属变化的页面分支未单独注入。获准真实线索、访问日志和正式阶段验收仍待核验。
