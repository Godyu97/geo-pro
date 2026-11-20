# T-M1-02 竞品与来源（分步交付）

任务保持未勾选。这里只记已经推到 `main` 的小功能，不写完成比例，也不补监测样本。

| 模块 | 做了什么 | commit |
| --- | --- | --- |
| 竞品份额 | 固定竞品集按版本保存。同一回答里每个品牌只计一次，分母可见；换版不并入旧提及。无序输出不产生名次，缺席不进入条件平均位置。清除品牌时一并删除这些行，本人导出包含这两张表。 | `621ea3e5b0907328fc534cf2e7fb53577e91ee2d` |

## 这一步的检查

`pnpm test:competitors`、`pnpm exec eslint`（改动文件）、`pnpm typecheck`、`pnpm db:ddl:check`、`python3 docs/tools/validate_docs.py` 退出码为 0。SQLite 与本机 PostgreSQL 隔离库都跑了份额用例。Node 是 v22.23.4，不是仓库要求的 Node 24。没有跑 `pnpm build`，没有浏览器。这些通过不表示 T-M1-02 已验收。

## 这一步还没有

来源支持性、研究 Brief、双语页面。真实引用页没有去抓。
