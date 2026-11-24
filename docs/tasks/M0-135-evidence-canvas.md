# Issue #135 证据概览内容区

[Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [ui-visual-v1](../04-产品功能规格-SPEC.md#interface-visual-style) · [设计规范](../ui-design/README.md) · [内容入口](M0-135-content-canvas.md)

本轮只对齐证据概览。回答列表、品牌入口、其余业务页构图、全站 375/768/1440 走查、登录与品牌和证据详情的功能回归，以及正式阶段验收仍未完成。

## 使用与设计

- `/dashboard/monitoring/overview` 留在工作台唯一的 `main#main-content` 内。标题和任务说明放在内容区顶部。相关入口换行，长标签留在视口内。
- 没有品牌时，主要动作是前往品牌资料。筛选无效或读取失败时仍保留标题；找不到品牌时主要动作同样是前往品牌资料，无效筛选的恢复动作是清除筛选。
- 当前范围没有有效样本时，空态使用虚线表面，主要动作是启动监测。已有可计算样本时，主要动作是查看回答列表。品牌名称换行显示。逐题表在组件内横向滚动。指标数值、分母和 N/A 口径不变。

## 执行记录

| 检查 | 结果 |
| --- | --- |
| 内容地标 | `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` 通过。6 项。概览页不再套第二层 `main`，相关入口走消息，长操作允许换行。 |
| 消息 | `pnpm check:i18n` 通过，2982 个 key 与参数一致。`pnpm test:i18n` 7 项通过。 |
| 静态与构建 | `pnpm lint` 通过，本次没有打印告警。`pnpm typecheck` 与 `pnpm build` 通过。 |
| 环境 | `pnpm env:check` 15 项通过。开发 PostgreSQL、Redis 与 S3 探针完成。邮件 Mock 保持开启。 |
| 文档 | `python3 docs/tools/validate_docs.py` 通过。26 项需求、29 项任务、687 个本地链接。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/m0-flow.spec.ts tests/e2e/evidence-scope.spec.ts` 通过，2 项。隔离库中的合成品牌「北岸设备」仍完成入证、范围筛选和回答下钻。有样本时中文可见「可解释概览」「相关入口」和「查看回答列表」，英文可见 “Explainable overview”、“Related entries” 和 “View answers”。375 宽可把焦点移到演示空间入口。`zh-CN` / `en` 在 375、768、1440 下概览页无横向溢出，且只有一个 `main`。无品牌账号在 375 宽的中文页显示「前往品牌资料」，英文页显示 “Go to brands”，两种语言都无横向溢出。同一范围筛选仍只保留官方关联网样本。临时账号由用例清理。 |

无效筛选和读取失败的标题保留已写在页面分支中，本轮浏览器没有单独制造这两种失败。正式阶段验收，以及登录、品牌和证据详情的功能回归仍未作为本轮关单项。报价订单仍只在顶栏标出。其余业务页的构图、全站双语视口走查未完成。

回答列表随后对齐到同一内容区，见 [回答列表](M0-135-answers-canvas.md)。
