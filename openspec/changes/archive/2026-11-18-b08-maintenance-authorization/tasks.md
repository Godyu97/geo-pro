# Tasks

## 1. 双数据库与迁移

- [x] 1.1 增加显式后端配置、Node SQLite/PG 连接和官方 Auth provider/Schema 生成链；用原生测试核对 SQLite 外键和真实认证，保留缺配置的构建能力。
- [x] 1.2 添加授权/审计双方言 Schema，执行 pnpm db:generate、审核 SQL、pnpm db:ddl / pnpm db:ddl:check；在隔离空库验证 migration/DDL 一致与 PG 原认证数据升级，更新数据库使用说明。

## 2. 维护领域与受控操作

- [x] 2.1 实现三项独立授权、事务守卫、最小审计、失败拒绝和受控 CLI；用 pnpm test:maintenance 在双后端覆盖普通/维护/撤销身份、幂等、并发、回滚、审计失败及查询计划/次数，记录运维边界。

## 3. 页面与接口

- [x] 3.1 增加会话独立鉴权的本人权限 API、Server Component、导航及双语言消息/返回白名单；用直接 HTTP 检查拒绝/隔离/撤销和 pnpm check:i18n / pnpm test:i18n，浏览器验证双语言三种宽度、语言切换、键盘及故障。

## 4. 集成与交付核验

- [x] 4.1 实际执行 pnpm lint、pnpm typecheck、pnpm build、pnpm verify:auth、pnpm test:e2e 和双方言专项验证；同步 docs/tasks/B08-maintenance-access.md、项目事实及适用规范，运行 python docs/tools/validate_docs.py 和 OpenSpec strict 验证，逐项自审 Issue 验收与未验证范围。

## Workflow follow-up

- 验证完成后按用户授权同步主规格并归档，核对归档结果。
- 只提交当前 Issue 文件，在当前 main 分支 Conventional Commit 关联 #8，Push 成功并核对远端 SHA 后更新 Done 和关闭 Issue。
- 发生无法修复的开发/验证/Push 失败时保留成果，在 Issue 记录阻塞，保持打开并结束本轮。
