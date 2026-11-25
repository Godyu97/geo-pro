# GeoPro 功能地图（Feature Map）

轻量级业务寻址黄页：用于定位页面路由、弹窗/交互组件、API 接口及后端 Service/DAO。

> **按需加载原则**：先根据任务所属路由域或业务领域，只读取下表对应的 **1 份**模块地图；禁止全量预读所有分表。

## 模块分表索引

| 业务域 | 覆盖路由范围 | 模块地图 | 页面数 |
| --- | --- | --- | --- |
| 公开/账号/品牌/助理 | `/`、`/login`、`/account-access`、`/dashboard`、`/dashboard/brands/*`、`/dashboard/assistant/*` | [brands-assistant.md](brands-assistant.md) | 19 |
| 监测与优化 | `/dashboard/monitoring/*`、`/dashboard/optimization/*` | [monitoring-optimization.md](monitoring-optimization.md) | 14 |
| 内容生产与素材 | `/dashboard/content/*` | [content.md](content.md) | 12 |
| 复测报告与商业交付 | `/dashboard/reports/*`、`/dashboard/commercial/*` | [reports-commercial.md](reports-commercial.md) | 12 |
| 系统设置与平台维护 | `/dashboard/settings/*`、`/dashboard/maintenance/*` | [settings-maintenance.md](settings-maintenance.md) | 12 |

## 维护与防腐烂校验

- **同步规则**：新增或删除 `src/app/**/page.tsx`、调整 `src/features/<domain>/` 目录、或增删重要 `Dialog`/`Sheet`/API 时，顺手更新对应分表中的 1 行。
- **自动校验**：执行 `pnpm check:feature-map`（校验 100% 页面覆盖、无重复/幽灵路由、所有 `src/...` 路径真实存在且单文件 <= 120 行）。
