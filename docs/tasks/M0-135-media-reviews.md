# Issue #135 图文与口播核对

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M2-06 / AC-M2-06-2](../specs/M2.md#s-m2-06)

内容审核者从「内容 → 图文核对」打开 `/dashboard/content/media-reviews`。页首根据当前数据提供建档、打开品牌事实、填写核对或查看已保存核对的入口。填写时可以在原文字段上方看到所选版本的完整已批准值。核对记录显示素材文字、已批准值、阻断原因和事实版本编号。 [既有图文核对](https://github.com/Godyu97/geo-pro/issues/114)

读取失败时页面显示标题、重载入口及追踪编号。使用重载入口会重新请求同一条品牌深链接。读取故障注入只在浏览器夹具的源码副本生效。

## 基线复现

在同步基线 `9c201a960ab166ed16202dbf07d0b6a610f9e6da` 上，以临时账号打开英文 375 像素的图文核对空态。标题可见，`Open brands` 链接断言在 2.5 秒内找不到元素。临时账号已清理。

## 覆盖范围

- 页首操作和核对卡片复用现有按钮、共享主题和卡片样式。加载状态使用有名称的骨架，核对表单与列表可用键盘聚焦。
- 保存沿用现有归属检查和事实版本绑定。提交期间保留按钮焦点并拦截重复请求。无效输入保留在表单中，语言切换重新显示当前语言的反馈。
- AC-M2-06-2 的软件走查使用临时账号、合成价格和配置开发 PostgreSQL。正式行业试点按 T-M2-06 的前置条件验收。

## 实际走查

| 场景 | 结果 |
| --- | --- |
| 无品牌、无已批准事实、可核对及已有记录 | `zh-CN` 与 `en` 在 375、768、1440 像素均可辨认内容分区和页首动作，只有一个 `main`，页面无横向溢出。375 像素可键盘进入建档，同一品牌的事实维护，核对表单和历史列表。进入表单时焦点落在品牌字段。进入历史时焦点落在列表区域。 |
| 输入及提交 | 空白输入显示本地化错误，保留文本并发出 0 次请求。切换英文保留原文及事实选择，错误随界面语言变化。挂起写入时再次按 Enter，请求数仍为 1。 |
| AC-M2-06-2 | 素材价格 CNY 99 对照已批准价格 CNY 129。两种语言均读回素材原文、已批准值、阻断原因和同一事实版本编号。数据库唯一记录为 `fact_mismatch`、`deliver=0`，交付包和发布记录都是 0 条。 |
| 归属与恢复 | 另一账号打开同一品牌链接时看不到品牌、素材或事实编号。两个 locale 在 375 像素先见加载骨架，再见安全错误和追踪编号。错误页隐藏品牌、核对与内部异常。键盘重载保留原品牌查询参数并恢复事实选择和核对记录。两个账号及本轮核对记录均已清理。 |

12 张 375 像素截图保存在本地 `.cache/issue-135/media-reviews/`，由 `tests/e2e/media-reviews.spec.ts` 重新生成。

## 检查记录

| 命令 | 实际结果 |
| --- | --- |
| `pnpm env:check` | 通过，15 项。开发 PostgreSQL、Redis 和对象存储探针成功。 |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。构建包含图文与口播核对页。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过。3456 个消息键及插值参数，7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，32 项。 |
| `node --conditions=react-server --test tests/local-presence/media.test.mjs` | 通过，4 项，零跳过。SQLite3 和 PostgreSQL 均验证错误价格与客户证明阻断。 |
| `pnpm exec playwright test tests/e2e/media-reviews.spec.ts tests/e2e/m0-flow.spec.ts` | 最终通过，2 项。使用配置开发 PostgreSQL 和本机 Chrome。图文核对 8.4 秒，既有 M0 链路 30.1 秒。 |
| `pnpm check:feature-map` | 通过，69 个页面、438 个代码路径。 |
| `python3 docs/tools/validate_docs.py` | 通过，176 篇活跃文档、967 个本地链接、26 项需求、29 项任务、81 个验收 ID。 |

中间复跑发现品牌下拉框的标签会包含选项文字，已用字段 ID 明确关联标签。M0 回归有一轮因报告页文本定位匹配两个元素而失败，断言已限定到本次生成的快照，继续核对闭环、费用、工时和下载字节。

## 剩余

Issue #135 保持开放和 `status:in-progress`。已定位到行业问题包页 `/dashboard/brands/industry-packs` 的读取失败只提供返回品牌，下一轮可从该页补齐重载及页首操作，并用双语三视口复核。关单前按路由清单复核剩余页及全站的公共状态。
