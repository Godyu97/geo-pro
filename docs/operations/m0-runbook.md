# M0 运行与支持手册

> Issue [#40](https://github.com/Godyu97/geo-pro/issues/40)｜供 [#21](https://github.com/Godyu97/geo-pro/issues/21)、[#31](https://github.com/Godyu97/geo-pro/issues/31)、[#32](https://github.com/Godyu97/geo-pro/issues/32) 的试点执行使用。本文说明当前软件怎么启动、怎么恢复、哪些入口仍然关闭。真实能力、未知项、走查、隐私披露和成本记录填写 [试点模板](m0-pilot-templates.md)。隔离测试结果不能写入模板的真实结果栏。

产品合同仍以 Intent、PRD、SPEC 和指标合同为准。本文不改变验收口径，也不把 AC-M0-GATE 标成通过。

## 1. 环境

使用 Node 24 与 `pnpm`。密钥只放在服务器环境或 gitignored 的 `.env.local`。`.env.example` 只保留空值。禁止把密钥写入源码、`NEXT_PUBLIC_*`、文档或工单。

| 变量 | 作用 | 正式试点要求 |
| --- | --- | --- |
| `DATABASE_PROVIDER` | `postgresql` 或 `sqlite` | 与目标库一致。应用不会在连接失败时改连另一个库 |
| `DATABASE_URL` | PostgreSQL 连接串 | 只在 PostgreSQL 模式读取。文档和工单不粘贴真实口令 |
| `SQLITE_PATH` | SQLite 文件绝对路径 | 父目录必须已存在。文件不存在时运行请求失败，迁移命令可以创建新文件 |
| `BETTER_AUTH_URL` | 认证对外原点 | 与实际入口一致。品牌隔离开关还要求它是回环地址 |
| `BETTER_AUTH_SECRET` | 会话签名 | 至少按认证配置要求提供。缺失时登录提交禁用，认证 API 返回 503 |
| `GEO_AUTH_MAIL_URL` | 邮件网关 | HTTPS。应用和网关都在回环地址时，隔离验收可以使用 HTTP |
| `GEO_AUTH_MAIL_SECRET` | 网关 Bearer | 至少 32 个可见 ASCII 字符 |
| `GEO_AUTH_MAIL_IP_HEADER` | 可信入口写入的来源 IP 头 | 正式入口必须覆盖客户端同名头，并禁止绕过入口直连应用 |
| `GEO_AUTH_MAIL_MOCK` | 开发阶段跳过外发 | 正式开放和 `verify:account-email` 等严格验收保持未设置或 `false` |
| `GEO_AUTH_EMAIL_VERIFIED_MOCK` | 开发阶段把邮箱视为已验证 | 同上。真实恢复必须走数据库里的 `email_verified` |
| `GEO_BRANDS_FIXTURE` | 回环隔离品牌入口 | 只有值为 `1`、`BETTER_AUTH_URL` 为回环、Host 匹配且数据库主机也是回环时，品牌读写才打开。正式环境保持关闭，直到 #21 的开放检查完成 |
| `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL` | 服务端 Responses API | 留空时不调用。它不代替官方采样通道 |
| `GEO_OFFICIAL_SAMPLING_BASE_URL` | 官方采样地址 | 与下面三项同时具备才可能发起采样 |
| `GEO_OFFICIAL_SAMPLING_API_KEY` | 官方采样凭据 | 只放服务器 |
| `GEO_OFFICIAL_SAMPLING_PRODUCT_ENTRY` | 产品入口 | 写入能力记录，不把密钥放进台账 |
| `GEO_OFFICIAL_SAMPLING_PRICE_TABLE` | 可信单价表 | 缺价格时费用保持待核对，不估算成交价 |
| `GEO_OFFICIAL_SAMPLING_TIMEOUT_MS` | 采样超时 | 可选。超时留在待核对 |
| `GEO_PUBLIC_PAGE_FETCH` | 公开页只读抓取 | 只有精确等于 `true` 才开启。HTTP 成功本身不是 `verified_public` |
| `REDIS_URL` | 默认缓存 | 未配置或不可达时，读路径回源数据库 |
| `GEO_CACHE_DRIVER` | `redis` 或 `memory` | 默认 `redis`。只有显式 `memory` 才使用进程内缓存。Redis 故障不会自动改成 memory |
| `GEO_DUAL_DB_URL` | 双库验证用的另一个回环 PostgreSQL | 只在不用默认 `127.0.0.1:55432` 时设置 |

`DEEPSEEK_API_KEY` 仍在 `.env.example` 中留空，当前源码不读取它。

本地邮件 mock 可以解阻开发联调。它不能作为 #21 的真实投递证据。验收脚本继续走严格网关和数据库 `email_verified`。

## 2. 启动与存活检查

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

生产进程使用 `pnpm build` 后的 `pnpm start`。`GET /api/health` 只返回 `status` 和 `service`。存活响应不表示数据库、邮件、Redis 或采样可用。

没有会话时，工作台跳到登录页。每个敏感页面和 API 继续自行检查会话与资源归属。

## 3. 双库部署

部署和升级只使用已审核的 migration。步骤、空库全量 DDL 的限制和回放边界见 [数据库部署说明](../architecture/database-deployment.md)。

```bash
# PostgreSQL。先在目标环境安全配置 DATABASE_URL。
pnpm db:migrate

# SQLite。必须显式选择后端。
DATABASE_PROVIDER=sqlite SQLITE_PATH=/absolute/path/geo-pro-dev.sqlite pnpm db:migrate

# 本机可选 PostgreSQL。绑定 127.0.0.1:55432，项目名 geo-pro-phase0。
docker compose -p geo-pro-phase0 up -d
pnpm db:migrate
```

不用 `push` 代替迁移。全量 DDL 导入只适用于空库，导入后没有 Drizzle 迁移历史，不能再直接跑完整 `pnpm db:migrate`。

#38 在隔离库从第 5 条迁移升到当时的 52 张表，并确认空库迁移与全量 DDL 结构一致。以后的结构变化以新的迁移和 `pnpm db:ddl:check` 为准。需要复验时运行 `pnpm verify:dual-db`。它使用 Compose 地址或 `GEO_DUAL_DB_URL`，创建并删除 `geo_b08_` 前缀的随机库，不读取调用方的其他数据库。

## 4. 回滚

迁移是向前的，仓库没有自动向下迁移。

1. 停止用户流量。
2. 本次发布没有新 migration 时，部署上一个已验证的 Git 版本并重启。
3. 本次发布已经迁移时，先确认旧版本应用能在新 Schema 上运行。不能确认时，把获准备份恢复到与用户流量隔离的库，再把该库迁移到准备启用的版本。
4. 恢复出来的库按 [B07 恢复顺序](../tasks/B07-brand-purge.md#backup-replay) 核对清除清单并执行 `pnpm --silent brands:purge replay <page.json>`。清单缺页、清除失败或无法核对最新清单时，目标库保持隔离。
5. 用授权测试身份确认应清除的品牌不可读、旧下载不可用，其他品牌仍可读，然后再接入用户流量。
6. 把 Git 版本、迁移标识、操作人、时间和退出码写入 [演练记录](m0-pilot-templates.md)。不记录连接串、密钥或客户正文。

生产备份介质、轮换和保留披露仍由 #21 核验。本手册不把历史隔离重放写成生产演练已完成。

## 5. 故障定位

沿用 [B14 支持定位](../tasks/B14-support-recovery.md)。具有 `support.read` 的维护者使用 `/dashboard/maintenance/support` 或 `GET /api/maintenance/support?operationId=`。

响应只含失败分类、核对状态、剩余项、恢复入口和追踪编号。不返回客户正文、附件、私人报告、通道展示名或操作说明。工单只记录追踪编号和失败分类。

恢复入口仍走原权限：

1. 费用未知时，由运行负责人在原运行核对实际金额。`support.read` 不能代为核对。
2. 清除未完成时，在已授权的服务器执行 `pnpm brands:purge retry <owner-id> <brand-id>`。重试从凭证中的剩余步骤开始。
3. 通道退化时，由具有 `capabilities.manage` 的账号复核该通道。
4. 数据库事务失败时停止处置并保留追踪编号。
5. 缓存不可用时以数据库结果为准。权限每次读取数据库，撤销后的下一次请求拒绝。

公开健康检查不包含故障详情。

## 6. 品牌冻结与清除演练

在隔离库和合成品牌上演练。正式环境在 #21 完成开放检查前保持品牌入口关闭。

软件行为：

- 负责人在品牌详情预览影响后确认冻结。默认恢复窗口为 30 天。冻结后，普通详情、历史版本、品牌草稿、旧导出和新额度动作拒绝。既有尝试仍可核对费用。
- 恢复要求负责人邮箱已验证、冻结后重新登录，并在登录后五分钟内提交。成功后恢复原业务状态；旧导出需要重新生成。
- 缩短恢复期只在已核验的私密渠道受理后，由受控服务器执行 `pnpm brands:shorten-recovery`。请求正文留在受理渠道，命令记录只保留标识、时间和结果。受理人与渠道本身仍待 #21 填写。
- 到期后由 `pnpm brands:purge run 25` 分页清除。待核对费用返回 `unresolved-costs` 时，先完成费用核对再重试。清除后保留品牌与负责人的不透明关联、金额最小单位、币种、时间和清除凭证。
- 本人导出在下载时重建。冻结品牌不进入新导出。系统外已经下载的文件由持有人管理。
- 清除后 30 天内退役备份是工程目标。实际备份权限、独立保存和轮换待 #21 记录。

演练顺序：

1. 确认目标是隔离库，并记录库的代号。不要把连接串写入仓库。
2. 用合成品牌完成冻结、越权读取拒绝和旧下载拒绝。
3. 在恢复窗口内用已验证邮箱的负责人恢复，确认旧下载仍然失效。
4. 对另一条到期数据执行清除。先制造一笔待核对费用，确认清除停住；核对同一金额后重试，确认正文已删除且最小凭证仍在。
5. 按第 4 节把清除清单重放到隔离副本，确认目标品牌不可读、其他品牌仍可读。
6. 把命令、退出码和观察写入模板。本次 #40 不执行该演练，也不填写结果。

## 7. 待核对费用

负责人在 `/dashboard/monitoring/runs/[runId]` 对采样尝试提交实际金额。

- 费用已经是已知状态时，再次提交同一最小单位金额返回原结果。不同金额返回 `OPERATION_CONFLICT`，停止改写。
- 提交空值时，该尝试保持或变为未知，不发明金额。
- 核对写入现有尝试和额度账本。已成功槽位不因此重新采样。
- 没有单价、超时或结果晚到时，保持待核对。设置页可以查看本人的额度变动。
- 清除遇到 `unresolved-costs` 时，先完成上述核对，再执行清除重试。
- 支持人员不从含正文的页面复制金额。金额来自获准的账单或负责人在原运行中的核对。

真实供应商账单仍由 #31 提供。隔离传输产生的金额不能填入真实成本记录。

## 8. 常见异常

| 现象 | 处理 |
| --- | --- |
| 品牌页面说明资料入口关闭 | 正式环境保持关闭。只有回环隔离开关会打开合成资料路径 |
| 工作台首页模块卡片显示未开放 | 卡片状态不是路由清单。已交付功能使用第 9 节的直接地址 |
| 官方采样没有发起 | 四项采样配置或通道验证不齐时保持关闭。不用合成回答充当真实采样 |
| 公开抓取没有发生 | `GEO_PUBLIC_PAGE_FETCH` 不是 `true` 时保持关闭。开启后仍以分类结果区分公开、受限和人工证明 |
| 登录或邮件恢复不可用 | 检查认证密钥、邮件网关和可信 IP 头。mock 只用于开发。记录追踪编号，不记录重置链接或邮件正文 |
| 页面或 API 显示找不到 | 无归属、已冻结和不存在对外使用同一结果。用操作编号定位，不扩大维护者的正文权限 |
| `OPERATION_CONFLICT` | 已核对金额与新金额不一致。保留原账本，不再提交另一个数 |
| `unresolved-costs` | 负责人先核对，再 `brands:purge retry` |
| `APPROVAL_REQUIRED`、`FACT_INVALID`、`LABELING_UNVERIFIED` | 导出预检逐项给出阻塞。只对负责人确认的合格子集导出。标识未核实不能生成正式包 |
| `PREFLIGHT_REQUIRED`、`SUBSET_INVALID` | 先完成预检，再提交当时的合格子集 |
| 运行因预算暂停 | 不自动追加采样。额度调整走维护授权 |
| Redis 未配置或不可达 | 相关读路径回源数据库。不要把进程内 memory 当作多实例共享缓存 |
| 健康检查成功但业务失败 | 健康检查只说明进程存活。继续检查数据库、会话、通道和缓存 |

## 9. 已交付路由

未登录访问这些工作台地址会回到登录页。品牌业务在正式环境保持关闭；下表表示软件路由已经存在。

| 路径 | 用途 |
| --- | --- |
| `/dashboard/brands`、`/dashboard/brands/new`、`/dashboard/brands/[id]` | 品牌列表、三步建档和详情 |
| `/dashboard/brands/[id]/facts` | 事实与材料 |
| `/dashboard/brands/[id]/questions` | 监测问题 |
| `/dashboard/brands/[id]/delete`、`/dashboard/brands/[id]/recovery` | 冻结影响预览和恢复 |
| `/dashboard/monitoring/new`、`/dashboard/monitoring/runs/[runId]` | 运行确认和执行/核对 |
| `/dashboard/monitoring/overview`、`/dashboard/monitoring/answers` | 概览和回答列表 |
| `/dashboard/monitoring/evidence/[observationId]` | 回答证据 |
| `/dashboard/optimization`、`/dashboard/optimization/[taskId]` | 优化任务 |
| `/dashboard/content` 及其 Brief、批次、版本、发布记录 | 草稿、审核、导出和回填 |
| `/dashboard/reports` | 复测与报告快照下载 |
| `/dashboard/settings`、`/dashboard/settings/usage` | 账户、导出、额度和用量 |
| `/dashboard/maintenance`、`/dashboard/maintenance/capabilities`、`/dashboard/maintenance/support` | 维护授权、通道台账和支持定位 |

竞品域没有页面。引用记录附在证据中，`src/features/citations` 仍是占位说明。

界面语言为 `zh-CN` 与 `en`，默认 `zh-CN`。切换语言应保留身份、已保存草稿和冻结状态。采样语言、币种和统计时区不随界面语言改变。

## 10. 交付检查

适用命令见仓库 `.agents/governance/quality-gates.md`。文档变更运行 `python docs/tools/validate_docs.py`。Schema 变更才运行迁移生成和 `pnpm db:ddl:check`。#40 的实际命令与结果写在 [验收记录](../tasks/M0-40-operations-baseline.md)。
