# Issue #135 内容入口内容区

[Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [ui-visual-v1](../04-产品功能规格-SPEC.md#interface-visual-style) · [设计规范](../ui-design/README.md) · [报告入口](M0-135-report-canvas.md)

本轮只对齐内容入口。其余业务页构图、全站 375/768/1440 走查、登录与品牌和证据的功能回归，以及正式阶段验收仍未完成。

## 使用与设计

- `/dashboard/content` 留在工作台唯一的 `main#main-content` 内。标题和任务说明放在内容区顶部。有品牌时，相关入口换行，主要动作是新建 Brief 里的保存草稿。
- 没有品牌或读取失败时，主要动作是前往品牌。失败说明保留页面标题。
- 空的计划、Brief 和稿件版本使用虚线表面。问题簇覆盖、主页面和渠道等长文本在卡片内换行。补证数量随界面语言变化，状态仍显示已保存的值。

## 执行记录

| 检查 | 结果 |
| --- | --- |
| 内容地标 | `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` 通过。5 项。内容页不再套第二层 `main`，相关入口和补证数量走消息。 |
| 消息 | `pnpm check:i18n` 通过，2816 个 key 与参数一致。`pnpm test:i18n` 7 项通过。 |
| 静态与构建 | `pnpm lint` 通过，仅余既有竞品测试未使用变量告警。`pnpm typecheck` 与 `pnpm build` 通过。 |
| 环境 | `pnpm env:check` 14 项通过。开发 PostgreSQL、Redis 与 S3 探针完成。邮件 Mock 保持开启。 |
| 文档 | `python3 docs/tools/validate_docs.py` 通过。26 项需求、29 项任务、652 个本地链接。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/m0-flow.spec.ts` 通过。隔离库中的合成品牌「北岸设备」仍完成 Brief、确认和草稿生成。有品牌时中文可见「相关入口」「保存草稿」和「补证」，英文可见 “Related entries”、“Save draft” 和 “Gaps”。375 宽可把焦点移到内容日历。`zh-CN` / `en` 在 375、768、1440 下内容页无横向溢出，且只有一个 `main`。无品牌账号在 375 宽的中文页显示「前往品牌」，英文页显示 “Go to brands”，两种语言都无横向溢出。临时账号由用例清理。 |

正式阶段验收，以及登录、品牌和证据的功能回归仍未作为本轮关单项。报价订单仍只在顶栏标出。其余业务页的构图和全站双语视口走查未完成。

证据概览随后对齐到同一内容区，见 [证据概览](M0-135-evidence-canvas.md)。
