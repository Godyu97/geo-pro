# #135 交付签收页

2026-11-25。品牌负责人从「账户设置 → 交付签收」进入后，可以在页首处理第一项待签收交付、开始登记或查看本人历史。没有品牌和历史时，可前往品牌资料。读取失败时保留页面标题并提供重新载入。

本轮覆盖 [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) 的入口、状态反馈、双语响应式和键盘交互，以及 [S-M2-03](../specs/M2.md#s-m2-03) 的本地交付状态。签收场景对应 `pending → accepted/disputed`，S-M2-03 的编号 AC 继续分别跟踪委托、白标来源及报价登记。

## 实现和复现

- 基线 `be1f917d498ba9e5ac33a249d02897110c10ce30` 的隔离浏览器使用无品牌账号，通过账户设置打开中文 375 像素签收页。标题可见，前往品牌资料的视口断言失败，页面没有该入口。基线截图为 `.cache/issue-135/delivery-acceptance/baseline-375.png`。
- 页首复用共享按钮，入口可聚焦登记品牌、待签收交付标题或历史标题。加载使用已有骨架组件。卡片显示独立状态标签，长品牌名、标题与多行争议原因可换行。原生品牌下拉框收起时会截断长选项。
- 签收需要确认，弹窗先聚焦取消。争议表单要求填写原因，并说明该状态之后无法转为已接受。两种终态均只显示历史，签收页面说明其与收款的区别。记录时间以界面语言显示 UTC，并保留原始时间戳。

## 验收证据

- `zh-CN` 与 `en` 各在 375、768、1440 像素核对无品牌、可登记、待签收及终态历史。主内容区唯一，工作台位置可见，页首操作完整位于视口，无横向溢出。确认、读取加载与故障恢复及归档历史另在双语 375 像素检查。
- 键盘从页首聚焦品牌字段。空白标题被拒绝，请求挂起时再次按 Enter 只发一笔写入。注入 503 后保留输入和焦点，切换英文后提示更新。原位重试登记成功，表单清空，数据库回读为待签收。
- 双语签收确认默认聚焦取消，Escape 退出时回到触发按钮且无写入。签收和争议各注入一次 503，均可原位重试，争议文本保留。成功后焦点回到对应交付标题。数据库回读一项已接受，另一项争议中并保留多行原因。尝试改动任一终态均返回 409，原记录逐字段一致。
- 含收款声明的登记返回 400。第二账号看不到交付标题或卡片，尝试登记、签收或争议均返回 404。归档唯一品牌后，可从页首打开历史，新增返回 404。
- 读取故障不显示原记录、表单或内部异常。键盘重新载入可恢复。两套环境均使用本轮临时账号和合成品牌，结束后回读确认账号、品牌、版本及交付记录已清理。

| 验证 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3226 个消息键、7 项测试 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，17 项 |
| `node --conditions=react-server --test tests/commercial/deliveries.test.mjs` | 通过，3 项，SQLite3 和 PostgreSQL 零跳过。首次发现未配置 `GEO_DUAL_DB_URL`，使用本轮创建并清理的回环隔离库显式设置后运行 |
| `pnpm exec playwright test tests/e2e/delivery-acceptance.spec.ts tests/e2e/quote-orders.spec.ts tests/e2e/m0-flow.spec.ts` | 临时迁移的回环 PostgreSQL、进程内缓存及 Chrome，3 项通过 |
| `pnpm exec playwright test tests/e2e/delivery-acceptance.spec.ts` | 配置的回环开发 PostgreSQL 和 Chrome，1 项通过 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 开发环境预检 15 项通过，文档核对 81 个验收 ID 和 867 个本地链接，通过 |

可由浏览器用例重建的 34 张交付截图及 1 张基线截图保存在 `.cache/issue-135/delivery-acceptance/`。代表截图包括 `pending-en-375.png`、`confirmation-zh-CN.png`、`disputed-en-375.png` 和 `read-failure-zh-CN-375.png`。

## 后续

[#135](https://github.com/Godyu97/geo-pro/issues/135) 保持开放。可从「账户设置 → 套餐权益」用临时账号核对双语三视口下的可登记、版本历史、用量和越权拒绝，再汇总全站路由覆盖。登记验证只覆盖请求在途拦截和明确失败重试，结果未知后的跨请求去重仍待单独核验。正式 T-M2-03 验收需 T-M1-07、T-M1-08、T-M1-GATE 及获准的多品牌代理场景，按实际权限、交付签收与账务回读验证。
