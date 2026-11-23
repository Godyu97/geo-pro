# Issue #130 开发环境品牌建档

[Issue #130](https://github.com/Godyu97/geo-pro/issues/130) · [S-M0-01](../specs/M0.md#s-m0-01) · [S-M0-02](../specs/M0.md#s-m0-02) · [S-M0-03](../specs/M0.md#s-m0-03)

开发库可以在显式开关、目标库名、请求主机和获准账号同时成立时写入获准品牌资料。这不记录五项正式开放条件，也不把功能性 mock 标成真实资料。生产准入仍由 [#21](https://github.com/Godyu97/geo-pro/issues/21) 跟踪。

## 使用与设计

- `GEO_BRAND_DEV_INTAKE=true`，并且 `GEO_BRAND_DEV_INTAKE_DATABASE` 等于当前库名、请求主机与 `BETTER_AUTH_URL` 一致时，品牌、事实和题集入口进入 `dev` 模式。缺开关、库名不一致或主机不一致时，读写保持关闭。
- 账号邮箱必须出现在 `GEO_BRAND_DEV_INTAKE_ACTORS`。名单为空或不匹配时返回 `DEV_ACTOR_DENIED`，页面不展示其他账号的品牌正文。已获准但不是负责人的账号仍按原归属返回 `NOT_FOUND`。
- 回环 `GEO_BRANDS_FIXTURE=1` 仍优先。`GEO_FUNCTIONAL_MOCK=1` 与开发联调开关同时为真时入口关闭，避免两条资料范围叠在同一次写入。正式五项记录仍单独判断，邮件 Mock 不能打开正式入口。
- 新的品牌实体版本可回读，旧版本保留原字段。题集冻结后的旧版本保留原题目。事实确认记录当时的实体版本。

## 执行记录

| 检查 | 结果 |
| --- | --- |
| 开关矩阵 | `pnpm test:brands` 通过。缺开关、目标库不一致、主机不一致、与 mock 同时打开时开发写入关闭；回环 fixture 仍优先。获准邮箱大小写不敏感，名单外账号不能打开事实与题集。 |
| 事实与题集 | `pnpm test:brand-facts`、`pnpm test:prompts` 通过。 |
| 消息与文档 | `pnpm check:i18n`、`pnpm test:i18n`、`python3 docs/tools/validate_docs.py` 通过。 |
| 静态与构建 | `pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。lint 仍有既有的竞品测试未使用变量告警。 |
| 隔离品牌 HTTP | `pnpm verify:brands` 通过。双方言隔离库的关闭说明、fixture 建档、归属和会话恢复仍保持原结果。 |
| 环境 | `pnpm env:check` 14 项通过。开发 PostgreSQL、Redis 与 S3 探针完成。邮件 Mock 保持开启。 |
| 开发库走查 | `pnpm verify:dev-brand-intake` 通过。库名 `gpro`。品牌 `ef806b38-0b74-4420-aebd-701176444112` 由 `dev-intake-owner-bc0aad29@example.invalid` 持有，实体版本 1 与 2 均可回读；版本 1 无别名、官网为空。事实 `a76c5c1b-f71c-4816-b02d-955ee9fd5c30` 为已批准，并保留实体版本 1。题集 `58c8f003-2e25-413c-a791-4582f25a01bb` 的冻结版本 `1d39c70b-4b2e-4cb7-8fac-796b2550d898` 仍指向实体版本 1，修订版本 `c28837b0-99ae-4b55-a91f-6fa86b559616` 指向实体版本 2，旧题文本未改。 |
| 越权与双语 | 获准的第二个账号读取该品牌返回 `NOT_FOUND`，页面不出现该品牌业务描述。名单外账号返回 `DEV_ACTOR_DENIED`。中英文均可在会话失效后重新登录并看到已保存草稿「GeoPro」。资料来自本仓库公开 README，不是监测样本或排名。 |

浏览器视口点击未单独走查。页面断言来自上述 HTTP 响应中的中英文服务端 HTML。密码没有写入仓库或本记录。
