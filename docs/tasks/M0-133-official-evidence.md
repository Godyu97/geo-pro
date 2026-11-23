# Issue #133 官方回答入证与概览下钻

2026-11-23。 [Issue #133](https://github.com/Godyu97/geo-pro/issues/133) · [品牌管理与监测计划](brand-monitoring-next.md) · [S-M0-06 / S-M0-07](../specs/M0.md#s-m0-06)

## 交付范围

- 品牌负责人从已采纳的官方槽位保存一份原文。官方路径的引用、引用完整性和实际联网触发来自尝试回执；回执无法解析时记为缺失引用和未知联网。请求联网仍用运行上的请求值。目标地区用运行地区，实际地区、新会话和产品模式记为未知。调用方附带的引用和条件不写入官方证据。
- 同一非草稿槽位再次入证回读既有证据。并发唯一冲突也回读，不另建原文。错误品牌和未采纳槽位拒绝。复核只追加分析版本。
- 运行详情、回答列表和证据详情指向同一条原文。官网未登记时概览的官网引用为不适用。带 `[FUNCTIONAL-MOCK]` 的演示正文、非自然题和探索题不进入自然分母。费用不是已知或无供应商费用时显示待核对。消费者手工存证仍走独立轨道。
- `answer_observation.network_trigger` 取值 `triggered`、`not_triggered`、`unknown`，已有行回填 `unknown`。SQLite 按全量 DDL 重建观测表及仍引用它的子表，避免改名后的外键文本和表结构分叉。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs:46`。`pnpm typecheck`、`pnpm build` 通过。 |
| 双语 | `pnpm check:i18n` 通过，2762 个键。 |
| 结构 | `pnpm db:ddl:check` 双方言通过。`pnpm db:migrate` 已在回环开发 PostgreSQL 应用 `network_trigger`。 |
| 隔离行为 | `pnpm test:evidence` 19 项通过，`pnpm test:monitoring` 20 项通过，均覆盖 SQLite 与 PostgreSQL。官方入证覆盖完整空引用、缺失、不支持、调用方引用被忽略、重放、并发唯一回读、错误品牌、未采纳槽位、分析修订、探索题、非自然题、演示标记和消费者轨道。 |

## 开发库入证

2026-11-23。品牌 `ef806b38-0b74-4420-aebd-701176444112`，实体版本 2，未登记官网。运行 `db6cb290-ccec-4c6c-b63b-7fa3fab1d287` 的 3 个已采纳官方槽位请求联网 `off`，费用状态 `known`，每槽 `actual_minor` 为 1（CNY），不是 0。

用品牌负责人的临时会话打开运行详情，页面有 3 个「保存为证据」。按该按钮的 `POST /api/monitoring/answers` 入证，并附带调用方引用和观测条件。再次提交回读同一证据。错误品牌和随机槽位返回 404。临时会话已删除。

| 原文 SHA-256 | 证据 | 引用 | 请求联网 | 实际联网 | 目标 / 实际地区 | 分析版本 |
| --- | --- | --- | --- | --- | --- | --- |
| `f0334035f6f331eb1dff86f90a01d869095711f96ae597cd3b36934ec5845be9` | `d09a3b3c-5626-4cc2-b0fd-53bcdf61f4d1` | `complete`，0 个 URL | `off` | `not_triggered` | `CN` / `unknown` | 1 |
| `75a2b6a21ab11197a8cd4400b4f44c0e0ceb2d0a47890001c0dcfdb49b7086a2` | `6f8303c7-389a-4fde-a529-cf9be6162255` | `complete`，0 个 URL | `off` | `not_triggered` | `CN` / `unknown` | 1 |
| `1db41243e9078a8be194afb37c10cce411502f765bd6af7dd74a3ac068f9fb2b` | `f548768c-a3c4-4027-a54d-572b9f15af45` | `complete`，0 个 URL | `off` | `not_triggered` | `CN` / `unknown` | 1 |

新会话和产品模式均为 `unknown`。调用方 URL 没有入库。三条证据的来源都是 `model_api` / `official_api`。该品牌官方轨道的已入证样本为 3，与这三道自然发现题一致。概览显示未登记官网，官网引用不适用。运行详情和回答列表都链接到这 3 个证据编号。中文证据页显示不要求联网、未触发、实际地区未知、费用以「已知」开头。英文页对应为 Network not requested、Not triggered、Known。

开发库没有未过期的 verified 消费者通道，本轮没有做人工存证回归。正式 10 题 × 2 轮和消费者 3 题 × 2 轮仍由 [#31](https://github.com/Godyu97/geo-pro/issues/31) 跟踪。本记录不勾选 T-M0-06 或阶段门禁。
