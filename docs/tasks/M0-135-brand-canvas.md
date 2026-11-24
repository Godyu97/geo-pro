# Issue #135 品牌入口内容区

[Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [ui-visual-v1](../04-产品功能规格-SPEC.md#interface-visual-style) · [设计规范](../ui-design/README.md) · [回答列表](M0-135-answers-canvas.md)

本轮只对齐品牌入口。证据详情、其余业务页构图、全站 375/768/1440 走查、登录和证据详情的功能回归，以及正式阶段验收仍未完成。

## 使用与设计

- `/dashboard/brands` 留在工作台唯一的 `main#main-content` 内。标题和任务说明放在内容区顶部。相关入口换行，包含返回工作台、本地观察、门店范围和行业题包。
- 没有活跃品牌时，空态使用虚线表面，主要动作是建立品牌或继续草稿。已有活跃品牌时，品牌名称换行，主要动作是查看品牌。
- 读取失败时仍保留标题，恢复动作是重新载入。真实建档关闭或当前账号不能使用开发联调时，仍保留标题；主要动作是返回工作台，页面不显示其他账号的品牌资料。
- 归档和待删除列表换行。没有记录时使用虚线表面。分页链接保留当前游标。状态文案仍使用已保存的值。

## 执行记录

| 检查 | 结果 |
| --- | --- |
| 内容地标 | `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` 通过。8 项。品牌入口不再套第二层 `main`，相关入口和空品牌说明走消息，长操作允许换行。 |
| 消息 | `pnpm check:i18n` 通过，2985 个 key 与参数一致。`pnpm test:i18n` 7 项通过。 |
| 静态与构建 | `pnpm lint` 通过，本次没有打印告警。`pnpm typecheck` 与 `pnpm build` 通过。 |
| 环境 | `pnpm env:check` 15 项通过。开发 PostgreSQL、Redis 与 S3 探针完成。邮件 Mock 保持开启。 |
| 文档 | `python3 docs/tools/validate_docs.py` 通过。26 项需求、29 项任务、699 个本地链接。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/m0-flow.spec.ts` 通过，1 项。隔离库中的合成品牌「北岸设备」在品牌入口可见标题、相关入口和「查看品牌」。375 宽可把焦点移到本地观察。`zh-CN` / `en` 在 375、768、1440 下品牌入口无横向溢出，且只有一个 `main`。无品牌账号在 375 宽的中文页显示「建立品牌或继续草稿」，英文页显示 “Set up a brand or resume a draft”，两种语言都无横向溢出。`tests/e2e/brand-onboarding.spec.ts` 15 项中 9 项通过：加载、草稿恢复、归档恢复和删除恢复仍完成。6 项建档走查已通过品牌入口的新检查并保存品牌，随后在品牌详情找不到空通道提示。页面实际列出「官方 Responses 开发通道」版本 2，稳定入口是「打开监测能力」或 “Open monitoring capabilities”，指向 `/dashboard/settings#monitoring-capabilities`。这是开发库已有通道，不是本轮内容区改动。临时账号由用例清理。 |

读取失败、真实建档关闭和开发账号拒绝的标题保留已写在页面分支中，本轮浏览器没有单独制造这三种状态。正式阶段验收，以及登录和证据详情的功能回归仍未作为本轮关单项。报价订单仍只在顶栏标出。证据详情和其余业务页的构图、全站双语视口走查未完成。
