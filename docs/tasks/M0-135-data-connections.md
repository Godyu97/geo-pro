# M0-135 数据连接预览

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M2-04](../specs/M2.md#s-m2-04)

品牌负责人从「账户设置」打开 `/dashboard/settings/data-connections`。页首可进入登记表单，也可跳到待批准预览并核对字段顺序和数量。无可登记品牌时可进入品牌资料，读取失败时可在原路由重新载入。连接卡片区分预览、已批准和本地拉取尝试，并用文字说明当前拉取条件。

基线 `5e4c20d22c9f5227dd948c5b7a2ab6eacbfcf579` 在隔离 Chrome 中文 375 像素下复现。从账户设置按 Enter 打开页面后，「开始登记」预期有 1 个，实际有 0 个。截图保存在 `.cache/issue-135/data-connections/baseline-zh-CN-375.png`。

## 隔离验收

Chrome 使用新建并迁移的回环 PostgreSQL、两个临时账号和合成输入。浏览器通过应用接口写入，随后读取页面与数据库。加载和读取失败由应用副本注入，登记和批准失败由浏览器返回 HTTP 503。

| 场景 | 实际结果 |
| --- | --- |
| 入口、主题与布局 | 有品牌无记录、待批准、已批准和无品牌均通过 `zh-CN` / `en` 的 375、768、1440 像素检查。账户设置位置可见，主内容区唯一，页首主要操作完整位于视口，页面无横向溢出。长品牌、连接名和字段名在卡片内换行。原生品牌下拉框收起时会截断长选项。 |
| 登记、校验和重试 | 中文窄屏按 Enter 聚焦品牌字段，焦点环可见。重复字段被拒绝，数据库无写入。登记返回 503 时输入及按钮焦点保留，切换英文后错误文案更新且输入保留。重试返回 200，成功提示可读，表单清空。数据库回读为 `preview`，三个字段的数量和顺序与提交一致。 |
| 审批边界和本地尝试 | 页首待批准操作聚焦记录标题。批准前尝试拉取返回 409，字段和记录均保持原值。批准返回 503 后按钮焦点仍在原位，数据库维持预览。重试后状态为 `approved`，焦点回到记录标题，按 Tab 和 Enter 可记录一次拉取尝试。重复请求的 API 返回同一编号、字段范围和尝试时间。数据库回读一致，咨询事件行数为 0。覆盖 S-M2-04 的批准前字段预览和本地模拟尝试。 |
| 加载、恢复、归属和清理 | 双语窄屏可见加载状态。品牌标签读取失败时保留标题与「重新载入」，隐藏连接记录、品牌、表单和内部异常。解除故障后按 Enter 可恢复，数据库回读一致。第二账号登记原品牌、批准或拉取其连接均返回 404。账户、品牌、版本、连接和字段均清理并回读确认。 |

二十五张交付截图和一张基线截图保存在本地 `.cache/issue-135/data-connections/`。交付截图可用浏览器命令重建。首次整组运行时，新用例在读取 Playwright 浏览器响应体时超时。页面已显示登记成功，隔离数据库中已有预览。调整后用浏览器 HTTP 状态、可见反馈和数据库回读验证写入，用单独的 HTTP 请求回读拉取回执。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3177 个消息键、7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，17 项。 |
| `node --conditions=react-server --test tests/data-connections/preview.test.mjs` | 通过，4 项、零跳过，含 SQLite3 和 PostgreSQL。 |
| `pnpm exec playwright test tests/e2e/data-connections.spec.ts tests/e2e/connector-events.spec.ts tests/e2e/m0-flow.spec.ts` | 复跑通过，隔离 Chrome 3 项。 |
| `pnpm exec playwright test tests/e2e/data-connections.spec.ts` | 配置的回环开发 PostgreSQL 1 项通过。合成数据已清理并回读确认。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过，开发预检 15 项，文档校验 81 个验收 ID 和 849 个本地链接。 |

隔离浏览器使用 `tests/maintenance/helpers.mjs` 的 `testDatabase("postgresql")`。将临时库配置交给 Playwright，开启两项邮件 Mock，结束后调用 `cleanup()`。

## 剩余验收

#135 继续跟踪全站路由和状态覆盖。本轮使用一个活动品牌，多个品牌或仅有历史连接的页面待单独走查。下一步可从「账户设置 → 同步授权」使用临时账号走查登记、撤销后下一次拉取受限、历史记录回读和读失败恢复，并覆盖两种语言及三个视口。

实际站点、日志或业务系统的同步需要获准数据源、最小字段范围和实际运行条件。S-M2-04 的真实同步和撤销，以及 M2 阶段门禁，仍待核验。
