# M0-135 优化任务入口

2026-11-24｜[#135](https://github.com/Godyu97/geo-pro/issues/135)｜[全站视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M0-08](../specs/M0.md#s-m0-08)

品牌负责人看完回答或页面证据后，可在优化入口先查看开放任务。没有任务时，从标题下方进入同一品牌的证据概览。没有品牌、品牌不可用或无权访问时，页面保留优化任务标题并提供品牌入口。

## 实现与复现

- 基线 `6ba7bf47bffd281ad0639125d776a44fea2dfa3f` 使用迁移后的临时 PostgreSQL。为测试账号建档后，在 375 像素的中文页面打开空任务列表。页面提示可从证据概览生成建议，但 `查看证据概览` 链接断言因找不到元素而失败。
- `src/features/optimization/list-page.tsx` 将开放任务放在行动草案和公开页检查之前。证据概览入口保留 `brandId`。任务标题可聚焦，长标题和目标 URL 换行，任务优先级和状态沿用已有标签。两份消息目录为检查状态和缺口类型提供界面用语。已保存的任务标题和 URL 按原文显示。
- 本轮覆盖 `/dashboard/optimization`，以及从任务标题键盘进入 `/dashboard/optimization/[taskId]`。列表继续复用现有归属检查、优先排序与页面检查动作。

## 工程与开发环境验证

| 命令 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3043 个消息键和 7 项测试 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，8 项 |
| `pnpm test:optimization` | 通过，8 项，SQLite3 与 PostgreSQL 隔离验证无跳过。覆盖 AC-M0-08-1/2/3，包括缺席假设、任务去重、页面受限和归属 |
| `pnpm env:check` | 通过，15 项，包括开发 PostgreSQL、Redis 和 S3 探针 |
| `python3 docs/tools/validate_docs.py` | 通过，26 项需求、29 项任务、81 个验收 ID、735 个本地链接 |

在回环 `localhost:3125` 运行 `pnpm start`，使用已配置的开发 PostgreSQL 和长期邮件 Mock。Chrome 中注册临时账号并核对库中没有所属品牌。中文与英文各在 375 像素通过标题、可见焦点、Enter 打开品牌页及无横向溢出检查。临时账号已删除并回读确认。开发走查使用合成测试账号。

## 隔离浏览器验收

在 `testDatabase("postgresql")` 创建并迁移的临时回环库中，使用 memory 缓存和长期邮件 Mock，关闭公开页外部请求。执行 `pnpm test:e2e tests/e2e/optimization-entry.spec.ts tests/e2e/m0-flow.spec.ts`。两项通过，测试账号及临时库已清理。首次运行中，新增用例按标签文本定位原生下拉框超时。改为按可访问角色和名称定位后，两项完整重跑通过。

| 场景 | 实际结果 |
| --- | --- |
| 已建档，任务为空 | `zh-CN` 与 `en` 各在 375、768、1440 像素显示空态与首屏证据概览入口。375 像素用 Enter 进入概览，地址保留原品牌 |
| 合成公开页受限，生成任务 | 在英文界面用 Enter 提交隔离检查。PostgreSQL 回读原 URL、`restricted` 与 `isolated-fixture` |
| 已有任务 | 两种语言各在三种宽度可见工作台当前位置、任务标题及待处理标签。长 URL 换行，页面无横向溢出，工作台只有一个主要内容地标。从概览入口按 Tab 可见任务焦点，按 Enter 打开对应详情 |
| 无品牌或跨账号访问 | 两种语言在 375 像素保留标题和品牌入口。跨账号访问显示通用提示，页面隐藏该品牌的任务和检查表单 |

375 像素下的双语空态与任务焦点截图保存到 `test-results/optimization-entry-*/optimization-{empty,task}-{zh-CN,en}.png`，画面使用合成账号和数据。运行同一用例可重新生成。

## 剩余验收

下一轮可沿任务标题进入详情，用隔离账户在两种语言与 375、768、1440 像素核对长证据、状态表单、失败反馈和保存后回读，继续补齐全站路由与状态覆盖。正式 M0 试点随阶段工单核验。
