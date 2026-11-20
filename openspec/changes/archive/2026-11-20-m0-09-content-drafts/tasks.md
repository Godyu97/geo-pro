## 1. Schema 与规则

- [x] 1.1 新增 content plan/brief/batch/unit/version 双方言 Schema，注册 drizzle 配置并生成迁移与全量 DDL；purge 清理新表
- [x] 1.2 实现 Brief gaps、模板结构、批次状态机与隔离填充纯函数（覆盖 AC-M0-09-1/2/3 输入输出）

## 2. DAO、命令与 API

- [x] 2.1 实现 ContentDao 批量读写（归属过滤、版本、批次单元与 attempt）
- [x] 2.2 实现 ConfirmBrief / GenerateBatch / Pause|Resume|Cancel|RetryFailed；接线 withEligibleFacts 与 generation 额度；同站 Origin API

## 3. UI、导航与验收

- [x] 3.1 工作台内容计划/Brief/批次页与 zh-CN/en；模块导航入口
- [x] 3.2 `pnpm test:content` 覆盖 AC-M0-09-1/2/3、越权与幂等；通过 lint/typecheck/check:i18n/build；交付文档并归档 OpenSpec
