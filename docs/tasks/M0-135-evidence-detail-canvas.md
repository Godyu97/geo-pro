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
