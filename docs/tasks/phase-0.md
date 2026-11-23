# Phase 0 工程初始化记录

执行日期：2026-11-17（Asia/Singapore）。范围：[CODEX_INIT](../CODEX_INIT.md)。仅工程基础，不等同产品 M0 完成。

本文件记录 Phase 0 当时的环境与结果。现行应用启动和服务目标参见 [开发服务](../architecture/overview.md#development-services)。

## 仓库保护与范围处理

- 原仓库只有 README、Git 配置、产品文档与已有 OpenSpec/Agent 技能，没有 `package.json` 或业务代码。在临时兄弟目录用 `create-next-app@16.4.6` 生成脚手架，再逐文件合并；跳过 README、`.gitignore`、模板图片和 `.git`，没有覆盖用户文件。
- 初始 `git status` 为 `main...origin/main`，存在未跟踪 `.agents/`、`docs/`、`openspec/`。本轮不提交、不 push，不修改 `.gitignore`。扩写原 README，保留项目名与 AI GEO 定位。
- 对既有 `docs/`、`.agents/`、`openspec/` 的 **45 个文件**建立 SHA-256 清单并复核，未改动既有文件；仅新增本文与架构说明。临时脚手架在完成后清理。
- 当前产品文档明确旧技术架构入口已停用，技术栈由新项目决定，因此遵循初始化任务书。产品文档默认 M0 的指令由用户本轮明确的 Phase 0 范围覆盖；所有 M0–M2 业务任务仍未完成。
- 六个模块通过页面内锚点进入真实空状态，不创建虚假业务路由；没有模拟图表、业务数据、效果提升或客户评价。

## 实际完成

- [x] 单应用 Next.js App Router、`src/`、TypeScript strict 与 `@/* → ./src/*`。
- [x] pnpm 唯一锁文件、Node 版本约束、ESLint 与类型/构建/数据库脚本。
- [x] Tailwind CSS、Lucide、官方 shadcn registry 基础组件：button/card/input/badge/table/tabs/dialog/sidebar/skeleton/separator/dropdown-menu/form，以及依赖的 label/sheet/tooltip。
- [x] 中文浅色官网 `/`、邮箱注册/登录 `/login`、受服务端会话保护的 `/dashboard`、结构化 `/api/health`。
- [x] 表单 Zod 校验、提交中/失败反馈、真实 Better Auth Client 和退出按钮；没有客户端伪认证。
- [x] `server-only`、服务端环境校验、按需创建认证与数据库连接，公开页面不要求 AI Key。
- [x] 官方 CLI 生成四张认证表及关系；Drizzle SQL migration、快照、迁移日志；成功应用到独立开发 PostgreSQL。
- [x] 六个 feature、charts/ai/cache/types 目录的职责说明；无 GEO 业务实现。
- [x] `.env.example`、被忽略且权限为 0600 的本机 `.env.local`、可选本地 PostgreSQL Compose。
- [x] 根目录 Agent 约定、架构说明、启动与验收文档。
- [x] 可重复运行的本地 HTTP/数据库认证验证脚本；验证结束清理自己的测试账号。

## 实际依赖

精确解析结果以根目录 `pnpm-lock.yaml` 为准。

| 依赖/工具 | 版本 |
| --- | --- |
| Node.js / pnpm / Git | 24.22.0 / 12.14.0 / 2.56.1 |
| Next.js / @next/env / eslint-config-next | 16.4.6 |
| React / React DOM | 19.3.0 |
| TypeScript | 5.9.3，strict |
| Tailwind CSS / @tailwindcss/turbopack | 4.3.3 |
| shadcn CLI / Radix UI / Lucide React | 4.23.0 / 1.8.1 / 1.73.0 |
| Better Auth / 官方 Drizzle Adapter / Auth CLI | 1.7.25 |
| Drizzle ORM / Drizzle Kit / postgres.js | 0.45.4 / 0.31.11 / 4.1.1 |
| Zod / Recharts | 4.6.7 / 3.10.1 |
| React Hook Form / @hookform/resolvers | 7.92.0 / 7.0.6 |
| ESLint | 9.39.5 |
| 本地 PostgreSQL | 17.12（`postgres:17-alpine`） |

框架/认证版本通过稳定 npm dist-tag、官方文档和实际 CLI `--help` 核实，没有安装 canary/RC。ESLint 10 与当前 Next lint 插件的 peer 范围不兼容，因此使用脚手架兼容的稳定 9.39.5；安装时仍有上游弃用提示。稳定版 Drizzle Kit 的两个 esbuild-kit 间接依赖也有弃用提示，未使用 RC 替代。

shadcn nova registry 的 `form` 是空条目，因此从官方 `new-york-v4/form.json` 单独安装，未覆盖已有 button。shadcn 默认的移动端 Hook 触发 `react-hooks/set-state-in-effect`，已用 `useSyncExternalStore` 修复，未禁用 lint 规则。pnpm 12 首次阻止 esbuild 安装脚本，已在项目配置中精确允许 esbuild；其他许可保持脚手架默认。

首次依赖审计发现 `shadcn → ts-morph → minimatch@10.2.6` 的 [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)。通过有范围的 pnpm override 将受影响版本锁定到修复版 11.0.1，不覆盖不受该公告影响的 3.x。全量审计还发现 Drizzle 工具链 `@esbuild-kit/core-utils → esbuild@0.18.20` 的 GHSA-67mh-4wv8-2f99，精确 override 到 0.25.12。修改后全量/生产依赖审计均无已知漏洞，官方 Auth Schema CLI、Drizzle 生成、shadcn dry-run、lint/typecheck/build 均复验通过；后续上游修复时可评估移除 override。

## 启动与配置

```bash
pnpm install --frozen-lockfile
# 本轮已创建本机私有 .env.local；其他机器按 .env.example 配置。
docker compose -p geo-pro-phase0 up -d
pnpm db:migrate
pnpm dev
```

当时的 Compose 验证实例绑定 `127.0.0.1:55432`，认证来源为 `http://localhost:3000`。本轮使用至少 32 字符的私有随机密钥。`OPENAI_API_KEY`/`DEEPSEEK_API_KEY` 留空。

注册入口：[本地登录页](http://localhost:3000/login)中的“创建账号”。本地浏览器使用与 `BETTER_AUTH_URL` 相同的主机名。可选数据库可用 `docker compose -p geo-pro-phase0 stop` 停止，保留数据卷。

Schema/迁移顺序：

```bash
pnpm db:auth-schema
pnpm db:generate
# 审核 SQL 后再执行到明确的目标数据库。
pnpm db:migrate
```

CLI 配置复用认证选项，通过 `@next/env` 加载环境，不引用生成 Schema。Drizzle 同样显式加载根目录 `.env.local`，不依赖外部 CLI 自动识别 Next 环境文件。

## 验收记录

| 命令/场景 | 状态 | 实际结果 |
| --- | --- | --- |
| `pnpm install` | 成功 | 单一 pnpm 锁文件；安装完成，弃用提示见上文 |
| `pnpm lint` | 成功 | 移动端 Hook 修复后无错误、无 lint 警告 |
| `pnpm typecheck` | 成功 | TypeScript strict 检查通过 |
| `pnpm build` | 成功 | 生成 `/`、`/login`、`/dashboard`、认证和健康路由；无编译警告 |
| `pnpm dev` | 成功 | 本地 3000 端口启动并处理真实 HTTP 请求 |
| `GET /`、`GET /login` | 成功 | 均返回 200，无脚手架欢迎页 |
| `GET /api/health` | 成功 | 返回固定 `{status: "ok", service: "geo-pro"}`，不包含配置 |
| 未登录/伪造 Cookie 请求 `/dashboard` | 成功 | 均返回 307，Location 为 `/login` |
| Auth CLI / `pnpm db:generate` | 成功 | 官方生成 4 张表和关系，产生 SQL/快照/迁移日志 |
| `pnpm db:migrate` | 成功 | 应用到独立 Compose PostgreSQL 17.12 |
| `pnpm verify:auth` | 成功 | 开发模式和最终生产模式均通过；无效邮箱/短密码 400；注册 200 并持久化密码哈希；有效会话可读空控制台；错误密码 401；未信任来源 403；退出 200、旧会话失效并重定向；测试账号清理 |
| 无环境文件的 Schema/构建/HTTP | 成功 | 移开本轮生成的 `.env.local`、移除进程注入的数据库/认证/AI 变量；Drizzle 生成和生产构建通过；临时生产服务验证首页/登录 200、未配置提示、工作台 307、认证 API 503、健康 JSON，结束后恢复配置 |
| `pnpm audit` / `pnpm audit --prod` | 成功 | 全量与生产依赖均无已知漏洞 |
| peer / CLI 复验 | 成功 | `pnpm peers check` 无问题；shadcn add button dry-run 正常；Auth CLI 再生成成功；Drizzle 确认无 Schema 变化 |
| `.env.local` 与文件保护 | 成功 | Git 忽略、未被跟踪；45 个既有文件哈希未变 |
| `python docs/tools/validate_docs.py` | 成功 | 需求、任务、依赖、便携链接与数值样例检查通过；不代表业务验收 |
| 浏览器视觉、375/768/1440 宽度、键盘交互 | 未运行 | 浏览器检查工具返回 `The browser access host is unavailable`；已实现响应式样式、标签/焦点/跳转链接，但未宣称浏览器实测通过 |

HTTP 与真实数据库认证可通过 `pnpm verify:auth` 重复验证。验证脚本使用随机临时邮箱和密码，不打印密码、Token 或数据库 URL，只删除本次新建账号。预期的 400/401/403 会产生 Better Auth 校验日志，不是认证故障。

交付时开发/生产应用验证进程均已停止，可直接运行 `pnpm dev` 使用 3000 端口；本轮独立 PostgreSQL 容器保留运行，迁移与数据卷保留，验证账号已全部清理。没有 Git commit、push 或部署。

## 未完成与下一步

- 浏览器环境恢复后，补跑桌面/移动端视觉、表单交互、焦点与侧栏抽屉验收。HTTP 已验证，浏览器端交互仍未验证。
- 邮箱验证、密码找回和生产邮件配置不在本轮范围；仅验证本地邮箱/密码闭环。没有部署、生产数据库或外部渠道验收。
- 所有 GEO 业务保持待开发状态，未接入 AI、抓取、调度、报告、发布、队列或计费，也没有证明 M0 业务闭环可上线。
- 下一个最小 Issue 建议：按 `T-M0-01` 拆出“单负责人品牌基础建档、当前用户资源归属与最小读写”，先记录精确业务字段和验收；本轮不自动实施。
