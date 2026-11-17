# 安全基线规范

本规范定义本仓库的最低安全要求，所有涉及认证、输入处理、环境变量、依赖变更或外部交互的任务均必须遵守。

## 密钥与环境变量隔离

- **禁止硬编码凭据**：不得将任何密钥、Token、密码或真实 `DATABASE_URL`、`BETTER_AUTH_SECRET`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 写入源码、测试脚本或文档。
- **严禁向客户端暴露服务端配置**：
  - 不得将敏感环境变量写入 `NEXT_PUBLIC_*`。
  - 环境变量读取（如 `src/lib/auth/env.ts`）、数据库连接（`src/lib/db/index.ts`）与认证服务端实例（`src/lib/auth/server.ts`、`session.ts`）必须保留 `import "server-only"`。
- **保护本地环境文件**：`.env.local` 为本机私有配置且已被 Git 忽略，禁止纳入版本控制；`.env.example` 仅保留空密钥或本地示例占位。

## 输入校验与服务端鉴权

- **校验所有不可信输入**：对表单提交、URL 参数、Route Handler 请求体与 Server Action 参数执行严格 Zod 校验，限制长度、格式与枚举范围。
- **服务端权威鉴权**：
  - 敏感页面与受保护接口必须通过服务端 `auth.api.getSession`（或 `requireSession()`）验证会话。
  - **不得凭客户端状态或 Cookie 存在性判断已登录**。
  - 后续业务接口除验证登录态外，还必须校验当前用户对目标资源的归属权（Ownership / Tenant 隔离），不能只依赖布局层跳转。

## 敏感输出与日志

- 不向客户端返回数据库错误原文、连接字符串、内部堆栈或服务端环境变量细节（参考 `/api/auth/[...all]` 与 `/api/health` 的受控响应方式）。
- 测试与验证脚本（如 `scripts/verify-auth.mjs`）不得在日志中打印密码、会话 Cookie 或完整数据库连接串。

## 依赖与操作边界

- **依赖供应链审慎**：引入新依赖前必须评估必要性、维护状态、peer dependencies 与安全公告；尊重 [pnpm-workspace.yaml](../../pnpm-workspace.yaml) 对构建脚本的最小授权（仅允许必要脚本如 `esbuild`）与补丁 override。
- **禁止未经授权的高危操作**：
  - 不运行 `git reset --hard`、`git clean -fd`、强制覆盖或删除生产/已有用户数据等破坏性命令。
  - 不用 `drizzle-kit push` 替代迁移流程；不静默改动生产数据库数据。
  - 未经用户明确指令，不得执行 `git commit`、`git push`、发布或线上部署。
