# ai

AI 基础设施层（仅服务端调用，`import "server-only"`）。

- 所有模型接入统一支持 OpenAI **Responses API** 标准（`POST ${OPENAI_BASE_URL}/responses`），见 `responses.ts`。
- 服务端环境变量：`OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`（本地开发值保存在 gitignored 的 `.env.local` 中，严禁写入源码、`NEXT_PUBLIC_*` 或文档）。
