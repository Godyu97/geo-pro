# Issue #135 报告入口内容区

[Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [ui-visual-v1](../04-产品功能规格-SPEC.md#interface-visual-style) · [设计规范](../ui-design/README.md) · [视觉基线](M0-135-visual-baseline.md)

本轮只对齐报告入口和工作台内容地标。其余业务页构图、全站 375/768/1440 走查、登录与品牌功能回归，以及正式阶段验收仍未完成。

## 使用与设计

- 工作台侧栏区域是布局容器。跳到内容的目标仍是唯一的 `main#main-content`，顶栏当前位置留在这个地标外面。
- `/dashboard/reports` 不再套第二层 `main`，也不再额外收缩宽度和内边距。标题、任务说明和相关入口放在工作台内容区。
- 没有品牌或找不到品牌时，主要动作是前往品牌资料。相关入口换行，长英文标签保持在视口内。空的复测、待办和快照使用虚线表面。
- 待办到期和快照闭环的连接词随界面语言变化。状态、等级和意图仍显示已保存的值。

## 执行记录

| 检查 | 结果 |
| --- | --- |
| 内容地标 | `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` 通过。4 项。侧栏区域不是 `main`，工作台布局只有一个 `main#main-content`，报告页不再套第二层。 |
| 消息 | `pnpm check:i18n` 通过，2814 个 key 与参数一致。`pnpm test:i18n` 7 项通过。 |
| 静态与构建 | `pnpm lint` 通过，仅余既有竞品测试未使用变量告警。`pnpm typecheck` 与 `pnpm build` 通过。 |
| 环境 | `pnpm env:check` 14 项通过。开发 PostgreSQL、Redis 与 S3 探针完成。邮件 Mock 保持开启。 |
| 文档 | `python3 docs/tools/validate_docs.py` 通过。26 项需求、29 项任务、646 个本地链接。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/m0-flow.spec.ts` 通过。隔离库中的合成品牌「北岸设备」走完建档到报告。无品牌时显示前往品牌资料，且只有一个 `main`。有快照时中文可见「相关入口」和「闭环 是」，英文可见 “Related entries” 和 “loop yes”。375 宽可把焦点移到「打开观察计划」。`zh-CN` / `en` 在 375、768、1440 下报告页无横向溢出。报告 JSON 字节不随界面语言改变。临时账号由用例清理。 |

正式阶段验收，以及登录、品牌、证据和内容的功能回归仍未作为本轮关单项。报价订单仍只在顶栏标出。其余业务页的构图和全站双语视口走查未完成。

内容入口随后对齐到同一内容区，见 [内容入口](M0-135-content-canvas.md)。
