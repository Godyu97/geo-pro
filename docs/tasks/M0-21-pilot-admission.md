# Issue #21 正式开放条件

[Issue #21](https://github.com/Godyu97/geo-pro/issues/21) · [S-M0-01](../specs/M0.md#s-m0-01) · [T-M0-01](M0.md#t-m0-01)

本文的五项开关记录的是生产品牌入口。现行 #21 由 Agent 通过 #130 的受控开发入口，在开发库执行正式试点，邮件沿用长期 Mock。 [开发联调计划](brand-monitoring-next.md#dev-live-data)

## 使用与设计

- 未开放时，`/dashboard/brands` 展示关闭说明和五项服务端条件：验证与找回邮件的真实投递、身份验证与账户恢复、保留与清除披露、存储导出与备份恢复演练、获准试点环境。条件只返回是否已记录，不返回网关地址或密钥。
- `GEO_AUTH_MAIL_MOCK=true` 不能记为真实投递。五项记录都为真，并且 `GEO_BRAND_REAL_INTAKE=true`、请求主机与 `BETTER_AUTH_URL` 一致时，品牌读写才按正式入口开放。任一项缺失则接口返回 `INTAKE_CLOSED`。
- 回环上的 `GEO_BRANDS_FIXTURE=1` 仍是隔离验收，优先于正式开关。正式入口不会把隔离库说成真实试点。事实、题集、监测和品牌范围导出继续沿用各自的隔离开关。
- 工作台列出已有通道能否用于正式运行。未核验或过期的通道不能启动正式监测。

## 未验证

开发试点按实际结果记录 Mock、身份验证和软件行为。生产侧发信、恢复、保留披露、备份和开放条件各自依据生产证据记录。`AC-M0-01-1/2/3` 待获准开发试点按产品规格实测。

## 执行记录

| 检查 | 结果 |
| --- | --- |
| 开关矩阵 | `node --conditions=react-server --test tests/brands/pilot-admission.test.mjs`：2 项通过。缺任一项、邮件 mock、主机不一致时正式写入关闭；回环 fixture 保持隔离模式。 |
| 消息与文档 | `node scripts/check-i18n.mjs`：1170 个键一致。`python3 docs/tools/validate_docs.py` 通过。 |
| 静态与构建 | `pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。 |
| 双库 HTTP | `pnpm verify:brands` 通过。SQLite 默认入口双语页面含关闭说明、正式开放条件和「未核验 / Unverified」，写入返回 `INTAKE_CLOSED`，品牌表仍为空。SQLite 与 PostgreSQL 的隔离建档路径仍通过。 |
| 浏览器 | 本机 `pnpm start` 注册合成账号后，1440 宽度的中文工作台显示「当前没有未过期的已验证通道，不能新建正式运行」。中英文品牌页五项均为未核验，没有建档表单。同会话 `POST /api/brands` 返回 403 `INTAKE_CLOSED`。 |
