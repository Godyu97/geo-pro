# #135 演示空间

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M0-04 第 5 条](../specs/M0.md#s-m0-04) · [指标与证据合同](../07-指标与证据合同.md)

## 用户路径与覆盖

品牌负责人从「AI 监测 → 证据概览 → 打开演示空间」进入时，可以辨认演示范围，直接查看当前品牌记录或键盘进入填写。无品牌时可前往品牌资料，读取失败时可在原品牌重新载入。已有的归档品牌深链接仍可用，有新活跃品牌时可从归档记录返回当前品牌。覆盖公共视觉合同的入口、状态、双语响应式和键盘操作，以及 S-M0-04 的演示空间边界。

| 入口 | 核对内容 |
| --- | --- |
| `/dashboard/monitoring/overview?brandId=…` | 「打开演示空间」携带当前品牌。 |
| `/dashboard/monitoring/demo`、`/dashboard/monitoring/demo?brandId=…` | 默认展示当前品牌。页首根据无品牌、可填写、已有记录或读取失败提供操作。渲染唯一的工作台主内容区。标题和每条记录显示演示标识。 |
| `/dashboard/brands` | 无品牌时可用键盘从演示空间进入品牌资料。 |
| `/api/monitoring/demo-observations` | 原有归属校验和演示隔离契约。保存结果未知时，表单内相同内容复用操作号。 |

基线 `411058f37efe272fbebee661a022a53f72a7c5c3` 的中文 375 像素截图显示无品牌提示，浏览器用例找不到「前往品牌资料」入口。原页只在已有品牌查询参数或保存后显示历史。本轮将活跃品牌设为演示空间默认范围，显式深链接继续由服务端校验。

## 实际验证

- 中英文分别在 375、768、1440 像素走查无品牌、品牌无记录及已有记录。页首操作完整位于视口，页面无横向溢出。长品牌名、问题和多行回答在卡片内换行。键盘可前往品牌资料，跳到问题输入和历史标题。
- 空白问题被拒绝，焦点回到该字段。测试在服务端已保存后拦截回执，向浏览器返回 503。在途重复按 Enter 未重复发出请求。失败后保留输入和焦点，切换英文后显示对应反馈。用同一操作号重试，API 和数据库均回读同一条演示观察，问题和回答保持原文，`is_demo=true`。该品牌的自然回答、报告快照和复测均为 0 条。双库测试用合成自然回答核对了主概览的分母。
- 另一账号的页面只显示找不到记录，读写接口返回 404。读取故障在中英文 375 像素分别显示加载和恢复操作，隐藏正文与内部错误。键盘重新载入后回到原品牌。归档后旧记录仍可查看，打开新活跃品牌看到空态，数据库回读没有产生新演示记录。
- Chrome 走查使用随机临时账号及合成资料。测试结束后回读确认已清理本轮账号、品牌、品牌版本和演示观察。

| 命令 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3240 个消息键和 7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 17 项通过。 |
| `node --conditions=react-server --test tests/monitoring/demo-observations.test.mjs` | 隔离 SQLite3、PostgreSQL 与标记合同共 3 项通过，零跳过。 |
| `pnpm exec playwright test tests/e2e/demo-observations.spec.ts tests/e2e/m0-flow.spec.ts` | 迁移后的临时 PostgreSQL、进程内缓存与 Chrome，3 项通过。 |
| `pnpm exec playwright test tests/e2e/demo-observations.spec.ts --trace on` | 配置的开发 PostgreSQL 与 Chrome，2 项通过。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过，环境预检 15 项，文档核对 81 个验收 ID 和 877 个本地链接。 |

浏览器首轮联合走查中，第二次创建活跃品牌返回 409。用例改为先归档，再按现有入口创建新品牌和核对旧深链接。双库合同首轮发现新版中文页首缺少「演示数据」字样，补齐后复跑通过。

本地 `.cache/issue-135/demo/` 保存 1 张基线截图和 17 张可由浏览器用例重建的交付截图。代表截图为 `no-brand-zh-CN-375.png`、`focus-zh-CN-375.png`、`history-en-375.png`、`read-unavailable-zh-CN-375.png`。

## 剩余

#135 继续开放。下一步按现有页面与公共状态对照本单已有记录，优先补维护支持定位等缺少双语视口证据的入口，再复核全站关单条件。当前表单的重试操作号保留在该页面会话内，跨页面恢复仍待核验。正式采样和阶段验收仍由相应任务和试点条件跟踪。
