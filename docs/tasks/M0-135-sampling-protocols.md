# Issue #135 采样协议

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M0-05](../specs/M0.md#s-m0-05) · [M0-12 运行执行](M0-12-run-execution.md)

品牌负责人从「监测概览 → 查看采样协议」进入后，可从页首用键盘开始填写协议草稿或跳转查看协议版本；提交期间显示进行中状态并拦截在途重复提交；冻结并钉选版本后保持旧运行 `requested_network_mode` 与费用不变，修改时区冻结只新增版本；读取失败时隐藏品牌与运行编号且保留安全错误和可聚焦的「重新载入」入口。

## 范围与实现

- 基线 `/dashboard/monitoring/protocols` 仅在页面底部提供纯文本「返回监测」链接，缺少页首任务动作、读取失败恢复入口与共享 `Card` / `Badge` / `Input` / `Label` / 虚线空态表面，且错误与成功反馈共用 `role="status"`。
- 改动 `src/features/monitoring/protocols-page.tsx`、`src/features/monitoring/protocols-panel.tsx` 与 `src/lib/i18n/messages/{zh-CN,en}.json`：
  - 页首按状态提供主要动作（无品牌「前往品牌」、可写「填写协议草稿」、有版本「查看协议版本」及「返回监测」），使用共享 `Button` 与 `whitespace-normal` 换行。
  - 表单与版本列表接入共享 `Card`、`CardContent`、`Badge`、`Input`、`Label` 及虚线空态表面，长品牌名、时区与运行编号使用 `[overflow-wrap:anywhere]` 换行；错误提示使用 `role="alert"`，成功提示使用 `role="status"`。
  - 草稿保存、冻结协议与钉选运行均使用 `aria-disabled={pending}` 与在途防重保护；钉选表单先做 UUID 校验，避免非法输入发往服务端并保留原输入；成功保存与钉选后重置对应表单并刷新状态。
  - 读取异常时保留标题、安全错误提示、可聚焦「重新载入」主按钮与「返回监测」次按钮；标签读取降级不再阻断协议工作区加载。
- 在 `scripts/serve-i18n-fixture.mjs` 为测试夹具增加 `geo-protocols-read=slow-unavailable` 与 `geo-protocols-write=slow` 注入分支，新增 `tests/layout/workspace-landmark.test.mjs` 静态断言与浏览器回归 `tests/e2e/sampling-protocols.spec.ts`。

## 验收场景

| 场景 | 浏览器实际结果 |
| --- | --- |
| 无品牌与空协议清单 | `zh-CN` 与 `en` 在 375、768、1440 像素下均只有 1 个 `main`，页首主入口（「前往品牌」/「填写协议草稿」）完整位于视口内，无横向溢出，空态显示虚线卡片。 |
| 键盘草稿、校验保留与在途防重 | 从监测概览用键盘进入后可从页首跳至品牌选择框。小写地区触发浏览器校验，非法时区返回 `INVALID_INPUT` 并保留输入、未写库。慢速保存期间按钮显示进行中并置为 `aria-disabled="true"`，途中再按 `Enter` 仅发出 1 个 `POST`；保存后重置表单并写入草稿 v1。 |
| 冻结、钉选隔离与新增版本 | 草稿版不提供钉选表单，API 直接钉选返回 409 且未写 `run_protocol_pin`。冻结 v1 后先测试非法运行编号（客户端拦截、0 请求、保留输入），再钉选到运行并核对 `monitoring_run` 的 `requested_network_mode`（`off`）与 `customer_payable_minor`（`0`）未改写。修改时区冻结生成 v2，旧运行仍钉住 v1。长品牌名与运行编号在 375 像素下卡片内换行，页首「查看协议版本」可键盘跳至列表标题。 |
| 权限隔离与读取失败恢复 | 其他账号打开页面仅见无品牌提示与「前往品牌」，看不到原品牌名与运行编号，越权钉选 API 返回 404。中英文 375 像素注入慢速读取故障时先显示加载提示，再显示安全错误与「重新载入」按钮且隐藏品牌与内部异常；清除故障后用键盘重新载入恢复列表。隔离库与开发库临时账号、品牌、运行、协议与钉选记录均已清理并回读确认。 |

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过（含 `/dashboard/monitoring/protocols` 路由）。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过（3282 个消息键、7 项测试）。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过（18 项）。 |
| `node --conditions=react-server --test tests/monitoring/sampling-protocols.test.mjs` | 通过（SQLite3 与 PostgreSQL 共 4 项，零跳过）。 |
| 隔离 PostgreSQL `playwright test tests/e2e/sampling-protocols.spec.ts tests/e2e/m0-flow.spec.ts` | 通过（memory 缓存与本机 Chrome，2 项，49.2s）。 |
| `GEO_PROTOCOL_SCREENSHOTS=.cache/issue-135/sampling-protocols/dev pnpm exec playwright test tests/e2e/sampling-protocols.spec.ts` | 通过（配置开发 PostgreSQL 与本机 Chrome，1 项，21.3s）。 |

隔离与开发走查截图保存在本地 `.cache/issue-135/sampling-protocols/{isolated,dev}/`（如 `nobrand-zh-CN-375.png`、`empty-en-375.png`、`populated-zh-CN-375.png`、`unavailable-zh-CN-375.png`）。

## 剩余

- Issue #135 仍保持开放及 `status:in-progress`；下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/settings/usage`、`/dashboard/monitoring/new`、`/dashboard/monitoring/capture` 等）逐页核对 `ui-visual-v1` 与三视口走查，直至全部路由清单完成核验。
