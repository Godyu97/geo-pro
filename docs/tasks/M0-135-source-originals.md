# Issue #135 资料原件导入

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M1-04 / AC-M1-04-1](../specs/M1.md#s-m1-04)

品牌负责人从「内容 → 资料原件」进入后，可以用键盘从页首跳到文件选择。提交期间，按钮禁用并显示正在导入。返回本批后，页首突出查看导入结果，并显示当前列表可见的已保存、部分保留和失败文件数。已有历史的只读成员可以跳到清单。长文件名和连续原文在卡片内换行。

## 验收场景

| 场景 | 实际结果 |
| --- | --- |
| 无品牌、空清单和本批结果 | `zh-CN` 和 `en` 在 375、768、1440 像素下均只有一个主内容区，主操作完整位于视口内，页面无横向滚动。键盘激活页首入口，焦点进入文件选择或本批结果标题。文件选择器原生按钮的文字随浏览器语言。 |
| 上传与混合结果 | 中文 375 像素下，按 Enter 提交后可读到进行中状态，再按 Enter 时仍只有一个 POST。同批回读分别是 `ready`、`partial` 与 `failed/encrypted`。私有对象存储有两条就绪对象记录，部分原件的下载字节与上传一致。 |
| AC-M1-04-1 与事实冲突 | 两种语言均可读到第 1 页原文、第 2 页正文缺失及冲突所指的已批准版本。合成片段在双语界面显示同一原文。数据库中仍只有原先的已批准事实版本。 |
| 读取失败与恢复 | 两种语言在 375 像素下注入慢速读取失败，先显示加载，再显示标题与重新载入。页面隐藏原件内容和内部错误。用键盘重新载入同一品牌及批次后，原结果重新显示。 |
| 权限和清理 | 未授权账号仍能辨认页面，但看不到文件及上传入口，下载返回 404。给予有效成员授权后可看原片段和历史，上传入口仍隐藏，下载仍返回 404。双库回归验证负责人冻结后成为只读。测试回读确认临时账号、品牌、原件、片段、冲突和对象元数据已清除。 |

基线浏览器用例在已成功建档后找不到页首「开始导入」，按预期失败。测试使用合成品牌、两份文本和一份加密 PDF 夹具。慢速故障在浏览器夹具的应用副本注入。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 3263 个消息键和 7 项测试通过。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 17 项通过。 |
| `node --conditions=react-server --test tests/asset-reuse/source-originals.test.mjs` | 隔离 SQLite3 和 PostgreSQL，7 项通过，零跳过。成员读取对片段及冲突各执行一次批量查询，双方言查询计划均使用现有索引。 |
| `pnpm exec playwright test tests/e2e/source-fragments.spec.ts tests/e2e/m0-flow.spec.ts` | 临时迁移 PostgreSQL、回环 S3 mock、进程内缓存和 Chrome，2 项通过。S3 mock 在两项测试完成后剩余 0 个对象。 |
| `pnpm exec playwright test tests/e2e/source-fragments.spec.ts --trace on` | 使用配置的开发 PostgreSQL、私有 S3 和 Chrome，1 项通过。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 开发预检 15 项、文档 81 个验收 ID 及 883 个本地链接检查通过。 |

本地 `.cache/issue-135/source-originals/` 有基线及走查截图。可用浏览器用例重建，例如 `empty-zh-CN-375.png`、`pending-zh-CN-375.png`、`result-en-375.png` 和 `unavailable-en-375.png`。

## 剩余

全站其他已开放入口及公共状态仍需汇总复核。可从「内容 → 模板」继续用临时账号检查双语三视口、只读系统模板、克隆和失败恢复。资料上传仍需核对 Server Action 默认请求体上限与单文件 10 MB 业务规则的端到端边界。正式 T-M1-04 验收需要阶段前置及获准真实资产。
