# GEO SaaS · Codex 工程初始化任务书

> Phase 0 已完成。本文件保留初始化范围，现行服务配置见 [开发服务](architecture/overview.md#development-services)。
>
> 用途：将本文件放入仓库的 `docs/CODEX_INIT.md`，然后让 Codex 按本文件在当前仓库执行。
> 目标：建立可运行、可继续由多个 Coding Agent 迭代的 Next.js 全栈 GEO SaaS 基础工程。
> 范围：仅执行 Phase 0 工程初始化；**不实现 GEO 监测、AI 采集、竞品分析或优化算法**。

## 0. Codex 执行指令

你是本仓库的执行型 Coding Agent。**直接检查仓库、修改代码、安装依赖并运行验证**，不要仅输出建议或设计稿。

执行时遵守以下优先级：

1. 用户本轮明确指令。
2. 仓库已有的 `AGENTS.md`、产品 PRD / 架构文档及现有代码约束。
3. 本初始化任务书。
4. 相关官方文档与框架默认约定。

遇到现有文档与本文件不一致时，优先保留原有业务需求，在最终报告说明冲突和处理方式。对于依赖版本、CLI 参数，按执行时的**稳定版官方文档**校验；不要使用 canary / RC 版本，除非现有项目已明确采用。

**执行边界：**

- 不删除、不覆盖现有 `docs/`、`geo-prd/`、`.git/`、业务源代码、未提交改动或用户的配置文件。
- 不运行 `git reset --hard`、`git clean -fd`、强制覆盖命令或破坏性数据库操作。
- 不提交真实密钥，不把密钥写入 `NEXT_PUBLIC_*` 变量。
- 不添加 NestJS、微服务、Monorepo、OpenSpec、Redis、队列、Kubernetes 或第三方状态管理，除非项目已有明确要求。
- 在能力允许时自主完成任务，不因非关键的缺少信息停止。缺少数据库/Docker/网络/密钥时完成其余工作，并明确标注受阻项；不要伪造验证通过。
- 不要主动创建 Git commit 或 push，除非用户另有要求。

## 1. 产品背景与技术栈

本项目是**面向中国大陆市场的 GEO（Generative Engine Optimization）监测与优化 SaaS**。后续会提供：品牌管理、AI 答案品牌提及监测、提示词问题库、网页引用分析、竞品对比、优化建议及效果复测。

本次初始化仅为这些功能保留清晰的扩展位置。

| 层级 | 技术约束 |
| --- | --- |
| 框架 | 最新稳定版 Next.js，App Router |
| 语言 | TypeScript，启用严格类型检查 |
| 包管理 | pnpm；仅保留一份锁文件 |
| CSS/UI | Tailwind CSS + shadcn/ui + lucide-react |
| 数据库 | PostgreSQL |
| ORM | Drizzle ORM + drizzle-kit |
| 认证 | Better Auth + 官方适配的 Drizzle Adapter |
| 校验 | Zod |
| 图表 | Recharts（仅安装或示例占位，不制作假数据趋势图） |
| 架构 | 单 Next.js 应用、模块化单体、服务端优先 |

Node.js 使用受支持的 LTS，满足所选 Next.js 版本的最低要求；不得因为机器已有旧版本而降低依赖要求。

## 2. 开始前的仓库检查（必须先做）

按顺序检查：

1. 当前工作目录及文件结构；查看 `git status`，发现未提交变更时保护它们。
2. 查找 `AGENTS.md`、`README.md`、`docs/`、`geo-prd/`、`package.json`、`src/app/`、`pnpm-lock.yaml` 和现有环境配置。
3. 阅读已有的产品 MVP 与架构文档，确保初始化不改变产品定位和已有共识。
4. 检查 Node.js、pnpm、Git 是否可用；如缺少工具，给出明确阻塞信息。
5. 判断项目状态：
   - **已有 Next.js 项目**：在现有项目上增量配置，禁止重新运行脚手架。
   - **目录基本为空**：可直接在根目录初始化。
   - **已有文档或 Git 仓库但尚无 Next.js**：在安全的临时兄弟目录创建脚手架，逐文件合并到当前仓库，跳过 `.git`、`node_modules`、冲突的 README/docs 和任何用户文件；完成后清理仅由你创建的临时目录。
6. 不做静默覆盖。遇到无法安全合并的关键配置，记录冲突并保留现有文件。

全新空目录时，脚手架的参考命令如下；执行前用 `--help` 核实参数：

```bash
pnpm create next-app@latest . --ts --eslint --tailwind --app --src-dir --import-alias "@/*" --use-pnpm --no-react-compiler --disable-git --yes
```

确保生成的 `@/*` 指向 `./src/*`。若根目录已有 Git 仓库，应继续使用现有分支，不重建仓库；如果无 Git 仓库，可执行 `git init -b main`。

## 3. 基础依赖与脚本

在已确认是 Next.js 项目的目录执行（不要盲目重复安装现有依赖）：

```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button card input badge table tabs dialog sidebar skeleton separator dropdown-menu form
pnpm add drizzle-orm postgres better-auth @better-auth/drizzle-adapter zod recharts @next/env
pnpm add -D drizzle-kit
```

说明：

- shadcn/ui 按实际 CLI 提示选定稳定配置，组件基于官方 registry 安装。
- 不使用 `shadcn add --all`；不安装没有实际需求的全套组件。
- 不引入第二种 ORM 或第二套 Auth 框架。
- `package.json` 至少提供 `dev`、`build`、`start`、`lint`、`typecheck`、`db:generate`、`db:migrate`。
- `lint` 使用 `eslint`，**不要使用已移除的 `next lint` 命令**；`typecheck` 为 `tsc --noEmit`。
- 如果现有依赖已有脚本或版本锁定，采用增量修改而非重写整个 `package.json`。

## 4. 目标目录结构

以下是期望结构，而非要求无意义地创建大量空文件。空目录可使用简短 README 说明边界。

```text
.
├── AGENTS.md
├── README.md
├── docs/
│   ├── CODEX_INIT.md
│   ├── architecture/
│   │   └── overview.md
│   └── tasks/
│       └── phase-0.md
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── (marketing)/page.tsx          # / 首页
│   │   ├── (auth)/login/page.tsx         # /login
│   │   ├── (dashboard)/dashboard/page.tsx # /dashboard
│   │   └── api/
│   │       ├── auth/[...all]/route.ts
│   │       └── health/route.ts
│   ├── components/
│   │   ├── ui/                            # shadcn/ui
│   │   ├── layout/
│   │   └── charts/
│   ├── features/
│   │   ├── brands/
│   │   ├── monitoring/
│   │   ├── prompts/
│   │   ├── citations/
│   │   ├── competitors/
│   │   └── optimization/
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts
│   │   │   └── auth-schema.ts
│   │   ├── auth/
│   │   │   ├── server.ts
│   │   │   └── client.ts
│   │   ├── ai/
│   │   └── cache/
│   └── types/
├── drizzle/
├── drizzle.config.ts
├── .env.example
└── package.json
```

注意：Next.js 路由组名不出现在 URL 中。根路径 `/` 只能有**一个** page；脚手架的 `src/app/page.tsx` 与 `(marketing)/page.tsx` 不能共存。按现有情况安全迁移并避免同路径冲突。

### 分层规则

- `app/`：路由、布局、页面组合、Route Handlers；不承载复杂业务逻辑。
- `features/<domain>/`：每个领域的组件、服务、校验和未来业务用例。
- `components/ui/`：仅放设计系统基础组件。
- `lib/db/`、`lib/auth/`：基础设施实现，仅在服务端导入含密钥或数据库连接的模块。
- 默认使用 React Server Components；需要交互时局部使用 Client Components。
- 不为了目录完整度发明业务模型、模拟分析数据或无意义抽象。

## 5. 页面及视觉初始化

### `/` 产品官网占位

展示产品定位「GEO 品牌可见度监测与优化平台」，包括简洁导航、Hero、核心功能概览、登录/进入控制台入口。保留未来接入真实监测案例的区域，但**不要伪造排名、提升比例或客户评价**。

### `/login`

使用 Better Auth 真实的邮箱/密码认证流程。提供基础输入校验、提交中的反馈及错误提示。无需短信登录、第三方社交登录、验证码服务或付费系统。

### `/dashboard`

提供侧边导航、顶部栏、欢迎区和模块入口（品牌、AI 监测、提示词、引用、竞品、优化）。模块尚未实现时使用「尚未配置/暂无数据」空状态，不能制造假业务记录。页面请求应在服务端校验会话，未登录跳转 `/login`。

### 设计规范

- 默认浅色主题、柔和中性底色、低饱和蓝青作为强调色，避免大面积高对比霓虹色。
- 响应式布局；重视表格可读性、合理留白、焦点状态和键盘访问。
- 中文作为初始产品文案语言；代码标识符、目录名使用英文。
- 避免额外的大型 UI 动画库。优先使用 Tailwind、shadcn/ui、Lucide 图标。

## 6. PostgreSQL、Drizzle 与 Better Auth

1. 使用 PostgreSQL + Drizzle 的稳定驱动；配置 `src/lib/db/index.ts` 及 `drizzle.config.ts`。
2. Drizzle 配置通过 `@next/env` 的 `loadEnvConfig(process.cwd())` 加载根目录 `.env.local`，不要假设外部 CLI 会自动读取 Next.js 环境文件。
3. Auth 使用 Better Auth 的 **Drizzle Adapter**（根据安装版本的官方路径），数据库 provider 为 `pg`。
4. 先完成可供 CLI 加载的最小 Auth 配置，再用 Better Auth CLI **生成 Auth 所需 Drizzle Schema**；根据实际版本校验生成参数，不要手写猜测其内部表结构。将生成 Schema 纳入 Drizzle 配置，随后接入完整 Adapter。
5. 配置 `src/app/api/auth/[...all]/route.ts`，使用官方 Next.js Handler；前端 Auth Client 放在 `src/lib/auth/client.ts`。
6. 通过服务端 `auth.api.getSession` 保护 dashboard 及后续敏感接口；**仅凭客户端状态或 cookie 是否存在不能视作有效鉴权**。
7. 使用迁移文件工作流：生成迁移 `drizzle-kit generate`，有可用数据库时再运行 `drizzle-kit migrate`；不在生产数据库执行 `push`。
8. 若可用开发数据库存在，验证真实注册、登录、未认证重定向；若数据库不可用，保持代码和迁移可生成，并如实报告端到端验证未完成。

必要时可参考当前官方 CLI 的形态（实际以帮助与稳定版本为准）：

```bash
pnpm dlx auth@latest generate --adapter drizzle --dialect postgresql
pnpm exec drizzle-kit generate
pnpm exec drizzle-kit migrate
```

若 Auth CLI 的首次生成需要调整 `--config` / `--output` 或解决 Schema 循环引用，请先完成最小配置再生成，而非重复重试同一失败命令。

### 环境变量

创建 `.env.example`（仅示例，**没有真实密钥**）：

```dotenv
DATABASE_URL=
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
```

- `.env.local` 属于本机私有配置，必须被 `.gitignore` 忽略。
- 若使用本机测试密钥，可在 `.env.local` 中生成安全随机值，不要复用示例占位密钥。
- 应用不应因 AI Key 留空而无法展示首页和登录页。
- 可提供一个**可选**的本地 PostgreSQL `compose.yaml`，但不得把 Docker 设为构建必需条件。
- 不在初始化阶段接入真实 AI 模型调用或计费功能。

## 7. 基础工程文档

### 根目录 `AGENTS.md`

生成或补充 Codex/多 Agent 的长期开发规范：

- 开发前阅读 `docs/` 的当前 PRD/架构和对应 GitHub Issue。
- 一个 Issue 只覆盖一个清晰的交付范围，修改尽可能局部、可审核。
- TypeScript strict；避免 `any`、大而全通用层和非必要依赖。
- 任何新 API 必须校验输入、验证权限、限制敏感信息输出。
- 数据库结构变更附带 Drizzle migration；禁止静默改动生产数据。
- 业务代码按 `features/` 分组，页面文件保持薄层。
- 每次任务结束执行 lint、typecheck、build，并汇报结果。
- 不修改或删除已有产品文档来适配代码；有冲突先说明。

### `docs/architecture/overview.md`

说明架构、模块边界、Server / Client 组件原则、API 权限边界、未来异步任务可拆分路径，以及哪些功能当前尚未实现。

### `docs/tasks/phase-0.md`

写明本轮已完成项、未完成项、必要的本地启动命令、环境变量说明和验收结果。

### `README.md`

提供：项目概述、前置依赖、环境变量、开发启动、质量检查、数据库迁移和当前 MVP 范围。保留原 README 中有价值的信息。

## 8. 质量验证与验收

在完成修改后，实际执行并记录：

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build
```

进一步验证（能力允许时）：

- `pnpm dev` 能启动；`/`、`/login`、`/dashboard` 路由存在。
- `/api/health` 返回结构化 JSON，**不能**泄露密钥、数据库 URL 等信息。
- 未登录请求 `/dashboard` 会跳转到 `/login`。
- 有开发数据库时：迁移成功，注册/登录/退出登录流程可用。
- `.env.local` 不被 Git 跟踪；`pnpm-lock.yaml` 与使用的包管理器一致。
- 不存在重复首页路由、脚手架遗留欢迎页或编译警告导致的构建失败。

若依赖安装、网络、数据库或认证验证无法完成：准确记录执行命令、原始错误摘要、受影响验收项和下一步操作，不允许将其标记为成功。

## 9. 严格禁止的范围蔓延

本任务中**不实现**：真实 GEO 监测、AI Provider 适配调用、提示词调度、网页抓取、引用解析、竞品分析算法、报告生成、SEO 自动发布、抖音/小红书授权、支付订阅、复杂 RBAC、多租户计费、Redis/队列、后台 Worker、定时任务、CI/CD 发布和 OpenSpec 全套工作流。

允许创建清晰的 feature 目录、菜单入口和真实空状态，但不引入假功能。

## 10. Codex 最终输出格式

执行完毕后，直接在回复中输出以下部分：

1. **执行概述**：实际初始化了什么，以及是否沿用现有项目。
2. **文件变更**：关键新增/修改文件路径（重点说明既有文件的保护情况）。
3. **依赖与版本**：实际安装的主要依赖版本和 Node/pnpm 版本。
4. **运行验证**：分别报告 lint、typecheck、build、开发服务/HTTP、数据库迁移、登录测试的成功/失败/未运行状态。
5. **阻塞与风险**：真实错误、未完成条件以及是否需要用户操作。
6. **后续建议**：只推荐下一个最小 Issue（例如品牌录入基础模型和 CRUD），不要自动实施。

**完成定义：** 形成可运行、可持续扩展、UI 风格一致的 Next.js GEO SaaS 基础工程；业务功能仍处于有边界的待开发状态。

## 官方参考文档

- Next.js 安装和 CLI：https://nextjs.org/docs/app/getting-started/installation
- create-next-app 参数：https://nextjs.org/docs/app/api-reference/cli/create-next-app
- shadcn/ui Next.js：https://ui.shadcn.com/docs/installation/next
- Drizzle PostgreSQL：https://orm.drizzle.team/docs/get-started/postgresql-new
- Better Auth Next.js：https://better-auth.com/docs/integrations/next
- Better Auth Drizzle Adapter：https://better-auth.com/docs/adapters/drizzle
- Better Auth CLI：https://better-auth.com/docs/concepts/cli
- Next.js 环境变量：https://nextjs.org/docs/app/guides/environment-variables
