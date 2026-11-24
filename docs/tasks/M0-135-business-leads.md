# M0-135 脱敏线索

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M1-07 与 AC-M1-07-1](../specs/M1.md#s-m1-07)

品牌负责人从「复测与报告」打开 `/dashboard/reports/leads`，可以在页首先确认活动品牌，再用键盘进入线索行字段。没有记录时，空态在导入表单之前。导入反馈显示接收结果和逐行拒绝原因，去重台账保留来源标签。页面读取失败时保留标题和重新载入操作。

基线 `53fda691664ccfa4f07e6f9d806eb5d326160e9b` 在隔离 Chrome 的中文 375 像素下复现。从报告区打开脱敏线索以后，页面缺少能直接聚焦线索行的「开始导入」入口。

## 隔离验收

Chrome 使用回环开发 PostgreSQL、合成品牌和两个临时账号。读取故障仅在隔离源码副本注入。导入使用合成事件编号，无真实咨询资料、模型调用或外部抓取。

| 场景 | 实际结果 |
| --- | --- |
| 报告入口与空态 | 从复测与报告用 Enter 打开脱敏线索。中文和英文在 375、768、1440 像素均显示报告区位置、唯一主内容区、品牌名称和空态。主要操作完整位于视口，页面无横向溢出。80 字符品牌名称在内容区内换行。 |
| 格式错误与修正 | 中文 375 像素用 Enter 激活「开始导入」，焦点到线索行。提交少一列的输入时显示校验提示，输入保留，API 回读为空。修正后可再次用 Enter 提交，完成后焦点保留在导入按钮。 |
| 去重与拒绝 | 提交相同 64 字符事件 ID 的自报和可识别引荐，另提交一行标记含直接身份信息和一行缺 ID 的数据。表单逐行说明后两行被拒绝，API 回读仅一条咨询，计数为 1，主分类为可识别引荐，证据为用户自报与可识别引荐，符合 AC-M1-07-1。重开页面后，两种语言和三种宽度的台账均对应同一条记录，长 ID 留在卡片内。 |
| 读取失败与恢复 | 英文 375 像素注入读取失败，标题和重新载入操作可用，页面未显示品牌、事件 ID、表单、空台账提示或内部错误。解除故障后用 Enter 重新载入，API 回读与故障前一致。 |
| 权限与清理 | 第二账号在两种语言和三种宽度显示建档入口，读取列表和导入同一品牌的 API 均返回 404。原记录未发生变化。清理后按临时账号和品牌 ID 回读，账号、品牌、品牌版本、线索及证据均为零。 |

八张合成数据截图保存在本地 `.cache/issue-135/business-leads/`，可用下列浏览器命令重建。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3156 个消息键、7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，17 项测试。 |
| `node --conditions=react-server --test tests/business-feedback/leads.test.mjs` | 通过，3 项、零跳过，包含 SQLite3 和 PostgreSQL 的去重、拒绝、重试和归属验证。 |
| `pnpm exec playwright test tests/e2e/business-leads.spec.ts tests/e2e/m0-flow.spec.ts` | 通过，2 项隔离 Chrome 用例。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过，15 项开发预检，文档校验 81 个验收 ID 和 833 个本地链接。 |

## 剩余验收

全站路由和界面状态覆盖仍待继续。下一轮可从线索有效性页 `/dashboard/reports/lead-quality` 开始，用临时账号核对双语、窄屏、资格规则和记录回读。AC-M1-07-2 的转化率分母和 AC-M1-07-3 的爬虫观察由对应报表路径另验。获准真实线索及阶段验收仍待核验。
