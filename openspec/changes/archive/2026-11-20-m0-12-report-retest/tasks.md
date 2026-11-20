## 1. Schema 与比较规则

- [x] 1.1 新增 retest / todo / snapshot 双方言 Schema，生成迁移与全量 DDL；purge 清理新表
- [x] 1.2 实现共同题比较、闭环门禁、D+7 进度与快照渲染纯函数（覆盖 AC-M0-12-1/2/3）

## 2. DAO、命令与 API

- [x] 2.1 实现 Report DAO 批量读写（归属过滤、不可变快照、待办）
- [x] 2.2 实现 request-retest / generate-report / revise-report / download 命令与同站 Origin API

## 3. UI、导航与验收

- [x] 3.1 复测与报告页；zh-CN/en
- [x] 3.2 `pnpm test:reports` 覆盖 AC-M0-12-1/2/3、越权与快照不可变；通过 lint/typecheck/check:i18n/build；交付文档并归档 OpenSpec
