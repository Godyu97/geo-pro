# Tasks

## 1. 可信官网说明

- [x] 1.1 将官网移至 marketing 领域、补齐中英文客群/开放范围/试点限制/流程示意，建立 B03 文案依据与维护记录；用 pnpm check:i18n、pnpm lint 和 python docs/tools/validate_docs.py 核验。

## 2. 身份入口与界面验收

- [x] 2.1 复用服务端四态会话完成官网入口，补齐匿名/有效/伪造/过期身份、服务故障/未配置、SSR 隔离及双语言三宽度键盘测试；运行 pnpm test:e2e tests/e2e/marketing.spec.ts，记录真实结果和 B04 联调边界。

## 3. 集成核验

- [x] 3.1 执行 pnpm lint、pnpm typecheck、pnpm build、pnpm check:i18n、pnpm test:i18n、pnpm test:e2e、适用 pnpm verify:auth、python docs/tools/validate_docs.py 和 OpenSpec 严格检查；自审并补齐交付记录、项目事实和 T-M0-01 子项证据。

## Workflow follow-up

- 完成验收后归档并同步主规格，核验归档结果。
- 仅提交本 Issue 文件，在当前 main 分支提交及推送；成功后记录 SHA、状态、结果并关闭 Issue，不领取下一项。
