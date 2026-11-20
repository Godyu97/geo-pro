## 1. Schema 与规则

- [x] 1.1 新增 publication / check / action 双方言 Schema，生成迁移与全量 DDL；purge 清理新表
- [x] 1.2 实现隔离页与人工证据纯函数（覆盖 AC-M0-11-1/2/3 输入输出）

## 2. DAO、命令与 API

- [x] 2.1 实现 Publication DAO 批量读写（归属过滤、核验历史、维护待办）
- [x] 2.2 实现 submit/verify/manual/removed 命令与同站 Origin API

## 3. UI、导航与验收

- [x] 3.1 稿件页回填表单与发布详情页；zh-CN/en
- [x] 3.2 `pnpm test:content` 覆盖 AC-M0-11-1/2/3、越权与 effective_at 不变；通过 lint/typecheck/check:i18n/build；交付文档并归档 OpenSpec
