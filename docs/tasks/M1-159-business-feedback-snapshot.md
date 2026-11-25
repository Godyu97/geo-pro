# Issue #159 脱敏 CSV 预览与报告业务反馈层

2026-11-26。 [Issue #159](https://github.com/Godyu97/geo-pro/issues/159) · [S-M1-07](../specs/M1.md#s-m1-07) · [指标合同 §8](../07-指标与证据合同.md)

市场运营在 `/dashboard/reports/leads` 上传或粘贴脱敏 CSV，先看到去重、主分类升级和拒绝行，确认后才入库。生成报告快照时，同一品牌的去重咨询、独占主分类、冻结规则下的有效咨询、可识别引荐转化率和爬虫访问写入只读 `business_feedback` 层。没有可靠会话分母时转化率为 N/A。爬虫访问与回答引用分开，`called_included` 固定为 false。本记录不勾选 T-M1-07，也不代替获准真实线索或阶段门禁。

## 交付范围

- 线索页支持带表头 CSV 和原来的三列文本。表头识别 `event_id`、`evidence`、`direct_identifier`，引号字段和空行按 CSV 处理。预览给出总行数、去重后咨询数、主分类升级和逐行拒绝原因。手机号、邮箱不会进入确认请求。确认仍走既有导入接口。
- 新快照保持 `schema_version: report-v4`，并增加 `business_feedback`。未传入该层时，文档不包含这个字段。列表读取缺少该字段的历史文件时标为没有业务反馈汇总，不改已保存字节。
- 转化率只使用会话分母大于 0 的可识别引荐。自报咨询不除以访问数，`self_reported_over_visits` 为 null。爬虫访问取爬虫观察条数加上线索观察里的爬虫计数，回答引用单独相加。
- 别人打开未授权品牌的报告地址时，找不到资源的说明重新放在提示区域内。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发库为 PostgreSQL，邮件长期 mock 开启。 |
| 线索预览 | `node --conditions=react-server --test tests/business-feedback/leads.test.mjs` 通过。同一事件的自报与引荐预览为 1 条咨询、主分类升为引荐；手机号和邮箱不出现在待提交行里。SQLite 与 PostgreSQL 导入后台账为 1，证据 2 条，主分类为引荐。 |
| 快照业务层 | `pnpm test:reports` 26 项通过，含双方言快照。仅有自报咨询和 1 条爬虫访问、无会话分母、回答引用为 0 时，JSON 转化率为 null、原因为 `missing_session_denominator`，`called_included` 为 false。中文 HTML 写明 N/A 和原因，且不出现“已被 AI 收录”。随后补上 4/10 的会话分母，新快照转化率为 40.0%，第一份 JSON 字节不变。去掉 `business_feedback` 后读取为缺失，不补造零。 |
| 查询计划 | 线索主分类和线索观察汇总在 SQLite、PostgreSQL 都使用 `business_lead_owner_idx`、`lead_observation_owner_idx` 的 owner 与 brand 前缀。爬虫汇总使用 `crawler_observation_owner_idx` 的 owner 前缀，再按 `brand_id` 过滤。没有新增索引或迁移。 |
| 回归 | `pnpm test:continued-operations` 84 项通过。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。`pnpm check:i18n` 3754 个键一致。`pnpm check:feature-map` 通过。没有 Schema 变更。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/business-leads.spec.ts tests/e2e/report-snapshot.spec.ts` 通过。中文 375 用键盘上传 CSV，预览标出第 3 行身份信息和第 4 行缺事件 ID，确认前台账仍为空；确认后台账为 1，主分类为可识别引荐，页面不再含手机号。英文 768 只预览、不确认，台账不变。报告页在中英文和 375、768、1440 下显示去重咨询 1、转化率 N/A 和爬虫访问观察 1。历史快照显示没有业务反馈汇总，已保存 JSON 与 HTML 字节不变。 |

获准真实线索、真实观察窗口和 T-M1-GATE 不在本记录内。
