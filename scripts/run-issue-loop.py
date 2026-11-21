#!/usr/bin/env python3
"""
GeoPro 自主 Issue 串行开发编排脚本（v2 状态机版）。

设计目标：稳定、持续、无死循环地推进足够数量的可验证软件需求开发。

核心改进：
1. 外层状态机管理队列：直接通过 `gh issue list` 过滤 `status:awaiting-pilot` / `status:blocked` / 本轮跳过表，
   精确计算「可开发水位」；当可开发 Issue 数量低于 `--min-backlog` 时自动切入补货模式（默认每批 12 单，
   最多补货 `--max-replenishes` 批），避免因遗留真人试点单占据 Open 队列而永远不补货或连续空转。
2. 客观进度核验：每轮前后比对 `git HEAD`、GitHub Open Issue 集合与 `loop-round:` 结构化结果；
   未产生提交或被标为 `awaiting-pilot`/`blocked` 的 Issue 立即加入本轮跳过表，下一轮自动切换目标或补货。
3. 失败隔离与自愈：单轮超时/CLI 抖动清理整个进程组并可选隔离脏工作区（`--quarantine-dirty`），
   允许最多 `--max-consecutive-failures`（默认 3）次连续失败而不是一错即停。
4. 开发环境预检与 Node 24 自动注入：启动前运行轻量预检（或 `--check-env` / `--dry-run`），
   确保子进程使用 Node 24、PostgreSQL/Redis/AI Responses API/邮件长期 Mock 状态清晰透传。
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

MAX_ROUNDS = 20
DEFAULT_MODEL = "grok-4.7-high"
DEFAULT_ROUND_TIMEOUT = 1800
DEFAULT_MIN_BACKLOG = 1
DEFAULT_REPLENISH_COUNT = 12
DEFAULT_MAX_REPLENISHES = 3
DEFAULT_MAX_CONSECUTIVE_FAILURES = 3
DEFAULT_MAX_CONSECUTIVE_NOOP = 2
DEFAULT_MAX_SAME_ISSUE_ROUNDS = 3

NON_ACTIONABLE_LABELS = {
    "status:awaiting-pilot",
    "status:external-gate",
    "status:blocked",
    "needs:decision",
}

PRIORITY_ORDER = {"priority:P0": 0, "priority:P1": 1, "priority:P2": 2}
MILESTONE_ORDER = {"milestone:M0": 0, "milestone:M1": 1, "milestone:M2": 2}


DEV_PROMPT_BODY = """# GEO Agent Issue 自主开发工作流（v2）

你是 GeoPro 仓库的全自主 Coding Agent，由 `scripts/run-issue-loop.py` 外层状态机调度。
先读根目录 `AGENTS.md`，再按路由按需打开 `.agents/` 与 `docs/`，不要全量预读。

## 0. 硬性工作边界（不可违背）

1. **禁止提问或等待确认**：遇到非阻塞不确定性，查仓库后做最小一致决策，把假设写进 Issue 评论。
2. **一轮只推进一个 Issue 的一个可验证软件增量**：完成门禁验证、commit、push、评论后立刻结束进程。
3. **开发条件已就绪，禁止伪阻塞**：
   - **邮件相关功能长期 Mock 永远成功，暂不接入**：`.env.local` 已配置 `GEO_AUTH_MAIL_MOCK=true` 与 `GEO_AUTH_EMAIL_VERIFIED_MOCK=true`，**严禁**以「缺邮件网关 / 缺真实发信 / 缺邮箱验证」作为阻塞理由；隔离安全测试在显式关闭 mock 时继续验严格路径。
   - **AI / LLM 能力已就绪**：`.env.local` 已配置可用的 OpenAI Responses API（`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` 及 `GEO_OFFICIAL_SAMPLING_*`），可直接开发 AI 相关功能；统一调用 `src/lib/ai/responses.ts`，单测用回环 mock，**严禁**泄露或硬编码任何密钥。
   - **软件开发与真人试点门禁完全解耦**：`docs/tasks/M*.md` 未勾选、`T-M0-GATE`/`T-M1-GATE`/`T-M2-GATE` 未过、缺真人走查或付费审批，**只限制勾选真实验收与生产对外开放，绝不阻塞软件层（Schema/迁移/DDL/DAO/API/双语 UI/AI 能力/测试）开发**。
   - 严禁伪造监测样本、趋势、客户评价或排名；隔离 fixture 必须显式标明。

## 1. 同步与工作区确认

1. 检查 `git status --short`；工作区须干净。
2. 执行 `git pull --rebase origin <当前分支>`，保持线性历史，禁止 merge commit 与 force push。

## 2. 确认外层锁定目标（不要重扫全部 Issue）

外层调度器已在顶部「运行时上下文」锁定了**首选目标 Issue**（及备选列表与排除列表）：

1. 直接 `gh issue view <目标号> --comments` 查看正文、评论与既有提交。
2. **仅当**该 Issue 满足以下任一条件时，才判定「无剩余软件增量」：
   - 仓库代码与历史提交已经完整交付了该 Issue 的所有软件范围，仅剩真人现场走查、真实客户数据或外部商业签核 → 移除 `status:ready` / `status:in-progress`，加上 `status:awaiting-pilot` 标签（如不存在先跳过加标签并在评论写明），发表 `loop-round`（`result: awaiting-pilot`）后立即干净退出，**不要写无意义改动**。
   - 存在真正无法绕过的软件前置缺失或文档硬冲突 → 标 `status:blocked` 并写明具体代码解除条件，发表 `loop-round`（`result: blocked`）后退出。
3. 若该 Issue 仍有明确可写可测的软件增量（Schema/迁移/DAO/API/双语页面/AI 接入/缓存/测试），立即执行：
   - 标记 `status:in-progress`（移除 `status:ready`）。
   - 若评论显示已有部分提交，从 `remaining` 继续，绝不重复已推送工作。

## 3. 调研与最小垂直实现

1. 按 `AGENTS.md` 路由读取直接相关的 `docs/specs/`、`docs/tasks/`、`src/features/<domain>/` 与测试。
2. 遵循现有架构：
   - `src/app/` 保持薄层，业务逻辑放在 `src/features/<domain>/`；
   - 双数据库（PostgreSQL + SQLite）同步迁移并用 `pnpm db:ddl` + `pnpm db:ddl:check` 保持全量 DDL 一致；
   - 优先批量查询防 N+1，读缓存遵循 `docs/architecture/data-access.md`；
   - 页面与表单严格双语（`zh-CN` / `en`），跑 `pnpm check:i18n`；
   - AI 能力统一走 `src/lib/ai/responses.ts`（OpenAI Responses API），单元测试走本地 loopback HTTP mock。
3. 聚焦本轮单条可验证闭环，不顺带修改无关 Issue，不创建无用空壳页面。

## 4. 质量门禁（通过后才允许提交）

按 `.agents/governance/quality-gates.md` 运行所有适用检查并修到全部通过：
- 必跑：`pnpm lint`、`pnpm typecheck`、本域对应测试（及新增测试）。
- 涉及页面/路由/配置改动：`pnpm build`。
- 涉及多语言消息：`pnpm check:i18n`、`pnpm test:i18n`。
- 涉及 Schema/迁移：`pnpm db:ddl` + `pnpm db:ddl:check` + 双库测试。
- 涉及 `docs/` 文档：`python3 docs/tools/validate_docs.py`。
- 禁止关规则、降级 strict 或改无关代码换通过。未通过门禁禁止 commit/push/关单。

## 5. 提交、推送与交接评论

1. 核对 `git diff` 仅包含本轮增量，严禁包含 `.env.local` 或任何密钥。
2. Conventional Commits 简体中文主题并带 Issue 号，例如：`feat(alerts): 落地质量告警双库 DAO 与站内通知页 (#74)`。
3. 当前分支单 commit，推送前 `git pull --rebase origin <当前分支>`；若 rebase 变更影响代码先重跑核心门禁再 `git push`。
4. 推送成功后立刻对本 Issue 发表评论（并在结束时在回复末尾原样输出该块，供外层状态机解析）：

```text
loop-round:
issue: #<N>
result: progressed | done | awaiting-pilot | blocked
commit: <7-40位sha 或 none>
verified: <实际通过的命令列表>
remaining: <剩余软件增量，无则写无>
unblock: <仅 blocked/awaiting-pilot 时写明原因>
```

- `done`：该 Issue 的**全部软件验收**均已验证落地 → 移除 `status:in-progress`/`status:ready`，加 `status:done` 并用 `gh issue close <N>` 关闭（真实验收勾选留给真人试点，不影响关闭软件开发 Issue）。
- `progressed`：本轮已推送验证增量，但本 Issue 仍有后续软件验收未做完 → 保持 `status:in-progress` 与 Open，写清 `remaining` 供下一轮续作。
- `awaiting-pilot`：软件增量已全部在 `main`，仅余真人试点/外部签核 → 标 `status:awaiting-pilot` 保持 Open，外层自动跳过不再选中。
- `blocked`：确有软件前置缺失或文档硬冲突 → 标 `status:blocked` 并写清代码级解除条件。

结束前用简体中文简短总结：模式、Issue、本轮增量、验证命令、commit/push 及上述 `loop-round:` 块。
现在立即开始执行。"""


BACKLOG_REPLENISH_PROMPT_BODY = """# GEO Agent 增量需求补货工作流（v2，与开发模式互斥）

你是 GeoPro 仓库的规划型 Coding Agent。本轮**不修改 `src/` 业务代码**，唯一目标是扫描当前仓库代码与产品规格之间的真实软件缺口，创建一批**单轮可独立编码并自动化验证**的高质量 GitHub Issue，供外层循环下一轮立刻进入开发。

## 0. 硬性边界

1. **禁止提问**；先读 `AGENTS.md`，再按需读 `docs/` 与 `src/features/`。
2. **禁止创建「纯真人试点/外部签核/真实发信验收」类无法编码的空壳 Issue**！每个新 Issue 都必须有明确可在 1–2 轮内完成的软件交付物（Schema/双库 DAO/API/双语页面/AI Responses API 能力/缓存/自动化测试）。
3. **长期约定**：
   - 邮件相关功能长期 Mock 永远成功、暂不接入，不拆邮件网关任务；
   - OpenAI Responses API（`src/lib/ai/responses.ts`）已配置可用，鼓励规划真实 AI 能力接入任务（单测用 loopback mock）；
   - `T-M0-GATE`/`T-M1-GATE`/`T-M2-GATE` 未勾选不阻塞 M0/M1/M2 软件开发规划。
4. 目标数量：按顶部「运行时上下文」指定的 `target_replenish_count` 创建新的 `status:ready` Open Issue（去重计数）。

## 1. 证据扫描（快速聚焦）

1. 读取 `docs/tasks/delivery-progress.md`、`docs/product-map.json`、`docs/tasks/continued-operations-rules.md`。
2. 浏览 `src/features/` 与 `src/app/` 现有目录，识别「仅有 rules 纯函数、缺少双库表/DAO/API/双语 UI/E2E」的模块以及「尚未接入 `src/lib/ai/responses.ts` 的 AI 能力」。
3. 运行 `gh issue list --state all --limit 100 --json number,title,state,labels` 避免与已有 Issue 重复范围。

## 2. 纵向切片与选品优先级（由高到低）

优先把已有纯函数规则的域垂直打通为可运行、可访问、双库+双语的产品功能：

1. **AI 核心能力接入（`src/lib/ai/responses.ts`）**：
   - 问题簇 AI 辅助生成与去重建议（T-M0-03 / M1-06 增强）
   - 回答原文 AI 辅助实体识别、提及/推荐/引用解析草案（T-M0-06 增强，人工可覆写）
   - 基于证据的 AI 诊断建议与行动草案生成（T-M0-08 增强）
   - 基于已批准事实的 AI 内容草稿生成与事实边界校验（T-M0-09 增强）
   - 受控经营助理计划草案生成（T-M2-05，严格防提示词注入）
2. **M1 持续经营全栈落地（把现有 rules 纯函数升级为双库表 + 迁移 + DDL + DAO + API + 双语 UI + 测试）**：
   - 持续监测计划与预算调度（`sampling-plans`，对应 T-M1-01）
   - 数据质量异常告警与站内通知中心（`quality-alerts`，对应 T-M1-01）
   - 竞品份额与引用来源机会分析工作台（`competitor-share` / `source-opportunities`，对应 T-M1-02）
   - 品牌实体消歧与事实纠错工作台（`entity-accuracy`，对应 T-M1-03）
   - 资料批次导入、素材库与模板资产管理（`asset-reuse`，对应 T-M1-04）
   - 多渠道内容变体与维护日历（`channel-variants`，对应 T-M1-05）
   - 专业题集基线与 D+7/D+14 正式阶段复测工作台（`formal-retest`，对应 T-M1-06）
   - 业务反馈与可观察线索导入分析页（`business-feedback`，对应 T-M1-07）
   - 团队品牌成员权限与双人审核职责分离（`team-access`，对应 T-M1-08）
3. **M2 软件层基础（在 M1 关键域已有 DAO/页面后排入）**：
   - 消费者入口辅助采集存证工作台、受控外部发布/通知连接管理、代理商多品牌委托隔离、站点爬虫/业务连接器管理、本地门店与多模态事实核验。

## 3. Issue 规范与创建

每个 Issue 必须：
- 标题：`[M0|M1|M2][模块简称] <动词+具体软件交付对象>`
- Labels：使用 `gh label list` 中已有标签，必须包含 `status:ready`、`milestone:M*`、`priority:P0|P1|P2`、`type:feature|foundation` 及最匹配的 `area:*`（不要新建无关标签）。
- 正文结构：`业务背景` / `交付目标` / `软件实施范围`（3–6 条具体到表/DAO/API/双语页面/测试）/ `业务与安全规则` / `不包含（真实试点/邮件网关等明确排除）` / `软件验收标准`（全为可自动化验证项）/ `实施验证命令` / `需求依据`。
- 粒度：每单明确标注「建议 1–2 轮完成」，单轮可形成可测试提交，避免巨无霸 Issue。
- 创建间隔：每次 `gh issue create` 之间停顿约 0.5–1 秒，避免触发 GitHub 二级速率限制。

## 4. 补货索引与收束

1. 创建完目标数量的新 Issue 后，运行 `gh issue list --state open --label status:ready --limit 50` 核对计数。
2. 在 `docs/tasks/issue-backlog-YYYY-MM-DD.md` 写入或追加本次补货索引表（编号、Issue 号、里程碑、模块、依赖、建议顺序、对应 `T-M*`）。
3. 运行 `python3 docs/tools/validate_docs.py`；通过后可 commit 并 push 补货索引文档（`docs(tasks): 补充下期可执行开发队列 YYYY-MM-DD`）。
4. 在回复末尾原样输出以下 `loop-round:` 块供外层状态机解析：

```text
loop-round:
issue: none
result: backlog
commit: <sha 或 none>
verified: gh issue list; validate_docs
issues_created: <#N1, #N2, ...>
backlog_doc: docs/tasks/issue-backlog-YYYY-MM-DD.md
remaining: 无
```

现在立即开始执行。"""


@dataclass
class IssueInfo:
    number: int
    title: str
    labels: list[str]
    updated_at: str
    assignees: list[str] = field(default_factory=list)


@dataclass
class ParsedLoopRound:
    issue: int | None = None
    result: str | None = None
    commit: str | None = None
    verified: str | None = None
    remaining: str | None = None
    unblock: str | None = None
    issues_created: list[int] = field(default_factory=list)
    backlog_doc: str | None = None


@dataclass
class RoundResult:
    round_index: int
    mode: str
    target_issue: int | None
    session_id: str
    success: bool
    exit_code: int
    duration_sec: float
    before_head: str | None = None
    after_head: str | None = None
    commit_produced: bool = False
    issues_created: list[int] = field(default_factory=list)
    issues_closed: list[int] = field(default_factory=list)
    parsed_outcome: str | None = None
    error_reason: str | None = None
    result_text: str | None = None
    log_file: str | None = None


def build_runtime_env() -> dict[str, str]:
    """确保子进程优先命中 Node 24（如 fnm / cursor-agent 自带 Node 24）。"""
    env = os.environ.copy()
    try:
        proc = subprocess.run(
            ["node", "-v"], capture_output=True, text=True, timeout=5, check=False
        )
        if proc.returncode == 0 and proc.stdout.strip().startswith("v24."):
            return env
    except OSError:
        pass

    candidate_bins: list[str] = []
    home = Path.home()
    patterns = [
        str(home / ".local/share/fnm/node-versions/v24*/installation/bin"),
        str(home / ".fnm/node-versions/v24*/installation/bin"),
        str(home / ".nvm/versions/node/v24*/bin"),
        str(home / ".local/share/cursor-agent/versions/*"),
    ]
    for pattern in patterns:
        for matched in sorted(glob.glob(pattern), reverse=True):
            node_exe = Path(matched) / "node"
            if node_exe.is_file() and os.access(node_exe, os.X_OK):
                candidate_bins.append(matched)
                break

    if candidate_bins:
        env["PATH"] = os.pathsep.join(candidate_bins + [env.get("PATH", "")])
    return env


def run_cmd(
    cmd: list[str],
    cwd: Path,
    env: dict[str, str],
    timeout: int = 60,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def git_head(workspace: Path, env: dict[str, str]) -> str | None:
    proc = run_cmd(["git", "rev-parse", "HEAD"], workspace, env, timeout=15)
    return proc.stdout.strip() if proc.returncode == 0 else None


def git_branch(workspace: Path, env: dict[str, str]) -> str | None:
    proc = run_cmd(["git", "branch", "--show-current"], workspace, env, timeout=15)
    return proc.stdout.strip() if proc.returncode == 0 else None


def git_dirty_lines(workspace: Path, env: dict[str, str]) -> list[str]:
    proc = run_cmd(["git", "status", "--porcelain"], workspace, env, timeout=15)
    if proc.returncode != 0:
        return []
    return [line for line in proc.stdout.splitlines() if line.strip()]


def quarantine_dirty_workspace(
    workspace: Path, env: dict[str, str], round_index: int
) -> str | None:
    dirty = git_dirty_lines(workspace, env)
    if not dirty:
        return None
    msg = f"issue-loop-quarantine-round-{round_index:02d}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    proc = run_cmd(["git", "stash", "push", "-u", "-m", msg], workspace, env, timeout=30)
    if proc.returncode == 0:
        return msg
    return None


def fetch_open_issues(workspace: Path, env: dict[str, str]) -> list[IssueInfo] | None:
    proc = run_cmd(
        [
            "gh",
            "issue",
            "list",
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,labels,updatedAt,assignees",
        ],
        workspace,
        env,
        timeout=60,
    )
    if proc.returncode != 0:
        return None
    try:
        raw = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        return None
    if not isinstance(raw, list):
        return None
    issues: list[IssueInfo] = []
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("number"), int):
            continue
        labels = [
            lbl["name"]
            for lbl in item.get("labels", [])
            if isinstance(lbl, dict) and isinstance(lbl.get("name"), str)
        ]
        assignees = [
            a["login"]
            for a in item.get("assignees", [])
            if isinstance(a, dict) and isinstance(a.get("login"), str)
        ]
        issues.append(
            IssueInfo(
                number=item["number"],
                title=str(item.get("title", "")).strip(),
                labels=labels,
                updated_at=str(item.get("updatedAt", "")),
                assignees=assignees,
            )
        )
    return issues


def sort_key_issue(issue: IssueInfo) -> tuple[int, int, int, int]:
    labels = set(issue.labels)
    in_progress_rank = 0 if "status:in-progress" in labels else 1
    priority_rank = min(
        (PRIORITY_ORDER[l] for l in labels if l in PRIORITY_ORDER), default=9
    )
    milestone_rank = min(
        (MILESTONE_ORDER[l] for l in labels if l in MILESTONE_ORDER), default=9
    )
    return (in_progress_rank, priority_rank, milestone_rank, issue.number)


def classify_issues(
    issues: list[IssueInfo],
    skipped_issues: dict[int, str],
) -> tuple[list[IssueInfo], list[tuple[IssueInfo, str]]]:
    actionable: list[IssueInfo] = []
    excluded: list[tuple[IssueInfo, str]] = []
    for issue in issues:
        label_set = set(issue.labels)
        if issue.number in skipped_issues:
            excluded.append((issue, f"本轮循环已跳过: {skipped_issues[issue.number]}"))
            continue
        blocking = sorted(label_set & NON_ACTIONABLE_LABELS)
        if blocking:
            excluded.append((issue, f"标签排除: {', '.join(blocking)}"))
            continue
        actionable.append(issue)
    actionable.sort(key=sort_key_issue)
    excluded.sort(key=lambda pair: pair[0].number)
    return actionable, excluded


def parse_loop_round_block(text: str | None) -> ParsedLoopRound:
    parsed = ParsedLoopRound()
    if not text:
        return parsed
    idx = text.rfind("loop-round:")
    if idx == -1:
        return parsed
    block = text[idx:]
    for raw_line in block.splitlines()[1:18]:
        line = raw_line.strip().strip("`")
        if not line or line.startswith("```"):
            if parsed.result is not None and line.startswith("```"):
                break
            continue
        m = re.match(r"^([a-z_]+)\s*:\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if key == "issue":
            nm = re.search(r"#?(\d+)", val)
            if nm:
                parsed.issue = int(nm.group(1))
        elif key == "result":
            parsed.result = val.split()[0].strip("`").lower() if val else None
        elif key == "commit":
            parsed.commit = None if val.lower() in ("none", "无", "-") else val
        elif key == "verified":
            parsed.verified = val
        elif key == "remaining":
            parsed.remaining = val
        elif key == "unblock":
            parsed.unblock = val
        elif key == "issues_created":
            parsed.issues_created = [int(n) for n in re.findall(r"#(\d+)", val)]
        elif key == "backlog_doc":
            parsed.backlog_doc = None if val.lower() in ("none", "无") else val
    return parsed


def build_dev_prompt(
    *,
    round_index: int,
    max_rounds: int,
    target: IssueInfo,
    backups: list[IssueInfo],
    excluded: list[tuple[IssueInfo, str]],
    branch: str,
    dev_commits: int,
) -> str:
    backup_lines = (
        "\n".join(
            f"  - #{i.number} [{', '.join(i.labels)}] {i.title}" for i in backups[:5]
        )
        or "  - （无）"
    )
    excluded_lines = (
        "\n".join(f"  - #{i.number} {i.title}（{reason}）" for i, reason in excluded[:15])
        or "  - （无）"
    )
    header = f"""## 运行时上下文（外层调度器自动注入）

- 当前轮次：第 {round_index} / {max_rounds} 轮 | 当前分支：`{branch}` | 本次运行已完成开发提交：{dev_commits}
- **本轮锁定目标 Issue**：`#{target.number}` — {target.title}
  - 标签：{", ".join(target.labels) or "无"}
- 队列后续候选（本轮不要顺带开发，仅在目标被确认为 awaiting-pilot/blocked 退出后由下一轮处理）：
{backup_lines}
- **已排除 Issue（禁止再选、禁止翻回 ready）**：
{excluded_lines}
- 已核实就绪的本地环境：Node 24 + pnpm 12、PostgreSQL + SQLite 双库、Redis 缓存、OpenAI Responses API（`.env.local` 已就绪）、**邮件长期 Mock 永远成功**（`GEO_AUTH_MAIL_MOCK=true` / `GEO_AUTH_EMAIL_VERIFIED_MOCK=true`，永不阻塞）。

---

"""
    return header + DEV_PROMPT_BODY


def build_backlog_prompt(
    *,
    round_index: int,
    max_rounds: int,
    replenish_count: int,
    branch: str,
    open_issues: list[IssueInfo],
    excluded: list[tuple[IssueInfo, str]],
) -> str:
    open_summary = (
        "\n".join(
            f"  - #{i.number} [{', '.join(i.labels)}] {i.title}"
            for i in open_issues[:25]
        )
        or "  - （当前无 Open Issue）"
    )
    excluded_summary = (
        "\n".join(f"  - #{i.number}（{reason}）" for i, reason in excluded[:15])
        or "  - （无）"
    )
    header = f"""## 运行时上下文（外层调度器自动注入）

- 当前轮次：第 {round_index} / {max_rounds} 轮（自动补货模式）| 当前分支：`{branch}`
- **`target_replenish_count`**：请新建 **{replenish_count}** 个可独立编码并自动化验证的 `status:ready` Issue。
- 当前全部 Open Issue（去重参考）：
{open_summary}
- 其中已移出代码队列的非开发项（不要为这些真人试点项重复建单）：
{excluded_summary}
- 已核实就绪的开发能力：PostgreSQL + SQLite 双库、Redis 缓存、OpenAI Responses API（`src/lib/ai/responses.ts` 已实测可用，可规划 AI 功能单）、邮件长期 Mock 永远成功（暂不接入邮件网关）。

---

"""
    return header + BACKLOG_REPLENISH_PROMPT_BODY


def run_preflight(workspace: Path, env: dict[str, str], probe_ai: bool = False) -> bool:
    script = workspace / "scripts" / "check-dev-env.mjs"
    if not script.is_file():
        print("[WARN] scripts/check-dev-env.mjs 不存在，跳过详细环境预检。", flush=True)
        return True
    cmd = ["node", "--conditions=react-server", str(script)]
    if probe_ai:
        cmd.append("--probe-ai")
    proc = run_cmd(cmd, workspace, env, timeout=45)
    if proc.stdout:
        print(proc.stdout.rstrip(), flush=True)
    if proc.stderr:
        print(proc.stderr.rstrip(), file=sys.stderr, flush=True)
    return proc.returncode == 0


def resolve_cursor_agent_bin(explicit_bin: str | None) -> str:
    if explicit_bin:
        return explicit_bin
    found = shutil.which("cursor-agent")
    if found:
        return found
    fallback = Path.home() / ".local" / "bin" / "cursor-agent"
    if fallback.is_file():
        return str(fallback)
    raise FileNotFoundError(
        "未找到 cursor-agent 可执行文件，请将其加入 PATH 或通过 --agent-bin 指定路径。"
    )


def create_new_session(agent_bin: str, workspace: Path, env: dict[str, str]) -> str:
    proc = run_cmd([agent_bin, "create-chat"], workspace, env, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(
            f"cursor-agent create-chat 失败 (exit={proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("cursor-agent create-chat 未返回 session_id")
    return lines[-1]


def terminate_process_group(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is not None:
        return
    try:
        pgid = os.getpgid(proc.pid)
        os.killpg(pgid, signal.SIGTERM)
        try:
            proc.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            os.killpg(pgid, signal.SIGKILL)
            proc.wait(timeout=5)
    except ProcessLookupError:
        pass
    except Exception:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def run_round(
    *,
    round_index: int,
    mode: str,
    target_issue: int | None,
    agent_bin: str,
    workspace: Path,
    env: dict[str, str],
    log_dir: Path,
    model: str,
    round_timeout: int | None,
    approve_mcps: bool,
    prompt: str,
) -> RoundResult:
    started_at = time.monotonic()
    before_head = git_head(workspace, env)
    session_id = create_new_session(agent_bin, workspace, env)
    log_file = log_dir / f"round-{round_index:02d}-{mode}-{session_id}.jsonl"

    cmd = [
        agent_bin,
        "-p",
        "--force",
        "--trust",
        "--workspace",
        str(workspace),
        "--resume",
        session_id,
        "--output-format",
        "stream-json",
        "--model",
        model,
    ]
    if approve_mcps:
        cmd.append("--approve-mcps")
    cmd.append(prompt)

    target_desc = f"#{target_issue}" if target_issue is not None else "backlog"
    print(
        f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"=== 第 {round_index} 轮开始 | mode={mode} | target={target_desc} "
        f"| session={session_id} | model={model} ===",
        flush=True,
    )

    result_event: dict[str, Any] | None = None
    non_json_tail: list[str] = []
    timed_out = threading.Event()

    proc = subprocess.Popen(
        cmd,
        cwd=workspace,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,
    )
    assert proc.stdout is not None

    def _on_timeout() -> None:
        timed_out.set()
        terminate_process_group(proc)

    timer: threading.Timer | None = (
        threading.Timer(round_timeout, _on_timeout)
        if round_timeout is not None and round_timeout > 0
        else None
    )
    if timer is not None:
        timer.daemon = True
        timer.start()

    try:
        with log_file.open("w", encoding="utf-8") as fp:
            for raw_line in proc.stdout:
                fp.write(raw_line)
                fp.flush()
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    non_json_tail.append(line)
                    if len(non_json_tail) > 20:
                        non_json_tail.pop(0)
                    print(f"[round {round_index}] {line}", flush=True)
                    continue

                ev_type = event.get("type")
                if ev_type == "assistant":
                    content = (
                        event.get("message", {}).get("content", [])
                        if isinstance(event.get("message"), dict)
                        else []
                    )
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            text = item.get("text", "")
                            if text:
                                print(text, flush=True)
                elif ev_type == "result":
                    result_event = event

        exit_code = proc.wait()
    except KeyboardInterrupt:
        terminate_process_group(proc)
        raise
    finally:
        if timer is not None:
            timer.cancel()

    duration_sec = time.monotonic() - started_at
    after_head = git_head(workspace, env)
    commit_produced = bool(before_head and after_head and before_head != after_head)

    if timed_out.is_set():
        return RoundResult(
            round_index=round_index,
            mode=mode,
            target_issue=target_issue,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            before_head=before_head,
            after_head=after_head,
            commit_produced=commit_produced,
            error_reason=f"第 {round_index} 轮执行超过 {round_timeout} 秒，已终止进程组",
            log_file=str(log_file),
        )

    if exit_code != 0:
        err_detail = (
            " | ".join(non_json_tail[-5:])
            if non_json_tail
            else f"exit_code={exit_code}"
        )
        return RoundResult(
            round_index=round_index,
            mode=mode,
            target_issue=target_issue,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            before_head=before_head,
            after_head=after_head,
            commit_produced=commit_produced,
            error_reason=f"cursor-agent 进程非零退出 ({err_detail})",
            log_file=str(log_file),
        )

    if result_event is None:
        return RoundResult(
            round_index=round_index,
            mode=mode,
            target_issue=target_issue,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            before_head=before_head,
            after_head=after_head,
            commit_produced=commit_produced,
            error_reason="未收到 stream-json 的 result 事件，无法确认执行结果",
            log_file=str(log_file),
        )

    subtype = result_event.get("subtype")
    is_error = bool(result_event.get("is_error", False))
    result_text = result_event.get("result")
    text_str = result_text if isinstance(result_text, str) else None

    if is_error or subtype != "success":
        return RoundResult(
            round_index=round_index,
            mode=mode,
            target_issue=target_issue,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            before_head=before_head,
            after_head=after_head,
            commit_produced=commit_produced,
            error_reason=f"result 事件标记失败 (subtype={subtype}, is_error={is_error})",
            result_text=text_str,
            log_file=str(log_file),
        )

    return RoundResult(
        round_index=round_index,
        mode=mode,
        target_issue=target_issue,
        session_id=session_id,
        success=True,
        exit_code=exit_code,
        duration_sec=duration_sec,
        before_head=before_head,
        after_head=after_head,
        commit_produced=commit_produced,
        result_text=text_str,
        log_file=str(log_file),
    )


def parse_skip_issues(raw: str | None) -> dict[int, str]:
    result: dict[int, str] = {}
    if not raw:
        return result
    for token in raw.split(","):
        cleaned = token.strip().lstrip("#")
        if cleaned.isdigit():
            result[int(cleaned)] = "CLI --skip-issues 指定跳过"
    return result


def parse_args() -> argparse.Namespace:
    default_workspace = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="GeoPro 自主 Issue 串行开发编排脚本（外层状态机 + 水位自动补货 + 进度核验）"
    )
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=MAX_ROUNDS,
        help=f"最大总执行轮数（含补货轮，默认 {MAX_ROUNDS}）",
    )
    parser.add_argument(
        "--target-dev-commits",
        type=int,
        default=0,
        help="可选：达成指定数量的有效开发提交后提前成功结束（默认 0=跑满 max-rounds）",
    )
    parser.add_argument(
        "--workspace",
        type=Path,
        default=default_workspace,
        help=f"工作区根目录（默认 {default_workspace}）",
    )
    parser.add_argument(
        "--agent-bin",
        type=str,
        default=None,
        help="cursor-agent 可执行文件路径（默认自动查找）",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL,
        help=f"cursor-agent 模型（默认 {DEFAULT_MODEL}）",
    )
    parser.add_argument(
        "--round-timeout",
        type=int,
        default=DEFAULT_ROUND_TIMEOUT,
        help=f"单轮最大超时秒数，0 表示不限（默认 {DEFAULT_ROUND_TIMEOUT}s）",
    )
    parser.add_argument(
        "--approve-mcps",
        action="store_true",
        help="自动批准 MCP servers（传递 --approve-mcps）",
    )
    parser.add_argument(
        "--log-dir",
        type=Path,
        default=None,
        help="日志输出目录（默认 <workspace>/tmp）",
    )
    parser.add_argument(
        "--prompt-mode",
        choices=("auto", "dev", "backlog"),
        default="auto",
        help="调度模式：auto=水位低于 min-backlog 时自动补货否则开发；dev/backlog 强制指定",
    )
    parser.add_argument(
        "--min-backlog",
        type=int,
        default=DEFAULT_MIN_BACKLOG,
        help=f"auto 模式下触发自动补货的可开发 Issue 最低水位（默认 {DEFAULT_MIN_BACKLOG}）",
    )
    parser.add_argument(
        "--replenish-count",
        type=int,
        default=DEFAULT_REPLENISH_COUNT,
        help=f"每次补货新建的可开发 Issue 数量（默认 {DEFAULT_REPLENISH_COUNT}）",
    )
    parser.add_argument(
        "--max-replenishes",
        type=int,
        default=DEFAULT_MAX_REPLENISHES,
        help=f"单次运行允许的最大自动补货批数（默认 {DEFAULT_MAX_REPLENISHES}）",
    )
    parser.add_argument(
        "--max-consecutive-failures",
        type=int,
        default=DEFAULT_MAX_CONSECUTIVE_FAILURES,
        help=f"连续运行时失败上限，超过后中止循环（默认 {DEFAULT_MAX_CONSECUTIVE_FAILURES}）",
    )
    parser.add_argument(
        "--max-consecutive-noop",
        type=int,
        default=DEFAULT_MAX_CONSECUTIVE_NOOP,
        help=f"在无法继续补货时允许的最大连续无产出轮数（默认 {DEFAULT_MAX_CONSECUTIVE_NOOP}）",
    )
    parser.add_argument(
        "--max-same-issue-rounds",
        type=int,
        default=DEFAULT_MAX_SAME_ISSUE_ROUNDS,
        help=f"同一 Issue 连续 progressed 轮数上限，超过后自动轮换（默认 {DEFAULT_MAX_SAME_ISSUE_ROUNDS}）",
    )
    parser.add_argument(
        "--skip-issues",
        type=str,
        default=None,
        help="逗号分隔的跳过 Issue 编号，如 21,31,32",
    )
    parser.add_argument(
        "--no-quarantine-dirty",
        action="store_true",
        help="禁用失败/异常轮次后的自动 git stash 隔离",
    )
    parser.add_argument(
        "--allow-dirty-start",
        action="store_true",
        help="允许在工作区已有未提交改动时启动循环（默认拒绝以保护用户本地改动）",
    )
    parser.add_argument(
        "--skip-preflight",
        action="store_true",
        help="跳过启动前的开发环境预检",
    )
    parser.add_argument(
        "--check-env",
        action="store_true",
        help="仅执行开发环境预检（含 AI 探针）后退出",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅执行预检与队列调度演算，打印第 1 轮决策与注入上下文，不调用 cursor-agent",
    )
    return parser.parse_args()


def print_summary(
    results: list[RoundResult],
    max_rounds: int,
    dev_commits: int,
    total_created: int,
    skipped_issues: dict[int, str],
    summary_file: Path,
) -> None:
    print("\n================ 循环执行汇总 ================", flush=True)
    print(
        f"轮次: {len(results)} / {max_rounds} | "
        f"有效开发提交: {dev_commits} | "
        f"补货新建 Issue: {total_created} | "
        f"本轮跳过 Issue: {len(skipped_issues)}",
        flush=True,
    )
    for r in results:
        target = f"#{r.target_issue}" if r.target_issue is not None else "backlog"
        status = "OK" if r.success else "FAIL"
        extra = []
        if r.commit_produced and r.after_head:
            extra.append(f"commit={r.after_head[:7]}")
        if r.parsed_outcome:
            extra.append(f"outcome={r.parsed_outcome}")
        if r.issues_created:
            extra.append(f"created={len(r.issues_created)}")
        if r.issues_closed:
            extra.append(f"closed={r.issues_closed}")
        if r.error_reason:
            extra.append(f"err={r.error_reason}")
        print(
            f"  R{r.round_index:02d} [{status}] {r.mode:<7} {target:<8} "
            f"{r.duration_sec:6.1f}s  {' | '.join(extra)}",
            flush=True,
        )
    if skipped_issues:
        print("跳过列表:", flush=True)
        for num, reason in sorted(skipped_issues.items()):
            print(f"  - #{num}: {reason}", flush=True)
    print(f"汇总文件: {summary_file}", flush=True)


def main() -> int:
    args = parse_args()
    if args.max_rounds < 1:
        print("--max-rounds 必须 >= 1", file=sys.stderr)
        return 2

    workspace = args.workspace.resolve()
    if not workspace.is_dir():
        print(f"工作区目录不存在: {workspace}", file=sys.stderr)
        return 2

    env = build_runtime_env()

    if args.check_env:
        ok = run_preflight(workspace, env, probe_ai=True)
        return 0 if ok else 1

    if not args.skip_preflight:
        print("=== 启动前开发环境预检 ===", flush=True)
        if not run_preflight(workspace, env, probe_ai=False):
            print(
                "开发环境预检存在 FAIL 项，请先修复或运行 `pnpm env:check` 排查（或加 --skip-preflight 强制继续）。",
                file=sys.stderr,
                flush=True,
            )
            return 2

    branch = git_branch(workspace, env) or "main"
    skipped_issues = parse_skip_issues(args.skip_issues)

    if args.dry_run:
        issues = fetch_open_issues(workspace, env)
        if issues is None:
            print("无法通过 gh 获取 Open Issue 列表。", file=sys.stderr)
            return 1
        actionable, excluded = classify_issues(issues, skipped_issues)
        print("\n=== DRY-RUN 调度演算 ===", flush=True)
        print(
            f"分支: {branch} | Open 总数: {len(issues)} | "
            f"可开发: {len(actionable)} | 已排除: {len(excluded)} | min_backlog: {args.min_backlog}",
            flush=True,
        )
        if excluded:
            print("已排除 Issue:", flush=True)
            for issue, reason in excluded:
                print(f"  - #{issue.number} {issue.title} ({reason})", flush=True)
        if actionable:
            print("可开发候选队列（按优先级排序）:", flush=True)
            for idx, issue in enumerate(actionable[:10], start=1):
                print(
                    f"  {idx}. #{issue.number} [{', '.join(issue.labels)}] {issue.title}",
                    flush=True,
                )
        if args.prompt_mode == "backlog" or (
            args.prompt_mode == "auto" and len(actionable) < args.min_backlog
        ):
            print(
                f"\n>>> 第 1 轮决策: BACKLOG 自动补货（计划新建 {args.replenish_count} 个可开发 Issue）",
                flush=True,
            )
        elif actionable:
            print(
                f"\n>>> 第 1 轮决策: DEV 开发锁定 #{actionable[0].number} — {actionable[0].title}",
                flush=True,
            )
        else:
            print("\n>>> 第 1 轮决策: 无可开发 Issue（dev 强制模式无法启动）", flush=True)
        return 0

    initial_dirty = git_dirty_lines(workspace, env)
    if initial_dirty and not args.allow_dirty_start:
        print(
            f"检测到工作区启动前已有 {len(initial_dirty)} 处未提交改动，为保护你的本地改动已停止启动。\n"
            "请先提交/清理，或显式传入 --allow-dirty-start。",
            file=sys.stderr,
            flush=True,
        )
        return 2

    try:
        agent_bin = resolve_cursor_agent_bin(args.agent_bin)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    log_dir = (
        args.log_dir.resolve() if args.log_dir is not None else workspace / "tmp"
    )
    log_dir.mkdir(parents=True, exist_ok=True)
    summary_file = (
        log_dir / f"loop-summary-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    )

    print(
        f"启动 GeoPro 自主开发循环 (v2) | max_rounds={args.max_rounds} | "
        f"target_dev_commits={args.target_dev_commits or 'unlimited'} | "
        f"min_backlog={args.min_backlog} | replenish_count={args.replenish_count} | "
        f"model={args.model} | timeout={args.round_timeout}s | branch={branch}",
        flush=True,
    )

    results: list[RoundResult] = []
    overall_exit = 0
    dev_commits = 0
    total_created = 0
    replenishes_done = 0
    consecutive_failures = 0
    consecutive_noop = 0
    issue_failure_counts: dict[int, int] = {}
    same_issue_rounds: dict[int, int] = {}
    round_timeout = args.round_timeout if args.round_timeout > 0 else None

    for round_index in range(1, args.max_rounds + 1):
        if args.target_dev_commits > 0 and dev_commits >= args.target_dev_commits:
            print(
                f"\n已达成目标有效开发提交数 ({dev_commits} / {args.target_dev_commits})，提前成功收束。",
                flush=True,
            )
            break

        before_issues = fetch_open_issues(workspace, env)
        if before_issues is None:
            consecutive_failures += 1
            print(
                f"[第 {round_index} 轮] gh issue list 失败（连续失败 {consecutive_failures}/{args.max_consecutive_failures}）",
                file=sys.stderr,
                flush=True,
            )
            if consecutive_failures >= args.max_consecutive_failures:
                overall_exit = 1
                break
            time.sleep(5)
            continue

        before_open_set = {i.number for i in before_issues}
        actionable, excluded = classify_issues(before_issues, skipped_issues)

        need_backlog = False
        if args.prompt_mode == "backlog":
            need_backlog = True
        elif args.prompt_mode == "auto" and len(actionable) < args.min_backlog:
            if replenishes_done < args.max_replenishes:
                need_backlog = True
            else:
                print(
                    f"\n可开发队列为空（{len(actionable)}）且已达最大自动补货批数（{args.max_replenishes}），安全结束循环。",
                    flush=True,
                )
                break

        if need_backlog:
            mode = "backlog"
            target_issue_obj = None
            prompt = build_backlog_prompt(
                round_index=round_index,
                max_rounds=args.max_rounds,
                replenish_count=args.replenish_count,
                branch=branch,
                open_issues=before_issues,
                excluded=excluded,
            )
        else:
            if not actionable:
                print(
                    "\n当前没有任何可开发 Issue（--prompt-mode=dev 且队列为空），安全结束。",
                    flush=True,
                )
                break
            mode = "dev"
            target_issue_obj = actionable[0]
            prompt = build_dev_prompt(
                round_index=round_index,
                max_rounds=args.max_rounds,
                target=target_issue_obj,
                backups=actionable[1:],
                excluded=excluded,
                branch=branch,
                dev_commits=dev_commits,
            )

        target_num = target_issue_obj.number if target_issue_obj else None

        try:
            res = run_round(
                round_index=round_index,
                mode=mode,
                target_issue=target_num,
                agent_bin=agent_bin,
                workspace=workspace,
                env=env,
                log_dir=log_dir,
                model=args.model,
                round_timeout=round_timeout,
                approve_mcps=args.approve_mcps,
                prompt=prompt,
            )
        except KeyboardInterrupt:
            print("\n收到中断信号，停止后续轮次。", file=sys.stderr, flush=True)
            overall_exit = 130
            break
        except Exception as exc:
            consecutive_failures += 1
            print(
                f"\n[第 {round_index} 轮] 运行异常 ({consecutive_failures}/{args.max_consecutive_failures}): {exc}",
                file=sys.stderr,
                flush=True,
            )
            if not args.no_quarantine_dirty:
                stashed = quarantine_dirty_workspace(workspace, env, round_index)
                if stashed:
                    print(f"已将异常轮次脏改动隔离至 stash: {stashed}", flush=True)
            if consecutive_failures >= args.max_consecutive_failures:
                overall_exit = 1
                break
            continue

        # 客观采集轮后 GitHub 状态与解析 loop-round
        after_issues = fetch_open_issues(workspace, env)
        if after_issues is not None:
            after_open_set = {i.number for i in after_issues}
            res.issues_created = sorted(after_open_set - before_open_set)
            res.issues_closed = sorted(before_open_set - after_open_set)

        parsed = parse_loop_round_block(res.result_text)
        res.parsed_outcome = parsed.result
        results.append(res)

        if not res.success:
            consecutive_failures += 1
            print(
                f"\n[第 {round_index} 轮失败] {res.error_reason} "
                f"（连续失败 {consecutive_failures}/{args.max_consecutive_failures}）",
                file=sys.stderr,
                flush=True,
            )
            if not args.no_quarantine_dirty:
                stashed = quarantine_dirty_workspace(workspace, env, round_index)
                if stashed:
                    print(f"已隔离本轮残留脏改动至 stash: {stashed}", flush=True)
            if target_num is not None:
                issue_failure_counts[target_num] = (
                    issue_failure_counts.get(target_num, 0) + 1
                )
                if issue_failure_counts[target_num] >= 2:
                    skipped_issues[target_num] = f"连续运行失败 2 次 ({res.error_reason})"
            if consecutive_failures >= args.max_consecutive_failures:
                print("达到连续失败上限，中止循环。", file=sys.stderr, flush=True)
                overall_exit = 1
                break
            continue

        # 进程成功，重置运行时失败计数，核验真实产出
        consecutive_failures = 0

        if not args.no_quarantine_dirty and not args.allow_dirty_start:
            stashed = quarantine_dirty_workspace(workspace, env, round_index)
            if stashed:
                print(
                    f"[WARN] 第 {round_index} 轮结束后存在未提交文件，已隔离至 stash: {stashed}",
                    flush=True,
                )

        if mode == "backlog":
            created_cnt = len(res.issues_created)
            if created_cnt > 0:
                replenishes_done += 1
                total_created += created_cnt
                consecutive_noop = 0
                print(
                    f"\n[第 {round_index} 轮补货成功] 新建 {created_cnt} 个 Open Issue: "
                    f"{', '.join(f'#{n}' for n in res.issues_created)}",
                    flush=True,
                )
            else:
                consecutive_noop += 1
                print(
                    f"\n[第 {round_index} 轮补货未新增 Issue] 连续无产出 {consecutive_noop}/{args.max_consecutive_noop}",
                    file=sys.stderr,
                    flush=True,
                )
                if consecutive_noop >= args.max_consecutive_noop:
                    print("补货连续无新增，中止循环避免空转。", file=sys.stderr, flush=True)
                    overall_exit = 1
                    break
        else:
            assert target_num is not None
            closed_target = target_num in res.issues_closed
            made_progress = res.commit_produced or closed_target

            if made_progress:
                if res.commit_produced:
                    dev_commits += 1
                consecutive_noop = 0
                if closed_target or parsed.result == "done":
                    same_issue_rounds.pop(target_num, None)
                    print(
                        f"\n[第 {round_index} 轮推进成功] #{target_num} 已完成/关闭 | "
                        f"commit={(res.after_head or '')[:7] or 'none'}",
                        flush=True,
                    )
                else:
                    same_issue_rounds[target_num] = (
                        same_issue_rounds.get(target_num, 0) + 1
                    )
                    print(
                        f"\n[第 {round_index} 轮推进成功] #{target_num} 已提交增量 "
                        f"({same_issue_rounds[target_num]}/{args.max_same_issue_rounds}) | "
                        f"commit={(res.after_head or '')[:7]}",
                        flush=True,
                    )
                    if same_issue_rounds[target_num] >= args.max_same_issue_rounds:
                        skipped_issues[target_num] = (
                            f"已连续推进 {args.max_same_issue_rounds} 轮，自动轮换至下一个 Issue"
                        )
            elif parsed.result in ("awaiting-pilot", "blocked"):
                reason = parsed.unblock or f"Agent 报告 {parsed.result}"
                skipped_issues[target_num] = reason
                print(
                    f"\n[第 {round_index} 轮自动移出队列] #{target_num} → {parsed.result}（{reason}），下一轮将自动切换目标或补货。",
                    flush=True,
                )
            else:
                skipped_issues[target_num] = "本轮未产生新的代码提交或关单，自动跳过防空转"
                consecutive_noop += 1
                print(
                    f"\n[第 {round_index} 轮无实质产出] #{target_num} 未产生 commit/关单，已加入跳过表 "
                    f"（连续无产出 {consecutive_noop}/{args.max_consecutive_noop}）。",
                    file=sys.stderr,
                    flush=True,
                )
                remaining_after = len(actionable) - 1
                can_replenish = (
                    args.prompt_mode == "auto"
                    and remaining_after < args.min_backlog
                    and replenishes_done < args.max_replenishes
                )
                if consecutive_noop >= args.max_consecutive_noop and not can_replenish:
                    print("连续无实质产出且无可补货空间，中止循环。", file=sys.stderr, flush=True)
                    overall_exit = 1
                    break

    payload = {
        "timestamp": datetime.now().isoformat(),
        "branch": branch,
        "max_rounds": args.max_rounds,
        "dev_commits": dev_commits,
        "issues_created_total": total_created,
        "replenishes_done": replenishes_done,
        "skipped_issues": {str(k): v for k, v in skipped_issues.items()},
        "overall_exit": overall_exit,
        "rounds": [asdict(r) for r in results],
    }
    summary_file.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print_summary(
        results, args.max_rounds, dev_commits, total_created, skipped_issues, summary_file
    )
    return overall_exit


if __name__ == "__main__":
    raise SystemExit(main())
