# Issue #135 内容模板

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M1-04 / AC-M1-04-3](../specs/M1.md#s-m1-04)

品牌负责人从「内容 → 内容模板」进入后，可用键盘从页首跳到可用模板列表。模板卡片标出来源、只读状态、生命周期和三项门禁。克隆期间显示进度，门禁拒绝时在原表单提示并保留输入。读取失败时可重新载入同一品牌。

## 范围与复现

- 基线 `9b1783d068d3a9bf76dedf8a01cf67b6252c2ff8` 在中文 375 像素下有模板卡片，缺少可聚焦的页首「浏览模板」入口。
- 浏览器用例使用临时账号与合成品牌。配置开发 PostgreSQL 的模板表为空。用例只在临时迁移的 PostgreSQL 中登记系统模板夹具，在开发库走查应用的空清单、权限和读取恢复。
- 浏览器由 `scripts/serve-i18n-fixture.mjs` 启动应用副本，使用 Cookie 注入慢速读取故障。隔离走查用 `tests/maintenance/helpers.mjs` 的 `testDatabase("postgresql")` 生成和清理临时数据库，显式传入 `DATABASE_URL`、`GEO_DUAL_DB_URL`、`GEO_CACHE_DRIVER=memory` 和 `GEO_TEMPLATE_TEST_SYSTEM=1`。设置 `GEO_TEMPLATE_SCREENSHOTS` 可重建截图。

## 验收场景

| 场景 | 隔离浏览器实际结果 |
| --- | --- |
| 无品牌、空清单及有系统模板 | 中英文在 375、768、1440 像素均无横向溢出。主要入口置于页首，已有模板时可用键盘将焦点移至列表标题。长模板名在卡片内换行。 |
| 门禁拒绝及重新提交 | 关闭事实门禁后新增模板数为零。切换语言后，原名称和门禁选项保留，提示随语言变化。恢复门禁并提交时重复按 Enter，观察到一个 POST。API 和 SQL 回读一条团队草稿、系统来源及三项开启的门禁。 |
| AC-M1-04-3 的导出检查 | 要求编造案例的团队模板被事实门禁拦截，另一模板被审批门禁拦截。交付包数为零。尝试修改系统模板返回 409 `SYSTEM_READONLY`，系统源行逐字段一致。 |
| 读取失败恢复与权限 | 中英文在 375 像素先显示加载，再显示安全错误及重新载入。键盘重载保持品牌并恢复草稿列表。异账号看不到模板，列表和克隆请求均返回 404。回读确认临时账号、品牌及模板夹具均已清理。 |

第一次浏览器回归出现卡片定位错误。修正定位后，测得 React 表单自动重置会重新勾选已被拒绝的门禁。克隆表单改用项目现有的手动 action 提交模式后，双语状态保留和重提场景通过。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 3269 个消息键和 7 项测试通过。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 17 项通过。 |
| `node --conditions=react-server --test tests/asset-reuse/content-templates.test.mjs` | 双语与隔离 SQLite3、PostgreSQL 共 3 项通过，零跳过。 |
| `pnpm exec playwright test tests/e2e/content-templates.spec.ts tests/e2e/m0-flow.spec.ts` | 临时迁移 PostgreSQL、进程内缓存与 Chrome，2 项通过。 |
| `pnpm exec playwright test tests/e2e/content-templates.spec.ts` | 配置的开发 PostgreSQL 与 Chrome，1 项通过。核对双语三视口空清单、越权拒绝及读取恢复，临时账号和品牌已回读确认清理。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 环境预检 15 项，文档 81 个验收 ID 和 886 个本地链接检查通过。 |

截图保存在本地 `.cache/issue-135/content-templates/`。基线 `baseline/missing-browse-zh-CN-375.png` 可与 `isolated/ready-en-375.png`、`isolated/gate-denied-zh-CN-375.png` 和 `isolated/unavailable-en-375.png` 对照。

## 剩余

开发库需要正式系统模板目录及适用场景、输入与输出预览，才能用获准内容资产走查完整 T-M1-04。此次验收涉及 AC-M1-04-3 的导出与克隆门禁，生成路径继续由对应业务任务验证。重复提交测试覆盖同一表单请求在途期间。#135 下一步对照现有 App Router 页面与历史证据清单，补齐仍缺的页面和公共状态，再复核关单条件。
