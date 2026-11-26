# GeoPro

GeoPro 面向中国大陆品牌经营者，帮助负责人从 AI 回答中查找品牌提及、推荐与引用，追溯原始证据，并用同口径复测。

工作台已有双语账号、品牌建档和事实管理、冻结题集、监测登记与预算、证据下钻、内容审核交付、报告、本人导出和品牌冻结恢复。用户文件走私有 S3 对象存储。M1/M2 已有多项可运行的软件切片，各阶段的真实试点验收仍待完成。二期按[模块首版计划](docs/tasks/phase-2.md)推进，开发环境的用户实测直接用于业务验收。当前实现与验证证据见 [交付进度](docs/tasks/delivery-progress.md)。

<a id="local-development"></a>
## 本地开发

使用 Node.js 24 LTS 和 `pnpm@12.14.0`。复用现有开发数据库、Redis 和 S3 兼容文件存储，在 gitignored 的 `.env.local` 或进程环境准备以下配置。新环境可从 [.env.example](.env.example) 复制，认证密钥可用 `openssl rand -base64 48` 生成。

| 组件 | 必填配置 |
| --- | --- |
| 数据库 | PostgreSQL 配 `DATABASE_URL`，或设 `DATABASE_PROVIDER=sqlite` 并指定已迁移的 `SQLITE_PATH` |
| Redis | `REDIS_URL`。常规应用使用 Redis；memory 供显式隔离测试使用 |
| 文件存储 | `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`。浏览器预签名使用 `S3_ENDPOINT_BROWSER`。SeaweedFS 路径风格设 `S3_FORCE_PATH_STYLE=true`，阿里云 OSS 设 `false` |
| 认证 | `BETTER_AUTH_URL` 和至少 32 字符的 `BETTER_AUTH_SECRET`。开发邮件和邮箱校验都启用 Mock |
| AI 联调 | `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`。真实官方采样另配 `GEO_OFFICIAL_SAMPLING_*` 并核验能力与价格 |

```bash
pnpm install --frozen-lockfile
# 仅在明确的目标开发库需要初始化或升级时执行迁移。
pnpm db:migrate
pnpm env:check
pnpm dev
```

`pnpm dev` 和 `pnpm start` 启动前检查数据库、Redis、对象存储与认证配置。`pnpm env:check` 进一步读取开发库表结构，验证 Redis 短时键和对象存储探针的写入、读取与清理，也检查 AI 配置。各服务地址由显式配置提供。需要单独建本机 PostgreSQL 时，见 [可选 Compose 与数据库迁移](docs/architecture/database-deployment.md#database-setup)。

用 `BETTER_AUTH_URL` 对应的主机访问 `/`、`/login` 和 `/dashboard`。`/api/health` 仅用于存活检查。开发期真实数据联调见 [品牌管理与 AI 品牌监测计划](docs/tasks/brand-monitoring-next.md)，正式开放条件见 [M0 运行手册](docs/operations/m0-runbook.md)。

### Web API 跨域

独立前端调用 GeoPro 的 `/api/*` 时，在 GeoPro 服务端设置 `GEO_WEB_ALLOWED_ORIGINS` 并重启。例如 API 运行于 `http://localhost:3000`，前端运行于 `http://localhost:3001`，则填 `http://localhost:3001`。多个来源用逗号分隔，逐一填写可信前端的协议、域名及非默认端口。默认留空。

前端调用登录和需要会话的接口时，为 `fetch` 设置 `credentials: "include"`。同站子域或同一主机的不同端口可以沿用默认 Cookie 策略。前端和 API 分属不同站点且依赖 Cookie 时，API 须使用 HTTPS，并设置 `GEO_WEB_CROSS_SITE_COOKIES=true`。实际能否保存和发送 Cookie 取决于浏览器的第三方 Cookie 策略。

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm check:i18n
pnpm test:i18n
pnpm db:ddl:check
python docs/tools/validate_docs.py
```

`pnpm build` 可离线执行。HTTP、浏览器和双库隔离验证按 [质量门禁](.agents/governance/quality-gates.md) 配置。`pnpm verify:dual-db` 需显式设置 `GEO_DUAL_DB_URL`，以回环 PostgreSQL 创建本轮隔离库，与日常开发库分开。修改 Schema 时同步生成双方言迁移和全量 DDL，详见 [数据库部署说明](docs/architecture/database-deployment.md)。

## 项目文档

- [产品文档入口](docs/README.md) 汇总 PRD、规格、指标合同与 M0–M2 任务。
- [架构总览](docs/architecture/overview.md) 说明服务与模块边界。
- [Agent 开发约定](AGENTS.md) 指向任务流程、Issue 流程及适用的验证规则。
