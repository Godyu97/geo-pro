# geo-pro

GeoPro（AI GEO）是面向中国大陆品牌经营者的 GEO 品牌可见度监测与优化平台。产品方向是“真实回答 → 可追溯证据 → 内容动作 → 同口径复测”，不承诺固定排名。

当前仅完成 **Phase 0 工程初始化**：中文官网、邮箱/密码账号、受服务端会话保护的空工作台、PostgreSQL 认证表与迁移。六个业务模块仅有导航和真实空状态，尚未完成产品 M0。

后续工程要求已确认：DAO 支持 SQLite3 / PostgreSQL，cache 支持 memory / Redis（默认），查询优先批量 SQL，表结构保持精简并审查索引。当前尚无双数据库 DAO 或缓存实现，现有启动与迁移命令仍针对 PostgreSQL；详见 [数据访问与缓存工程约束](docs/architecture/data-access.md)。

当前 [PostgreSQL 全量 DDL](drizzle/ddl/postgresql.sql) 由 Schema 生成并随迁移维护；更新、检查和空库部署方式见 [数据库部署说明](docs/architecture/database-deployment.md)。

产品首期界面要求支持 `zh-CN` / `en`，默认 `zh-CN`；[Web 多语言规范](docs/architecture/i18n.md) 定义文案、语言切换、SSR、格式化及布局兼容。当前运行时仍为中文基线，英文与语言切换待实施。

## 环境准备

- Node.js **24 LTS**（本轮验证 `24.22.0`，仓库提供 `.node-version`）。
- pnpm **12.14.0**（见 `packageManager`），仅维护 `pnpm-lock.yaml`。
- PostgreSQL；可使用现有开发库，也可使用可选 Docker Compose。构建和公开页面不需要数据库或 AI Key。

```bash
pnpm install --frozen-lockfile
# 仅在不存在 .env.local 时复制；已有配置保持不动。
cp -n .env.example .env.local
openssl rand -base64 48
```

将新生成的随机值写入本机 `.env.local` 的 `BETTER_AUTH_SECRET`。该文件已被 Git 忽略，不要复用示例密钥或提交真实密钥。本次执行已生成本机私有配置，无需再次复制。

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL；可选 Compose 默认 `postgresql://geo:geo@127.0.0.1:55432/geo` |
| `BETTER_AUTH_URL` | 应用来源，默认 `http://localhost:3000`；本地浏览器请使用同一主机名 |
| `BETTER_AUTH_SECRET` | 至少 32 字符的服务端随机密钥；生产环境单独生成 |
| `OPENAI_API_KEY`、`DEEPSEEK_API_KEY` | 后续扩展预留，本轮留空且不读取、不调用 |

没有完整认证配置时，首页和登录页仍可打开；登录页显示账号服务尚未配置，提交按钮不可用。数据库不可用时无法注册/登录，不能把健康检查的存活状态当成认证可用性。

## 数据库与启动

可选本地数据库仅供开发，使用独立项目名与本机 `55432` 端口，避免影响其他项目：

```bash
docker compose -p geo-pro-phase0 up -d
pnpm db:migrate
pnpm dev
```

访问 [首页](http://localhost:3000)、[登录](http://localhost:3000/login)、[工作台](http://localhost:3000/dashboard) 与 [健康检查](http://localhost:3000/api/health)。新用户在登录页选择“创建账号”；未登录进入工作台会跳转登录。

改用其他 PostgreSQL 时修改 `DATABASE_URL` 后执行迁移即可。若更改 Compose 端口，设置 `GEO_POSTGRES_PORT` 并同步修改连接 URL。停止本次开发数据库使用 `docker compose -p geo-pro-phase0 stop`，保留已有数据卷。

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm db:ddl:check
# 需先启动本地应用并迁移开发数据库。
pnpm verify:auth
# 生产构建完成后可启动生产服务。
pnpm start
```

认证验证脚本通过真实 HTTP 与 PostgreSQL 检查公开路由、未登录及伪造 Cookie、输入校验、注册、密码哈希、登录、来源校验、退出与会话撤销。仅连接本地应用，创建独立验证账号并在结束后精确清理该账号；不生成业务记录。

## Schema 与迁移工作流

```bash
# 修改共用认证选项后，使用固定版本官方 CLI 重新生成认证 Schema。
pnpm db:auth-schema
# 生成 SQL 与快照，审核后再迁移目标数据库。
pnpm db:generate
# 与 Schema/migration 同步更新全量 DDL，再核对产物。
pnpm db:ddl
pnpm db:ddl:check
pnpm db:migrate
```

Auth Schema 由官方 CLI 生成；独立 CLI 配置避免引用未生成表的循环。Drizzle CLI 通过 `@next/env` 读取 `.env.local`，生成迁移不依赖数据库。不使用 `drizzle-kit push` 修改生产结构。

## 文档与范围

- [产品文档入口](docs/README.md)：当前 PRD/SPEC/指标合同、M0–M2 分级。
- [初始化任务书](docs/CODEX_INIT.md)：本轮 Phase 0 的执行边界。
- [架构与模块边界](docs/architecture/overview.md)。
- [Phase 0 验收记录](docs/tasks/phase-0.md)：依赖、命令、实际结果与未验证项。
- [Agent 开发约定](AGENTS.md)。
- [AI 工程治理索引](.agents/governance/README.md)：按任务加载架构、数据访问、安全与质量门禁，并遵循任务闭环。

邮箱验证与密码找回、业务 CRUD、真实采样、AI Provider、竞品分析、报告、内容发布和商业化均未实现。原有产品文档、历史快照与 OpenSpec 文件保留；不自动推进产品任务或启用其他工程工作流。
