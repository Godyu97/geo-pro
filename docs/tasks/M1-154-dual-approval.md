# Issue #154 双人审核执行

2026-11-25。 [Issue #154](https://github.com/Godyu97/geo-pro/issues/154) · [S-M1-08](../specs/M1.md#s-m1-08) · [S-M0-11](../specs/M0.md#s-m0-11)

品牌开启 `dualControl` 之后，稿件批准、事实确认和发布人工核验都走同一条职责校验。提交人不能批准自己的稿件、自己录入的事实，也不能核验自己提交的发布。另一名具备 `contentApprover` 或 `factApprover` 职责的成员可以完成对应动作，批准或核验记录写审核人。拒绝写入 `approval_attempt`，只保存操作者、目标编号和 `separation` 或 `duty`。未开启双人审核时，负责人仍可单人完成这些动作。开启前后已有的单人批准和核验记录不改写。本记录不勾选 T-M1-08，也不覆盖授权撤销和跨品牌隔离。

## 入口

- 稿件详情 `/dashboard/content/versions/[versionId]` 批准失败后回到同一页，并用当前界面语言显示 `SEPARATION` 或 `DUTY`。
- 事实与材料 `/dashboard/brands/[id]/facts` 在确认失败时显示 `separation` 或 `duty`。
- 发布详情 `/dashboard/content/publications/[publicationId]` 在人工核验失败时显示 `SEPARATION` 或 `DUTY`。
- 内容 API 与事实 API 使用同一校验。具备对应职责的成员可以打开上述页面并完成审核。

## 验证

隔离库覆盖 SQLite 与 PostgreSQL。稿件作者自批返回 `SEPARATION` 且不产生新批准；事实提交人自批返回 `separation` 且事实正文和历史批准不变；发布人提交 `verified_manual` 被拒绝且发布状态保持 `access_limited`。对应职责的成员可以批准或核验，记录中的操作者是该成员。关闭双人审核后，负责人可以再次单人批准。

`pnpm test:content` 仍有 2 项既有失败：`tests/content/channel-profiles.test.mjs` 把基线定在倒数第二个迁移，并期望此时还不存在 `channel_profile`。该表由更早的迁移创建，断言发生在审批代码之前。本轮没有改这条迁移测试。
