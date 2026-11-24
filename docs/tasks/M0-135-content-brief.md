# M0-135 内容 Brief

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M0-09](../specs/M0.md#s-m0-09)

品牌负责人打开内容 Brief 后，应能先看到标题、当前任务和下一步。缺受众等补证项时，下一步是补齐该项，确认前不提供生成。补证已齐时，下一步是确认。已确认后，下一步才是按事实生成待审草稿。读取失败时保留标题，不显示标题候选和主页面，并用键盘重新载入。

基线 `204fb4c33414550875f34dbe9ecdf5f4395f1c0b` 在隔离 Chrome 中文 375 像素复现。缺受众的合成 Brief 标题是「Brief 详情」，补证项显示 `audienceMissing`。首屏截图停在模板类型，看不到表单后的「保存草稿」和「生成草稿」。

- `/dashboard/content/briefs/[briefId]` 留在工作台唯一的 `main#main-content` 内。标题是第一条标题候选。任务说明和已保存状态放在同一内容区。相关入口换行，包含返回内容列表、事实与材料和资料原件。
- 有补证项时，主要动作是补齐第一项，并链到对应字段。补证列表使用界面语言，不显示缺口代码。补证已齐且尚未确认时，主要动作是确认 Brief，只出现一次。已确认后，主要动作是生成草稿。
- 主页面在内容区内换行。状态徽章仍显示已保存的 `draft` 或 `confirmed`。
- 读取失败时标题仍是 Brief 详情，提示可重试，主要动作是重新载入当前地址。不显示标题候选和主页面。其他账号打开同一地址仍是找不到页面，看不到这些内容。

## 隔离验收

Chrome 使用开发用回环 PostgreSQL、memory 缓存、回环 S3 和邮件 Mock。品牌、Brief 和事实版本编号都是合成数据。本轮没有请求供应商，也没有调用生成草稿。

| 场景 | 实际结果 |
| --- | --- |
| 缺受众 | 中文 375 像素可见「合成巡检说明」、任务说明和「补齐受众」。该链接只有一个，指向 `#brief-audience`。没有「确认 Brief」，补证项是「缺少受众」。Enter 后焦点落在受众字段。 |
| 可确认 | `zh-CN` 与 `en` 在 375、768、1440 像素无横向溢出，且只有一个 `main`。180 字路径的主页面留在内容区内。中文 375 像素用 Enter 确认后，状态为 `confirmed`，任务说明变为已确认，「生成草稿」在视口内，「确认 Brief」消失。 |
| 读取失败 | 英文 375 像素保留标题 Brief detail 和失败提示，看不到标题候选和主页面。重新载入在视口内，清除故障标记后用 Enter 回到原 Brief，状态仍是 `confirmed`。 |
| 其他账号 | 英文 375 像素显示 Page not found，看不到标题候选和主页面。 |

五张 375 像素截图使用合成数据，保存在本地 `.cache/issue-135/content-brief/`，可由 `tests/e2e/content-brief.spec.ts` 重新生成。清理后回读，邮箱前缀 `content-brief-` 的账号和名称为「合成内容品牌」的版本都是 0 行。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。lint 本次没有打印告警 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3092 个消息键、7 项测试 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，11 项 |
| `pnpm exec playwright test tests/e2e/content-brief.spec.ts` | 通过，隔离 Chrome 1 项。基线找不到标题候选；改动后再次通过 |
| `pnpm exec playwright test tests/e2e/m0-flow.spec.ts` | 通过，1 项。合成品牌仍能确认 Brief 并生成批次草稿 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过。开发预检 15 项。文档 26 项需求、29 项任务、81 个验收 ID、777 个本地链接 |

## 剩余验收

全站路由、双语视口和状态覆盖仍待继续。内容批次和稿件版本尚未按同样方式走查。正式阶段验收仍待对应试点条件。本轮不勾选 T-M0-09。
