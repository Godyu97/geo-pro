#!/usr/bin/env python3
"""
串行循环调用 cursor-agent 的自主 Issue 开发脚本。

特性：
- 串行执行，最多运行 20 轮（可通过 --max-rounds 覆盖）。
- 每轮调用前通过 `cursor-agent create-chat` 创建全新 session，并使用 `--resume <session_id>` 启动。会话之间不共享对话，只共享仓库、Git 历史和 Issue 评论。
- 每轮注入同一份 `FIXED_PROMPT`。选任务、续作、验收和是否允许结束本轮，都以该提示词为准。
- 仅当上一轮执行成功（进程退出码为 0，且 stream-json 结果事件为 success 且 is_error=false）才进入下一轮；任一轮失败立即中止。进程成功只表示本轮干净收束，不表示 Issue 已 Done。
- 默认模型为 `grok-4.7-high`（CLI 显示名 Grok 4.7 256K High，非 Fast）。
- 日志默认写入工作区 `./tmp`。
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

MAX_ROUNDS = 20
# cursor-agent models 中的非 Fast 变体；init 事件显示为 "Grok 4.7 256K High"。
DEFAULT_MODEL = "grok-4.7-high"

FIXED_PROMPT = """# GEO Agent Issue 自主开发工作流

你是 GeoPro 仓库的全自主 Coding Agent。调用方是 `scripts/run-issue-loop.py` 的外层串行循环。先读根目录 `AGENTS.md`，再按其中路由按需打开 `.agents/` 与 `docs/`，不要全量预读。

## 0. 一轮的边界

每一轮都是 `create-chat` 产生的新 session，只注入本提示词。没有上一轮对话记忆。续作依据只能是仓库代码、`git log` 和 Issue 评论。

外层只有在本进程退出码为 0，且 stream-json 的 result 为 `subtype=success`、`is_error=false` 时，才开始下一轮。提问、等待输入、崩溃或中途放弃，会取消后续所有轮次。进程成功只表示本轮干净收束，不等于 Issue 已 Done。

因此：

- 禁止向用户提问、请求确认或等待输入。不确定性自行查仓库后做最小决定，并把假设写进 Issue 评论。
- 本轮只处理一个 Issue 的一个可验证增量，然后立刻结束。不要在同一 session 开始下一个 Issue。
- 本轮必须留下下一轮新鲜 session 能读懂的评论。没有这个评论，下一轮无法知道做完了什么。
- 不能形成已验证提交、又没有把 Issue 标成硬阻塞时，不要空跑退出。那样下一轮仍会选中同一个最早的 Open Issue。

## 1. 同步最新代码

1. `git status`。非本轮的未提交改动先 `git stash`，工作区必须干净。
2. 在当前分支执行 `git pull --rebase origin <当前分支>`。不要产生 Merge Commit，不要 `push --force`。
3. 拉不下来或冲突无法安全解开时，说明原因并退出，不要在过期代码上改。

## 2. 选择恰好一个任务

用 `gh issue list --state open --limit 100` 取 Open Issue，按创建时间从早到晚。

1. 跳过另有人正在改的 Issue：近几分钟内有他人的进行中评论、锁定或明确 assignee 冲突。本循环上一轮留下的 `In Progress` 是可续作，不要跳过。
2. 带 `blocked` / `status:blocked` 时先读正文、评论和最新代码，不要直接跳过。阻塞原因已经消失就去掉阻塞标记、评论解阻依据，并纳入候选。
3. 硬阻塞才跳过：缺少外部私有密钥、未授权的付费服务、或必须真人试点才能完成且无法用代码推进的验收。Issue 若写明可以用隔离 fixture 做软件、真实验收保持未勾选，则做软件增量，不把整单标成阻塞，也不要勾选真实验收。
4. 选定创建时间最早、可执行的一个。先读它的评论和相关提交。已推送的增量不要重做，从剩余验收继续。
5. 若这个 Issue 本轮做不出可验证的代码或配置增量：加上 `status:blocked`，评论写明解除条件，然后干净退出，让下一轮改选下一个。
6. 只有全部 Open Issue 都是他人活跃占用或硬阻塞时，才说明原因并退出。

## 3. 认领

把选中 Issue 标为 `In Progress`（有 GitHub Projects Status 就改 Status，否则用 Label）。不要在未推送验证过的增量前标 `Done`。

## 4. 调研

按 `AGENTS.md` 的路由读取本轮直接相关的治理、规格、源码和测试。仓库已有 `docs/specs` 与 `docs/tasks` 时，以它们为需求合同。

描述不足时，按现有架构补上边界和验收，用评论记录假设后直接实现。不要为了补流程去改无关产品文档。禁止伪造监测记录、趋势、客户评价、排名或提升比例；隔离 fixture 必须标明是 fixture。

## 5. 最小实现

遵循现有 `src/features/<domain>/` 边界和代码风格，复用已有实现。一个增量只覆盖本 Issue 中一条尚未完成、且本轮能验证的行为。

- 规格里已有验收合同的功能：按该合同实现，不要另起一套 OpenSpec，除非行为已经超出现有规格。
- Bug、重构、杂务：直接改根因。
- 不要顺手实现未选中的 Issue，也不要为了“看起来完整”加空接口、空页面或未接入的表。

## 6. 验收通过后才允许提交

按 `.agents/governance/quality-gates.md` 运行适用命令，并如实区分通过、失败、未配置、环境受阻。

- 代码或配置改动至少运行 `pnpm lint` 和 `pnpm typecheck`。
- 改动影响生产构建时运行 `pnpm build`。Schema、迁移、全量 DDL、认证、文档、多语言各自运行门禁里列出的对应命令。
- 失败就修，修到适用项通过再提交。不得关规则、放宽 `strict` 或改无关代码来换通过。
- 环境受阻的外部能力保持未验证。不要写成通过，不要据此勾选真实验收，也不要据此把 Issue 标 `Done`。

适用门禁未通过时：不 commit、不 push、不关闭 Issue。

## 7. 提交并推送

1. `git diff` 只含本 Issue 本轮增量。
2. 提交说明跟随仓库既有 Conventional Commits，主题使用简体中文，并带 Issue 号，例如 `feat(monitoring): 暂停预算不足的未执行槽位 (#41)`。
3. 一轮一个 commit，不要空提交。在当前分支提交。不新建分支，不开 PR。
4. 推送前执行 `git pull --rebase origin <当前分支>`。推送被拒就再 rebase 后重推。禁止 force push。rebase 若改动了已验证内容，先重跑关键门禁再推。

## 8. 交给下一轮

推送成功后立刻评论，使用下面的字段，方便下一轮新 session 续作：

```text
loop-round:
issue: #N
result: progressed | done | blocked
commit: <sha 或 none>
verified: <实际跑过的命令和结果>
remaining: <未完成验收，没有则写无>
unblock: <仅 blocked 时写解除条件>
```

- `done`：该 Issue 的软件验收都已核实，真实验收要么已有证据，要么正文允许保持未勾选且没有剩余软件增量。然后标 `Done` 并用 `gh` 关闭。
- `progressed`：已推送验证过的增量，但仍有验收未完成。保持 `In Progress`，不要关闭。
- `blocked`：本轮没有可验证增量。保持开放，标上阻塞和解除条件。

## 9. 收束

同步、门禁或推送失败时先自己修。多次仍无法恢复：不要标 `Done`，按上面的格式评论根因和已试方案；若同一 Issue 再轮还会空转，标 `blocked`。然后结束进程。

结束前用简体中文简短写出：Issue 编号和标题、本轮增量、实际命令结果、分支、commit SHA、push 结果、`progressed | done | blocked`。

现在立即开始执行。"""


@dataclass
class RoundResult:
    round_index: int
    session_id: str
    success: bool
    exit_code: int
    duration_sec: float
    error_reason: str | None = None
    result_text: str | None = None
    log_file: Path | None = None


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


def create_new_session(agent_bin: str, workspace: Path) -> str:
    proc = subprocess.run(
        [agent_bin, "create-chat"],
        cwd=workspace,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"cursor-agent create-chat 失败 (exit={proc.returncode}): {proc.stderr.strip() or proc.stdout.strip()}"
        )
    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("cursor-agent create-chat 未返回 session_id")
    return lines[-1]


def run_round(
    *,
    round_index: int,
    agent_bin: str,
    workspace: Path,
    log_dir: Path,
    model: str,
    round_timeout: int | None,
    approve_mcps: bool,
) -> RoundResult:
    started_at = time.monotonic()
    session_id = create_new_session(agent_bin, workspace)
    log_file = log_dir / f"round-{round_index:02d}-{session_id}.jsonl"

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
    cmd.append(FIXED_PROMPT)

    print(
        f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"=== 第 {round_index} 轮开始 | session={session_id} | model={model} ===",
        flush=True,
    )

    result_event: dict | None = None
    non_json_tail: list[str] = []
    timed_out = threading.Event()

    proc = subprocess.Popen(
        cmd,
        cwd=workspace,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    assert proc.stdout is not None

    def _on_timeout() -> None:
        timed_out.set()
        if proc.poll() is None:
            proc.kill()

    timer: threading.Timer | None = (
        threading.Timer(round_timeout, _on_timeout)
        if round_timeout is not None
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
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        raise
    finally:
        if timer is not None:
            timer.cancel()

    duration_sec = time.monotonic() - started_at

    if timed_out.is_set():
        return RoundResult(
            round_index=round_index,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            error_reason=f"第 {round_index} 轮执行超过 {round_timeout} 秒，已超时终止",
            log_file=log_file,
        )

    if exit_code != 0:
        err_detail = (
            " | ".join(non_json_tail[-5:])
            if non_json_tail
            else f"exit_code={exit_code}"
        )
        return RoundResult(
            round_index=round_index,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            error_reason=f"cursor-agent 进程非零退出 ({err_detail})",
            log_file=log_file,
        )

    if result_event is None:
        return RoundResult(
            round_index=round_index,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            error_reason="未收到 stream-json 的 result 事件，无法确认执行结果",
            log_file=log_file,
        )

    subtype = result_event.get("subtype")
    is_error = bool(result_event.get("is_error", False))
    result_text = result_event.get("result")

    if is_error or subtype != "success":
        return RoundResult(
            round_index=round_index,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            error_reason=f"result 事件标记失败 (subtype={subtype}, is_error={is_error})",
            result_text=result_text if isinstance(result_text, str) else None,
            log_file=log_file,
        )

    return RoundResult(
        round_index=round_index,
        session_id=session_id,
        success=True,
        exit_code=exit_code,
        duration_sec=duration_sec,
        result_text=result_text if isinstance(result_text, str) else None,
        log_file=log_file,
    )


def parse_args() -> argparse.Namespace:
    default_workspace = Path(__file__).resolve().parent.parent

    parser = argparse.ArgumentParser(
        description="串行循环调用 cursor-agent 执行 GEO Issue 自主开发工作流"
    )
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=MAX_ROUNDS,
        help=f"最大调用轮数（默认 {MAX_ROUNDS}）",
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
        help="cursor-agent 可执行文件路径（默认自动从 PATH 或 ~/.local/bin 查找）",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL,
        help=f"cursor-agent 模型（默认 {DEFAULT_MODEL}，即 Grok 4.7 256K High，非 Fast）",
    )
    parser.add_argument(
        "--round-timeout",
        type=int,
        default=None,
        help="可选：单轮最大超时秒数（默认不限制）",
    )
    parser.add_argument(
        "--approve-mcps",
        action="store_true",
        help="自动批准所有 MCP servers（传递给 cursor-agent --approve-mcps）",
    )
    parser.add_argument(
        "--log-dir",
        type=Path,
        default=None,
        help="每轮 stream-json 日志输出目录（默认 <workspace>/tmp）",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.max_rounds < 1:
        print("--max-rounds 必须 >= 1", file=sys.stderr)
        return 2

    workspace = args.workspace.resolve()
    if not workspace.is_dir():
        print(f"工作区目录不存在: {workspace}", file=sys.stderr)
        return 2

    try:
        agent_bin = resolve_cursor_agent_bin(args.agent_bin)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    log_dir = (
        args.log_dir.resolve()
        if args.log_dir is not None
        else workspace / "tmp"
    )
    log_dir.mkdir(parents=True, exist_ok=True)

    print(
        f"启动 GEO cursor-agent 串行循环 | max_rounds={args.max_rounds} | "
        f"model={args.model} | workspace={workspace} | agent_bin={agent_bin} | "
        f"log_dir={log_dir}",
        flush=True,
    )

    results: list[RoundResult] = []
    overall_exit = 0

    for round_index in range(1, args.max_rounds + 1):
        try:
            res = run_round(
                round_index=round_index,
                agent_bin=agent_bin,
                workspace=workspace,
                log_dir=log_dir,
                model=args.model,
                round_timeout=args.round_timeout,
                approve_mcps=args.approve_mcps,
            )
        except KeyboardInterrupt:
            print("\n收到中断信号，停止后续轮次。", file=sys.stderr, flush=True)
            overall_exit = 130
            break
        except Exception as exc:
            print(
                f"\n[第 {round_index} 轮] 启动或运行异常，停止后续轮次: {exc}",
                file=sys.stderr,
                flush=True,
            )
            overall_exit = 1
            break

        results.append(res)
        status_label = "成功" if res.success else "失败"
        print(
            f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
            f"=== 第 {res.round_index} 轮{status_label} | "
            f"session={res.session_id} | 耗时={res.duration_sec:.1f}s | "
            f"日志={res.log_file} ===",
            flush=True,
        )

        if not res.success:
            print(
                f"失败原因: {res.error_reason}\n"
                "根据串行失败即停策略，不再开始下一轮调用。",
                file=sys.stderr,
                flush=True,
            )
            overall_exit = 1
            break

    print(
        f"\n=== 执行汇总: 共完成 {len(results)} / {args.max_rounds} 轮，"
        f"成功 {sum(1 for r in results if r.success)} 轮 ===",
        flush=True,
    )
    return overall_exit


if __name__ == "__main__":
    raise SystemExit(main())
