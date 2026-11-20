## 1. Schema 与规则

- [x] 1.1 扩展 content_version 状态与渠道/标识/图片字段；新增 approval/asset/delivery_package/export_job 双方言 Schema、迁移与全量 DDL；更新 purge 顺序
- [x] 1.2 实现批准指纹、硬门禁预检、HTML 净化、包文件组装与批量子集校验纯函数（覆盖 AC-M0-10-1/2/3）

## 2. DAO、命令与 API

- [x] 2.1 扩展 ContentDao：审批、资产、交付包、导出作业批量读写与归属过滤
- [x] 2.2 实现 submit-review / approve / reject / update-variant / register-asset / export-preflight / export-confirm；接线 withEligibleFacts(delivery)；同站 Origin API

## 3. UI、导航与验收

- [x] 3.1 稿件详情/审核/导出页与列表待审·可交付筛选；zh-CN/en
- [x] 3.2 `pnpm test:content` 覆盖 AC-M0-10-1/2/3、越权与审阅稿；通过 lint/typecheck/check:i18n/build/db:ddl:check；文档与 OpenSpec 归档
