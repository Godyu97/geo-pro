# Issue #21 会话交付：正式开放条件与通道状态

[Issue #21](https://github.com/Godyu97/geo-pro/issues/21)

## 本次范围

- 关闭状态下的品牌页列出五项服务端正式开放条件。缺任一项时 `readPilotAdmission` 保持 `realIntakeOpen = false`。`GEO_AUTH_MAIL_MOCK=true` 不能记为真实投递，但开发周期默认 mock 不视为 Issue 推进阻塞（见 `AGENTS.md`）。
- 工作台展示已有通道台账的可用或不可用状态。正式运行仍只接受未过期的 verified 通道。
- 隔离验收继续只走回环 `GEO_BRANDS_FIXTURE=1`。本页不因条件记录自动开放真实写入。

## 未验证

生产侧的真实发信投递、账户恢复演练、保留披露、备份恢复演练和获准试点环境未取得。`AC-M0-01` 的真实验收项保持未勾选；本地 mock 与 LLM 测试通道仅用于软件联调。
