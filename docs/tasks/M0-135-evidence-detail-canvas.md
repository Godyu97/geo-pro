# Issue #135 回答证据详情

[Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉合同](../04-产品功能规格-SPEC.md#interface-visual-style) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M0-06](../specs/M0.md#s-m0-06)

2026-11-24。品牌负责人从筛选后的回答列表进入 `/dashboard/monitoring/evidence/[observationId]`，先核对原问题、回答原文和证据状态，再查看采样条件、引用与分析版本。标题下的主要入口返回原回答行，并保留轨道、地区、请求联网、时间窗和列表筛选条件。返回概览使用原观察范围。

页面沿用工作台唯一的 `main#main-content`、主题按钮和白色面板。原文保留换行，长内容留在面板内。证据状态、采样条件、引用完整性与现有分析版本继续由原有读路径提供。纠正判定和生成行动的表单仍在相应面板。

## 执行记录

| 检查 | 结果 |
| --- | --- |
| 基线复现 | `033ab42f8652521b187ee5b816184f41e2fced41` 的 `evidence-scope`、`answer-list-filter` 既有用例均通过。将新首屏断言单独应用到测试后，在临时 PostgreSQL 库以 375 × 900 从安装题的回答列表打开详情。「返回回答列表」存在，可见比例为 0，5 秒内未进入视口。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。 |
| 双语与地标 | `pnpm check:i18n` 通过，3032 个键和插值参数一致；`pnpm test:i18n` 7 项通过；`node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` 8 项通过。 |
| 证据合同 | `pnpm test:evidence` 40 项通过，包含 SQLite 和 PostgreSQL 的隔离覆盖。`AC-M0-06-1/2/3` 核对独立判定、完整空引用与缺字段、纠错只追加版本。 |
| 浏览器 | 在新建、迁移并清理的回环 PostgreSQL 库运行 `pnpm exec playwright test tests/e2e/answer-list-filter.spec.ts tests/e2e/evidence-scope.spec.ts tests/e2e/m0-flow.spec.ts`，3 项通过。详情在 `zh-CN` / `en` 各 375、768、1440 像素下可在首屏看到返回入口，页面无横向溢出，只有一个 `main`。按 Tab、Shift+Tab 确认焦点可见，按 Enter 返回原回答行，保留筛选条件。语言切换保留 URL 和原文字节，完整空引用继续显示为未引用。用例在 `test-results/` 附上中文 375 和英文 1440 两张合成样本截图。 |
| 开发服务 | `pnpm env:check` 15 项通过，包括开发库、Redis 和 S3 探针。 |
| 真实开发样本只读核对 | 2026-11-24，通过 `readObservation` 在回环开发 PostgreSQL 只读事务复查 [#133 已存官方证据](M0-133-official-evidence.md)。3 条原文的 SHA-256 与原记录一致，实体版本 2，分析版本 1，目标地区 `CN`、实际地区未知、请求联网 `off`、实际未触发、完整空引用与每条已知费用 CNY 0.01 均一致。无关 owner ID 返回空。复用获准开发品牌及既有回执，未发起新的采样或产生费用。 |
| 文档 | `python3 docs/tools/validate_docs.py` 通过，26 项需求、29 项任务、81 个验收 ID 和 728 个本地链接。 |

本轮覆盖详情正常态和返回路径。真实样本以服务层只读核对，浏览器使用合成样本；详情加载与读取故障的双语浏览器走查尚待补齐。建议下一轮用现有公共异常模拟设施核对详情受限、加载和失败，并继续登录回归、其余业务页及全站覆盖。正式阶段验收仍按原工单条件另行核验。

## 详情加载、失败与受限

2026-11-24，从 `ad6026035d2dd0a0f83a9734a9c1f46f141ea4d0` 继续。品牌负责人从回答列表打开证据，能在工作台的同一内容区看到回答证据标题和当前状态。加载期间使用共用骨架和状态文字。读取抛错时可重新加载当前 URL，也可回到回答列表。记录不存在与当前账号无权限共用该路由的不可用提示和回答列表入口，避免暴露证据是否存在。该入口打开当前账号的默认列表。正常回退仍带原观察范围、列表筛选和回答锚点。

| `ui-visual-v1` 场景 | 实际观察 |
| --- | --- |
| 组件与状态 | 隔离 Chromium 中，基线遇到延迟读取后找不到「正在加载回答证据…」，专项断言失败。改动后，复制应用内延迟 1.8 秒再抛出异常，先出现可读的加载提示和骨架，再出现安全错误提示。失败时没有原文面板或测试异常文字。 |
| 双语与响应式 | `zh-CN` 和 `en` 各在 375、768、1440 像素验证加载、失败和受限。无页面横向溢出，主要操作在视口内。用键盘聚焦重试并按 Enter，清除隔离故障后读回详情，原 URL 与筛选保留。 |
| 数据与流程 | 临时账号访问另一账号证据和随机不存在的编号，看到同一提示。原问题和指纹未显示。按 Enter 回到本账号回答列表。正常态仍回读原文字节、采样条件和完整空引用，回到列表保留筛选及行锚点。 |

在 `testDatabase("postgresql")` 创建并迁移的临时回环库中，设置 `GEO_CACHE_DRIVER=memory` 后执行 `pnpm test:e2e tests/e2e/answer-list-filter.spec.ts tests/e2e/evidence-scope.spec.ts tests/e2e/m0-flow.spec.ts`，3 项通过。测试账号及库已清理。用例将 375 像素下的两种语言、三种状态截图附在 `test-results/` 的 Playwright 结果中，文件名以 `evidence-loading-`、`evidence-failure-` 或 `evidence-unavailable-` 开头。画面使用合成账号和样本。

`pnpm lint`、`pnpm typecheck`、`pnpm build`、`python3 docs/tools/validate_docs.py` 通过。`pnpm check:i18n` 通过 3033 个消息键及插值核对，`pnpm test:i18n` 通过 7 项，`node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` 通过 8 项。`pnpm test:evidence` 在 SQLite 与 PostgreSQL 隔离验证中通过 40 项，覆盖 S-M0-06 的独立判定、空引用与缺字段区分及分析修订。

`pnpm env:check` 通过 15 项。在开发 PostgreSQL 只读事务中，用 `readObservation` 再核对 [#133 的三条官方证据](M0-133-official-evidence.md)。原文 SHA-256、实体版本 2、分析版本 1、目标地区 CN、实际地区未知、请求联网 off、实际未触发、完整空引用以及每条 CNY 0.01 已知费用均与原记录一致，其他 owner ID 无结果。未请求采样供应商。

后续先补登录回归，再按尚未覆盖的路由和状态补全站清单及双语走查。正式 M0 试点继续按对应工单的验收条件执行。
