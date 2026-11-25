# #135 报价订单页

2026-11-25。品牌负责人从「账户设置 → 报价订单」进入后，可以从页首开始登记或查看本人订单。没有可登记品牌时可前往品牌资料。已有订单时，即使品牌归档，也能从页首查看历史。

本轮覆盖 [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) 的入口、状态反馈、键盘和双语响应式场景，以及 [S-M2-03](../specs/M2.md#s-m2-03) 的 AC-M2-03-3 报价登记路径。

## 实现

- 页首复用共享按钮，登记入口聚焦品牌字段，历史入口聚焦「我的订单」标题。读取故障保留页首和恢复入口。表单提示随界面语言切换。
- 订单卡片显示品牌、已报价或未报价、待支付或草稿、最小货币单位的金额和币种。记录时间以界面语言格式显示 UTC，时间元素保留原始时间戳。归档品牌的历史以品牌 ID 定位。
- 基线 `77b19ea5e20f7c52f1b27363a7d45e58be515823` 的隔离浏览器走查通过账户设置进入订单页，但在中文 375 像素页面找不到页首「开始登记」。截图位于 `.cache/issue-135/orders/baseline-375.png`。

## 验收证据

- `zh-CN` 和 `en` 各在 375、768、1440 像素核对无品牌、可以登记且无订单、已有订单，以及唯一品牌归档后的历史。工作台位置可见，主内容区唯一，页首主操作完整位于视口。长品牌名在订单卡片内换行，原生下拉框收起时会截断长选项。
- 键盘从页首聚焦品牌并依次操作已报价、金额、币种及登记按钮。负数提交被拒绝。登记请求挂起时再次按 Enter 只发一笔请求，注入 503 后保留焦点和字段，数据库仍为空。切换英文后可在原表单重试，成功后清空字段并刷新订单列表。
- 已报价的 `1200 CNY` 回读为 `awaiting_payment`，未报价的 `50 USD` 为 `draft`，两笔均为 `paid=0`，页面金额和币种随界面语言切换保持一致。伪报已收款返回 400，另一账号读写返回 404，订单列表为空。唯一品牌归档后，新增订单返回 404，原有两笔订单逐字段一致。
- 在两种语言的 375 像素下核对加载、读取故障与键盘重新载入。读取故障隐藏字段、已有订单和内部异常。浏览器使用临时账号和合成记录，测试结束后回读确认账号、品牌、版本和订单已清理。

| 验证 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3219 个消息键、7 项测试 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，17 项 |
| `node --conditions=react-server --test tests/commercial/orders.test.mjs` | 通过，3 项，包含 SQLite3 和 PostgreSQL，零跳过 |
| `pnpm exec playwright test tests/e2e/quote-orders.spec.ts tests/e2e/m0-flow.spec.ts` | 临时迁移的回环 PostgreSQL、进程内缓存、Chrome，2 项通过 |
| `pnpm exec playwright test tests/e2e/quote-orders.spec.ts --trace on` | 配置的回环开发 PostgreSQL 与 Chrome，1 项通过 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过，开发预检 15 项，文档核对 81 个验收 ID |

本地 `.cache/issue-135/orders/` 保存可由浏览器用例重建的 30 张交付截图，以及 1 张基线截图。首次隔离联合走查的部分画面出现工作台会话检查提示。开发库单独走查的浏览器 trace 中 33 次会话检查均返回 200。

## 后续

[#135](https://github.com/Godyu97/geo-pro/issues/135) 保持开放。下一项可走查账户设置的「交付签收」，核对双语三视口的待签收、已签收和争议状态，以及角色可执行的操作和回读结果。整站路由覆盖及其余入口回归仍待汇总。T-M2-03 正式验收需要 T-M1-07、T-M1-08、T-M1-GATE 和获准的多品牌代理交付场景，按实际权限、签收与账务核验。实际收款需要单独接入并核对支付凭据。
