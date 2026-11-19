# Design

## Context

B08 已提供 `capabilities.manage` 与 `runMaintenanceAction`。品牌归属来自 B04。监测运行、采样执行和真实外部通道核验尚未开放。见 proposal.md 的动机与 Out-of-Scope。

## Goals / Non-Goals

- Goals：双库能力台账、维护写入、用户范围展示、正式运行门禁、联网证据口径、官网公开投影。
- Non-Goals：真实供应商调用、自动消费者采集、密钥保管、完整监测计划生命周期、缓存。

## Decisions

1. **领域放在 `src/features/capabilities/`**  
   通道台账是平台级能力，不是品牌监测运行。`monitoring` 仅提供运行确认薄页与门禁 API，避免把 T-M0-05 执行语义提前写入监测域。  
   备选：全部放进 `monitoring/`。拒绝，以免与未授权的运行任务混叠。

2. **两张身份/版本表 + 一张联网证据表**  
   - `capability_channel`：稳定 ID、`vendor_id`、kind。同厂商两轨因 kind 不同而 ID 不同。  
   - `capability_version`：不可变快照（状态、公开字段、SOP、验证/到期、操作键、指纹）。当前值读取最高版本。  
   - `sampling_answer_network`：只存联网口径与通道版本引用，不存回答正文。禁用通道不级联删除版本或证据。  
   不把密钥、内部端点或客户正文入库。`public_visible` 仅对未过期 verified 生效。

3. **维护写入复用 B08 事务护栏**  
   `POST /api/maintenance/capabilities` 校验会话、同源 Origin、Zod 输入与 `actorId === session`。`runMaintenanceAction(..., "capability.write")` 在同一事务内核验权限、追加版本、写审计。普通用户接口只读范围或提交运行确认，不能改验证。

4. **正式运行只做门禁，不创建运行**  
   `POST /api/monitoring/runs` 在未验证/过期/禁用时拒绝并说明原因。全部合格时返回 `eligible: true` 且明确运行执行未开放，绝不返回模拟成功或伪造结果。演示空间可查看 candidate，但不能当作正式运行。

5. **查询一次列出通道最新版本**  
   用户范围、维护列表、公开投影和运行确认共用「每通道最新版本」批量查询，按 `vendor_id`、kind、id 稳定排序。PostgreSQL 对 `capability_channel` 行锁串行化同通道写入；SQLite 使用既有立即事务。不引入缓存。

6. **联网合格分母是派生布尔**  
   保存时若 `requested_network_mode = on` 且 `trigger_evidence = none`，则 `actual_network = unknown` 且 `qualifies_required_search = 0`。即使通道 `search_required` 为真也不进入合格分母。

## Risks / Trade-offs

- [无真实通道凭证] → 软件合同可测；交付记录标明外部受阻，不勾选 T-M0-04，官网无公开 verified 记录时保持「未开放」。
- [运行 API 被误认为已可采样] → 合格时仍返回执行未开放，不写运行行、不扣额度。
- [SOP 可能含内部流程] → 维护页可见 SOP；用户/官网投影不含 SOP、密钥和端点。

## Migration Plan

双方言独立 `pnpm db:generate`，审核 SQL 后 `pnpm db:ddl` / `pnpm db:ddl:check`。测试从品牌事实基线 `0008_flimsy_bullseye` / `0007_last_synch` 升级，对照全量 DDL。回滚即停止使用新接口；表仅追加，不改既有认证/品牌/额度数据。

## Open Questions

无。真实通道启用与人工 SOP 内容由后续 T-M0-04 外部核验与 Issue #31 负责。
