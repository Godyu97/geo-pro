# Issue #135 本地观察

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M2-06 / AC-M2-06-1](../specs/M2.md#s-m2-06) · [问题入口](M0-135-question-entry.md)

品牌负责人从品牌资料的「登记本地观察」进入 `/dashboard/brands/local-observations` 后，先看到当前状态下的下一步。没有活跃品牌时，页首动作是去建档。已有活跃品牌但还没有观察时，动作是填写目标城市，实际采样位置可以留空。已有观察时，动作是查看目标城市和实际采样位置。采样位置留空时显示未知，并保持未排名。读取失败时保留标题，隐藏品牌名称和城市，并用键盘重新载入。

## 范围

- 页首按无品牌、空观察和已有观察给出一个主要动作，并保留相关入口。
- 目标城市和实际采样位置仍分开保存。留空的采样位置保存为空，页面显示未知，不写成排名。列表查询仍是一条观察查询。
- 路由补了加载骨架。读取失败使用原生重新载入链接，并显示追踪编号。

## 验收

隔离浏览器使用合成品牌。名称没有空格。临时账号已清理。

| 场景 | 实际结果 |
| --- | --- |
| 无品牌 | `zh-CN` 与 `en` 在 375、768、1440 像素只有一个 `main`。顶栏分区是品牌资料或 `Brand information`。页首可见任务说明，「去建档」或 `Open brands` 在 375 像素位于视口内，页面没有品牌名称，也没有目标城市输入，且无横向溢出。中文 375 像素从品牌资料用键盘进入该入口，再从「去建档」回到品牌资料。 |
| 已有品牌、尚无观察 | 两种语言和三种宽度都显示长品牌名称和空观察说明。375 像素「填写观察」或 `Enter an observation` 位于视口内，键盘激活后焦点落在目标城市。页面无横向溢出。中文 375 像素从品牌资料用键盘再次进入。 |
| 无效城市 | 中文 375 像素把目标城市留成空白字符。页面显示请检查品牌和城市，已输入内容保留，没有发出保存请求。 |
| 已有观察 | 两种语言和三种宽度都显示长目标城市、实际采样位置未知和未排名。375 像素「查看观察」或 `View observations` 位于视口内，键盘激活后焦点落在观察列表。页面无横向溢出，也没有「杭州用户真实排名」或 `Hangzhou users' real ranking`。 |
| 慢速保存 | 中文 375 像素保存目标城市「杭州」、采样位置留空。按钮显示「正在保存…」且 `aria-disabled="true"`，第二次 Enter 不再发出请求。保存后中英文都显示目标城市杭州、实际采样位置未知和未排名。数据库两条观察的采样位置都是空，`ranked` 与 `claimed_local_users` 都是 0。 |
| 其他账号 | 英文 375 像素打开同一入口，看到自己的无品牌说明，看不到原品牌名称、长城市或杭州。 |
| 读取失败 | 中英文 375 像素先看到加载骨架，再看到安全错误和「重新载入」。失败页不显示品牌名称、城市和内部异常。清除故障后用键盘重新载入，恢复同一品牌、杭州和长城市。 |

10 张 375 像素截图保存在本地 `.cache/issue-135/local-observations/`，可由 `tests/e2e/local-observations.spec.ts` 重新生成。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。构建包含 `/dashboard/brands/local-observations`。本次 lint 没有打印告警。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过。3436 个消息键，7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，31 项。 |
| `node --conditions=react-server --test tests/local-presence/observations.test.mjs` | 通过。4 项，零跳过。SQLite3 与 PostgreSQL 都确认未知采样位置保持未排名，且另一用户读不到。观察列表仍是 1 条 `local_observation` 查询。 |
| `GEO_LOCAL_OBSERVATION_SCREENSHOTS=.cache/issue-135/local-observations pnpm exec playwright test tests/e2e/local-observations.spec.ts` | 通过。配置开发 PostgreSQL、fixture 服务与本机 Chrome，1 项，9.6s。临时账号已清理，用户和观察回读为 0。 |
| `pnpm env:check` | 通过，15 项。 |
| `pnpm check:feature-map` | 通过。69 个页面、438 个代码路径、6 个地图文件。 |
| `python3 docs/tools/validate_docs.py` | 通过。174 个活跃文档、959 个本地链接、26 项需求、29 项任务、81 个验收 ID。 |

## 剩余

Issue #135 仍保持开放及 `status:in-progress`。下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/brands/stores`、`/dashboard/content/media-reviews`）完成 `ui-visual-v1` 对齐、加载骨架、读取故障恢复与三视口走查后复核关单条件。正式本地观察试点仍按 T-M2-06 的阶段前置核验。
