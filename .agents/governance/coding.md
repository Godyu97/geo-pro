# 编码实现规范

本规范约束 TypeScript、React 与 Next.js 代码编写，以当前项目的 `tsconfig.json`、`eslint.config.mjs` 和 `components.json` 为准。

## 类型安全

- 保持 TypeScript `strict: true`（见 [tsconfig.json](../../tsconfig.json)）。
- 避免使用 `any`、无依据的类型断言（`as`）以及非空断言（`!`）；对外部输入、环境变量和 API 响应优先使用 Zod 解析收敛类型。
- 优先使用精确联合类型与接口推导，保证服务端与客户端组件间传递的数据结构可序列化且边界清晰。

## React 与 Next.js 实现要求

- **组件职责单一**：页面组合与数据获取在 Server Component 中完成，交互状态下沉到最小 Client Component。
- **遵循项目 ESLint 规则**：遵守 `eslint-config-next/core-web-vitals` 与 `typescript` 规则（见 [eslint.config.mjs](../../eslint.config.mjs)）；避免在 `useEffect` 中同步调用 `setState`，避免禁用规则来掩盖问题。
- **优先复用原生与现有 UI**：使用已安装的 shadcn/ui（`src/components/ui/`）、Lucide 图标与 Tailwind CSS；不引入冗余样式库或大型动画库。
- **全站视觉一致性**。新增或改版页面先读取参考图和规范，复用现有主题与组件，根据具体用户任务设计页面。 [全站 UI 设计规范](../../docs/ui-design/README.md)
- **双语言作为开发输入**：页面、文案、校验、图表、Metadata 和可访问性文本遵循 [Web 多语言规范](../../docs/architecture/i18n.md)，同步维护 `zh-CN` / `en` 消息与参数，默认 `zh-CN`；避免散落硬编码文案与语言分支。

## 异步与错误处理

- 所有异步调用（数据库查询、Better Auth 接口、`fetch`、外部服务）必须处理失败分支，向调用方返回明确、安全的状态或用户可理解的提示。
- 不吞掉异常并假装成功；缺少配置或外部依赖不可用时，应显式进入受控降级或错误反馈状态。

## 逻辑组织与代码风格

- **避免重复与过度抽象**：存在真实多处复用时再提取共享函数或组件；不为单次使用创建通用工厂或过度泛化的封装层。
- **一致的路径与命名**：
  - 使用 `@/*` 路径别名指向 `./src/*`；项目为 ESM（`"type": "module"`）。
  - 代码标识符、目录与文件名使用英文（延续现有 kebab-case 文件名、PascalCase 组件名约定）；用户可见文案按有效 locale 展示简体中文或英语，业务原文保留原语言。
- **不强加未配置的工具**：当前项目未配置 Prettier 或额外格式化工具，改动时保持与目标文件一致的缩进、引号与换行风格，不进行无意义的格式刷屏或代码压缩。
