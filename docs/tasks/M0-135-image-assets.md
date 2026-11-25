# Issue #135 图片素材视觉与权利操作

本轮覆盖 `/dashboard/content/assets`，对应 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) 的 [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks)，以及 [S-M1-04](../specs/M1.md#s-m1-04) 的 AC-M1-04-2 站内素材撤销路径。品牌负责人从「内容 → 图片素材」进入，在登记时可由页首聚焦文件名，处理权利时可从页首跳到已有素材。撤销后可在同一张卡片核对原引用和待办。

## 实现

- 页首沿用工作台内容分区和共享按钮。表单用共享卡片和输入框，已有记录用带标题的列表。无品牌时提供品牌资料入口，品牌无法访问时保留页面标题并提供返回内容入口，读取失败时可重新载入原品牌。
- 撤销和标记到期复用共享弹窗及既有服务端表单操作。弹窗显示完整文件名与对应影响，初始焦点在取消。保留数据权限、原版本、引用、账本及维护待办口径。
- 基线 `b8084e17782bc4aff3bd5be316dba5743ee0889c` 的隔离 Chrome 在 375 像素复现两个问题。指定不可访问的品牌时页面缺少一级标题。对撤销按钮按 Enter 直接写入撤销，页面没有确认弹窗。

## 实际走查

| 场景 | 观察结果 |
| --- | --- |
| 双语视口与键盘 | `zh-CN` / `en` 分别在 375、768、1440 像素核对无品牌、无记录和有记录。页首操作完整位于视口，主内容区唯一。可用键盘打开内容入口、定位文件名、定位已有列表和操作确认弹窗，长文件名换行，页面无横向溢出。 |
| 登记、取消及撤销 | 站内键盘登记第 3 版和一条内容引用。两种语言、三种宽度均检查弹窗取消焦点及 Escape 返回触发按钮。取消后记录仍为有效且无待办。确认撤销后，页面、API 和 SQL 都可核对固定第 3 版的引用及一条对应待办。重放撤销仍只有一条待办，新登记引用返回 409。原稿件状态、指纹及图片标识列表逐项一致。 |
| 到期和权限 | 键盘确认第二条素材到期，页面与数据库回读显示已到期。另一账号对原品牌看见安全提示，素材名和表单不可见，API 读取及撤销返回 404。 |
| 公共状态 | 两种语言在 375 像素核对加载文字、读取失败及键盘重新载入。失败时保留页面标题，隐藏素材及原始异常。重新载入保留品牌范围。 |

业务走查使用合成账号、品牌、素材元数据与合成稿件。测试退出时按本轮账号和品牌清理，并回读账号、品牌、稿件、素材、引用和待办均为空。

## 验证与证据

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 3252 个消息键与 7 项测试通过。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 17 项通过。 |
| `node --conditions=react-server --test tests/asset-reuse/image-assets.test.mjs` | 隔离 SQLite3、PostgreSQL 与双语输入合同共 3 项通过，零跳过。 |
| `pnpm exec playwright test tests/e2e/image-assets.spec.ts tests/e2e/m0-flow.spec.ts` | 迁移后的临时 PostgreSQL、进程内缓存和 Chrome，复跑 2 项通过。首跑 M0 主流程通过，图片素材断言因历史卡片定位范围错误失败，已修正。 |
| `pnpm exec playwright test tests/e2e/image-assets.spec.ts --trace on` | 配置的开发 PostgreSQL 和 Chrome，1 项通过。读取故障由浏览器夹具副本注入。 |
| `pnpm env:check` | 配置的开发 PostgreSQL、Redis、对象存储、Chrome 等共 15 项通过。 |
| `python3 docs/tools/validate_docs.py` | 81 个验收 ID、880 个本地链接检查通过。 |

本地 `.cache/issue-135/assets/` 保存 15 张交付截图和 2 张基线截图。基线为 `baseline-missing-heading.png` 和 `baseline-revoke-button.png`。页面与交互可由浏览器用例重建，如 `empty-zh-CN-375.png`、`confirm-en-375.png`、`confirm-en-1440.png`、`revoked-history-zh-CN.png` 和 `unavailable-en-375.png`。

## 剩余范围

Issue #135 的整站关单仍需将已开放路由与过往验收记录逐项对照，补齐未覆盖入口及公共状态。可继续核对「内容 → 资料原件」的双语布局、文件导入和失败恢复。正式 T-M1-04 验收仍需已授权的真实资产和适用的阶段前置，本轮回归范围为站内素材元数据及引用。
