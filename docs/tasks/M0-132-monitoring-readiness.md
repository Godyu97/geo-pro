# Issue #132 品牌监测准备与运行确认

2026-11-23。 [Issue #132](https://github.com/Godyu97/geo-pro/issues/132) · [品牌管理与监测计划](brand-monitoring-next.md) · [S-M0-03 至 S-M0-05](../specs/M0.md#s-m0-03)

## 交付范围

- 品牌详情展示实体版本、冻结题集和已确认自然发现题数、双轨通道资格、额度余额及补证状态。缺项有对应操作入口。官方轨道按最新冻结题集的全部确认题核对单通道单次所需槽位。消费者人工沿用独立资格判断。
- 从当前活跃品牌进入同一品牌的登记入口。预览展示冻结题集、通道版本、地区、业务语言、请求联网模式、次数和费用上限。确认使用现有服务端签名、有效期、归属、版本和额度重检。缺可信费用上界时提示补充，预览过期或范围变化时要求重新预览。
- 运行详情按已保存题集回读当时的品牌实体版本，并展示已冻结通道与已绑定协议引用。无官网时按该实体版本显示官网引用不适用。历史视图提供回到当前版本的入口，归档或冻结品牌及其他账号的品牌无法登记。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。lint 有一条既有告警。 |
| 双语 | `pnpm check:i18n` 核对 2,736 个消息键与插值参数。`pnpm test:i18n` 7 项通过。 |
| 双库回归 | `pnpm test:brands`、`pnpm test:prompts`、`pnpm test:brand-facts`、`pnpm test:monitoring` 共 39 项通过。最新冻结协议查询双方言各执行一次 SQL，代表性隔离数据的计划使用 `sampling_protocol_owner_idx`。 |
| 隔离 HTTP 与浏览器 | `pnpm verify:brands`、`pnpm verify:prompts` 双方言通过。`pnpm test:e2e tests/e2e/m0-flow.spec.ts` 用合成品牌验证中英文准备与预览、375 / 768 / 1440 px 布局、键盘进入、历史版本无法进入确认、缺费用上界，以及登记后回读原实体和通道版本。 |
| 开发环境 | `pnpm env:check` 14 项通过。`pnpm verify:dev-brand-intake` 用获准的 GeoPro 公共资料在开发 PostgreSQL 走查。中英文均显示 3 道自然发现题及未发放额度状态，负责人可回读最新冻结题集，另一获准账号看不到该题集。 |

本次开发联调覆盖准备、预览入口和归属。隔离浏览器登记的是合成运行，真实官方采样执行及费用回执由 [#131](https://github.com/Godyu97/geo-pro/issues/131) 跟踪，正式阶段验收由 [#32](https://github.com/Godyu97/geo-pro/issues/32) 跟踪。

## 关单复核

2026-11-23，在 `66fc4153adccb2b0c75193a0d7f344ec12e1f1f9` 之后复核。官方轨道运行详情已改为展示执行说明，隔离浏览器断言同步改为核对该说明，并确认合成结果仍标明「隔离合成结果」，不再要求已接通轨道显示「真实供应商执行尚未接通」。

| 检查 | 结果 |
| --- | --- |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。lint 仍只有 `tests/competitors/briefs.test.mjs` 的既有未使用变量告警。 |
| 双语 | `pnpm check:i18n` 核对 2,750 个消息键与插值参数。`pnpm test:i18n` 7 项通过。 |
| 双库回归 | `pnpm test:brands` 13 项、`pnpm test:prompts` 5 项、`pnpm test:brand-facts` 3 项、`pnpm test:monitoring` 20 项通过。准备分类覆盖题数不足、停用题、通道过期和额度不足；登记提交覆盖版本冲突、预览过期和额度重检。 |
| 隔离 HTTP 与浏览器 | `pnpm verify:brands`、`pnpm verify:prompts` 双方言通过。`pnpm test:e2e tests/e2e/m0-flow.spec.ts` 1 项通过：合成品牌的中英文准备与预览、375 / 768 / 1440 px、键盘进入、历史版本无法确认、缺费用上界，以及登记后回读原实体和通道版本。 |
| 开发环境 | `pnpm env:check` 14 项通过。`pnpm verify:dev-brand-intake` 在开发库 `gpro` 通过。品牌 `6cf12629-7477-481b-9953-aff008170d9f` 的实体版本为 1 与 2；事实 `9d94cfe2-d7de-40e1-8db2-a5293facf7e3`；题集 `767f6a86-d084-4e4d-a2dd-e9cb2eaff49d` 的冻结版本 `e2d26765-58fa-438d-9cdb-67a2e41932cf` 与修订版本 `3641a4c8-a9bd-4780-9a99-2a80defc2530`。中英文详情均显示 3 道自然发现题和未发放额度，确认页默认选中最新冻结题集，另一获准账号看不到该题集。窄屏布局由上面的隔离浏览器流程覆盖。 |
