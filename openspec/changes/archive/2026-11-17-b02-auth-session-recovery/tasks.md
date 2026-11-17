# Tasks

## 1. 服务端入口

- [x] 1.1 统一请求内会话状态、登录分流及原因/返回地址，补充恶意输入单元测试；通过 pnpm test:i18n 与 pnpm typecheck 验证。

## 2. 会话恢复与界面

- [x] 2.1 补齐会话监测、故障重试、整页身份切换及双语言提示，增加恢复/退出失败/无凭据存储的 Chrome 场景和隔离故障探针；通过 pnpm check:i18n 与 pnpm test:e2e 验证两种语言和三种宽度。

## 3. 认证权限验收

- [x] 3.1 扩展本地认证脚本验证伪造、过期、撤销会话的直接读写拒绝和本人隔离，并确保临时账号清理；运行本地 PostgreSQL pnpm verify:auth。

## 4. 综合验证与交付

- [x] 4.1 执行 pnpm lint、pnpm typecheck、pnpm build 和 OpenSpec strict 验证，审查仅包含 #2 的改动与安全边界。
- [x] 4.2 写入 docs/tasks/B02-auth-session.md，记录实际结果和 B04/邮件/双后端未覆盖范围，更新 T-M0-01 子项记录及适用工程事实；通过 python docs/tools/validate_docs.py。

## Workflow follow-up

- 完成全部验证后同步主规格并归档，核验归档内容。
- 仅提交当前 Issue 相关文件，在当前 main 分支 Commit 和 Push；确认成功后标 Done、评论 Commit SHA 与验证结果并关闭 #2。
- 若最终验证或 Push 无法完成，保留成果、在 #2 记录阻塞，不关闭 Issue。
