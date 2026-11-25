#!/usr/bin/env python3
"""Run the dispatcher against a temporary Git origin and stand-ins for gh and the agents."""

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


LOOP = Path(__file__).with_name("run-issue-loop.py").resolve()

FAKE_CLI = r'''
from datetime import datetime, timezone
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

control = Path(os.environ["ISSUE_LOOP_TEST_CONTROL"])
scenario = os.environ["ISSUE_LOOP_TEST_SCENARIO"]
state_file = control / "github.json"
state = json.loads(state_file.read_text())
issue_number = state["target"]["number"]

if Path(sys.argv[0]).name == "gh":
    if sys.argv[1] == "api":
        # The first page only contains a PR. The open Issue must come from page two.
        print(json.dumps([[{"pull_request": {}}], state["open"]]))
    elif sys.argv[1:4] == ["issue", "view", str(issue_number)]:
        print(json.dumps(state["target"]))
    else:
        sys.exit(2)
    sys.exit(0)

cli_name = Path(sys.argv[0]).name
is_codex = cli_name == "codex" and sys.argv[1] == "exec"
is_agy = cli_name == "agy"
if is_codex:
    (control / "codex-args.json").write_text(json.dumps(sys.argv[1:-1]))
    print(json.dumps({"type": "thread.started", "thread_id": "test-codex-session"}), flush=True)
    print(json.dumps({"type": "turn.started"}), flush=True)
elif is_agy:
    (control / "agy-args.json").write_text(json.dumps(sys.argv[1:-1]))
    print(json.dumps({"event": "init", "conversation_id": "test-agy-session", "init": {"model": "gemini-4-hydrogen-high"}}), flush=True)
elif sys.argv[1] == "create-chat":
    print("test-session")
    sys.exit(0)

prompt = sys.argv[-1]
assert "启动者已运行交付模式，明确授权本轮" in prompt
is_backlog = "最多新建 Issue：" in prompt
if is_backlog:
    limit = re.search(r"最多新建 Issue：(\d+)", prompt)[1]
    assert f"新建至多 {limit} 个符合条件的 status:ready Issue" in prompt
else:
    assert f"可在目标 Issue #{issue_number} 发布验收评论" in prompt
    assert "普通推送至 origin/main" in prompt
with (control / "rounds").open("a") as rounds:
    rounds.write(("backlog" if is_backlog else "dev") + "\n")
(control / "agent.pid").write_text(str(os.getpid()))
print("null", flush=True)
if scenario == "slow":
    time.sleep(30)
if scenario == "orphan-helper":
    helper = """
import signal
import sys
import time
from pathlib import Path

control = Path(sys.argv[1])
def stop(*_):
    (control / 'helper.stopped').touch()
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
(control / 'helper.ready').touch()
time.sleep(30)
"""
    subprocess.Popen([sys.executable, "-c", helper, str(control)])
    deadline = time.monotonic() + 5
    while not (control / "helper.ready").exists() and time.monotonic() < deadline:
        time.sleep(0.01)


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


marker = re.search(r"<!-- geopro-loop:[0-9a-f]+ -->", prompt)[0]
reply = "已执行本轮检查。详情见工单评论。"
if is_backlog:
    if scenario in {"backlog-created", "backlog-foreign", "backlog-reopened", "backlog-over-limit"}:
        opened = {
            "number": 132, "title": "fixture issue", "labels": [{"name": "status:ready"}],
            "created_at": ("2020-01-01T00:00:00Z" if scenario == "backlog-reopened"
                           else datetime.now(timezone.utc).isoformat()),
            "body": "someone else's issue" if scenario == "backlog-foreign" else marker,
        }
        state["open"].append(opened)
        if scenario == "backlog-over-limit":
            state["open"].append({**opened, "number": 133})
else:
    first_prose_round = scenario == "pushed-with-prose" and not Path("change.txt").exists()
    if scenario in {"pushed", "unpushed", "wrong-commit-issue"} or first_prose_round:
        Path("change.txt").write_text("fixture change")
        git("add", "change.txt")
        commit_issue = 999 if scenario == "wrong-commit-issue" else issue_number
        git("commit", "-m", f"feat: fixture change (#{commit_issue})")
        if scenario != "unpushed":
            git("push", "origin", "main")
    keep_open = {
        "pushed", "unpushed", "wrong-commit-issue", "claim-sync", "acceptance-progress",
        "stale-comment", "old-comment", "not-closed", "wrong-version", "blocked",
    }
    if scenario not in keep_open and not first_prose_round:
        state["open"] = []
        state["target"]["state"] = "CLOSED"
        state["target"]["stateReason"] = "NOT_PLANNED" if scenario == "closed-not-planned" else "COMPLETED"
    if scenario == "dirty":
        Path("unfinished.txt").write_text("uncommitted agent work")
    if scenario == "blocked":
        blocker = {"name": "status:blocked"}
        state["target"]["labels"].append(blocker)
        state["open"][0]["labels"].append(blocker)
    if scenario == "stale-comment":
        marker = "<!-- geopro-loop:old -->"
    if scenario not in {"claim-sync", "blocked", "closed-without-evidence"}:
        version = "0" * 40 if scenario == "wrong-version" else git("rev-parse", "HEAD")
        comments = state["target"]["comments"]
        comments.append({
            "url": f"https://example.test/owner/repo/issues/{issue_number}#issuecomment-{len(comments) + 1}",
            "body": f"已核对本轮验收。版本为 {version}。\n{marker}",
            "createdAt": ("2020-01-01T00:00:00Z" if scenario == "old-comment"
                          else datetime.now(timezone.utc).isoformat()),
        })
    if scenario == "pushed-with-prose":
        reply += "\n\nloop-round:\nunblock: none后面还有补充说明。\n\n下一轮可继续核对。"

state_file.write_text(json.dumps(state))
if is_codex:
    print(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": reply}}))
    event_type = "turn.failed" if scenario == "codex-failed" else "turn.completed"
    print(json.dumps({"type": event_type}), end="", flush=True)
elif is_agy:
    print(json.dumps({"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": reply}}))
    if scenario == "agy-failed":
        print(json.dumps({"event": "result", "result": {"conversation_id": "test-agy-session", "status": "ERROR", "response": "", "error": "fixture agy error"}}), end="", flush=True)
    else:
        print(json.dumps({"event": "result", "result": {"conversation_id": "test-agy-session", "status": "SUCCESS", "response": reply}}), end="", flush=True)
elif scenario != "no-result":
    print(json.dumps({"type": "result", "subtype": "success", "result": reply}), end="", flush=True)
'''


class IssueLoopTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="geopro-issue-loop-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.workspace = self.root / "checkout"
        self.logs = self.root / "logs"
        self.origin = self.root / "origin.git"
        self.env = {
            **os.environ,
            "PATH": f"{self.root}{os.pathsep}{os.environ['PATH']}",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "Fixture",
            "GIT_AUTHOR_EMAIL": "fixture@example.test",
            "GIT_COMMITTER_NAME": "Fixture",
            "GIT_COMMITTER_EMAIL": "fixture@example.test",
            "ISSUE_LOOP_TEST_CONTROL": str(self.root),
        }
        self.git("init", "--bare", "-b", "main", str(self.origin), cwd=self.root)
        self.git("clone", str(self.origin), str(self.workspace), cwd=self.root)
        (self.workspace / ".gitignore").write_text("/tmp\n")
        self.git("add", ".gitignore")
        self.git("commit", "-m", "Fixture baseline")
        self.git("push", "origin", "main")

        for name in ("gh", "cursor-agent", "codex", "agy"):
            executable = self.root / name
            executable.write_text(f"#!{sys.executable}\n" + FAKE_CLI, encoding="utf-8")
            executable.chmod(0o700)
        labels = [{"name": "status:ready"}, {"name": "milestone:M0"}]
        (self.root / "github.json").write_text(json.dumps({
            "open": [{"number": 131, "title": "Fixture", "labels": labels, "created_at": "2020-01-01T00:00:00Z"}],
            "target": {"number": 131, "state": "OPEN", "stateReason": "REOPENED", "labels": labels, "comments": []},
        }), encoding="utf-8")

    def git(self, *args, cwd=None):
        return subprocess.run(
            ["git", *args], cwd=cwd or self.workspace, env=self.env,
            check=True, capture_output=True, text=True, timeout=10,
        ).stdout.strip()

    def command(self, *args, max_rounds=1, agent="cursor"):
        round_options = ["--max-rounds", str(max_rounds)] if max_rounds is not None else []
        agent_options = ["--agent", agent] if agent is not None else []
        return [
            sys.executable, str(LOOP), "--workspace", str(self.workspace),
            "--log-dir", str(self.logs), "--skip-preflight", "--max-consecutive-failures", "1",
            *agent_options, *round_options, *args,
        ]

    def summary(self):
        return json.loads(max(self.logs.glob("loop-summary-*.json")).read_text())

    def run_loop(self, scenario, *args, expected_exit=0, max_rounds=1, agent="cursor"):
        proc = subprocess.run(
            self.command(*args, max_rounds=max_rounds, agent=agent),
            env={**self.env, "ISSUE_LOOP_TEST_SCENARIO": scenario},
            capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(proc.returncode, expected_exit, proc.stdout + proc.stderr)
        return proc

    def test_accepts_pushed_issue_commit_with_current_evidence(self):
        proc = self.run_loop("pushed", "--target-dev-commits", "1")
        summary = self.summary()
        self.assertIn("timeout=不限时", proc.stdout)
        self.assertEqual(summary["dev_commits"], 1)
        self.assertEqual(summary["rounds"][0]["after_head"], self.git("rev-parse", "origin/main"))

    def test_default_codex_dispatch_uses_full_access_and_records_reply(self):
        self.run_loop("pushed", "--target-dev-commits", "1", agent=None)
        self.assertEqual(json.loads((self.root / "codex-args.json").read_text()), [
            "exec", "--json", "--model", "gpt-6.2-sol",
            "--sandbox", "danger-full-access", "-c", 'approval_policy="never"',
            "-c", 'model_reasoning_effort="high"',
        ])
        summary = self.summary()
        self.assertEqual(summary["agent"], "codex")
        self.assertEqual(summary["dev_commits"], 1)
        result, = summary["rounds"]
        self.assertEqual(result["session_id"], "test-codex-session")
        self.assertEqual(result["outcome"], "progressed")
        self.assertEqual(result["result_text"], "已执行本轮检查。详情见工单评论。")

    def test_dry_run_plans_without_dispatch(self):
        proc = self.run_loop("pushed", "--dry-run", agent=None)
        self.assertIn("第 1 轮计划 dev，目标 #131", proc.stdout)
        self.assertFalse((self.root / "rounds").exists())

    def test_codex_turn_failed_is_not_accepted_even_with_zero_exit(self):
        self.run_loop("codex-failed", agent="codex", expected_exit=1)
        result, = self.summary()["rounds"]
        self.assertEqual(result["exit_code"], 0)
        self.assertFalse(result["success"])
        self.assertIn("turn.failed", result["error_reason"])

    def test_agy_dispatch_uses_session_defaults_and_records_reply(self):
        self.run_loop("pushed", "--target-dev-commits", "1", agent="agy")
        self.assertEqual(json.loads((self.root / "agy-args.json").read_text()), [
            "--output-format", "stream-json",
            "--model", "gemini-4-hydrogen-high",
            "--effort", "high",
            "--dangerously-skip-permissions",
            "--print",
        ])
        summary = self.summary()
        self.assertEqual(summary["agent"], "agy")
        self.assertEqual(summary["model"], "gemini-4-hydrogen-high")
        self.assertEqual(summary["reasoning_effort"], "high")
        self.assertEqual(summary["dev_commits"], 1)
        result, = summary["rounds"]
        self.assertEqual(result["session_id"], "test-agy-session")
        self.assertEqual(result["outcome"], "progressed")
        self.assertEqual(result["result_text"], "已执行本轮检查。详情见工单评论。")

    def test_agy_result_error_is_not_accepted_even_with_zero_exit(self):
        self.run_loop("agy-failed", agent="agy", expected_exit=1)
        result, = self.summary()["rounds"]
        self.assertEqual(result["exit_code"], 0)
        self.assertFalse(result["success"])
        self.assertIn("fixture agy error", result["error_reason"])

    def test_agy_custom_model_omits_conflicting_default_effort(self):
        self.run_loop("acceptance", "--model", "gemini-3.8-flash-medium", agent="agy")
        self.assertEqual(json.loads((self.root / "agy-args.json").read_text()), [
            "--output-format", "stream-json",
            "--model", "gemini-3.8-flash-medium",
            "--dangerously-skip-permissions",
            "--print",
        ])
        self.assertIsNone(self.summary()["reasoning_effort"])

    def test_agy_rejects_approve_mcps(self):
        proc = self.run_loop("acceptance", "--approve-mcps", agent="agy", expected_exit=2)
        self.assertIn("--approve-mcps 仅支持 --agent cursor", proc.stderr)

    def test_continues_after_a_pushed_commit_with_extra_reply_text(self):
        self.run_loop("pushed-with-prose", "--prompt-mode", "dev", "--max-rounds", "2")
        summary = self.summary()
        first, second = summary["rounds"]
        self.assertEqual(summary["dev_commits"], 1)
        self.assertEqual(first["outcome"], "progressed")
        self.assertIn("none后面还有补充说明。", first["result_text"])
        self.assertEqual(second["outcome"], "done")
        self.assertEqual(second["issues_closed"], [131])

    def test_accepts_current_evidence_without_final_reply(self):
        self.run_loop("no-result")
        result, = self.summary()["rounds"]
        self.assertEqual(result["outcome"], "done")
        self.assertIsNone(result["result_text"])

    def test_sync_alone_does_not_count_as_development(self):
        upstream = self.root / "upstream"
        self.git("clone", str(self.origin), str(upstream), cwd=self.root)
        self.git("commit", "--allow-empty", "-m", "Upstream delivery (#131)", cwd=upstream)
        self.git("push", "origin", "main", cwd=upstream)
        self.run_loop("claim-sync", expected_exit=1)
        summary = self.summary()
        self.assertEqual(summary["dev_commits"], 0)
        self.assertEqual(summary["rounds"][0]["before_head"], self.git("rev-parse", "HEAD"))

    def test_unpushed_commit_is_preserved_and_stops_dispatch(self):
        self.run_loop("unpushed", "--max-rounds", "3", expected_exit=1)
        summary = self.summary()
        self.assertEqual(summary["dev_commits"], 0)
        self.assertEqual(len(summary["rounds"]), 1)
        self.assertIn("尚未包含本轮提交", summary["rounds"][0]["error_reason"])
        self.assertNotEqual(self.git("rev-parse", "HEAD"), self.git("rev-parse", "origin/main"))

    def test_accepts_completed_pure_verification_without_commit(self):
        self.run_loop("acceptance")
        summary = self.summary()
        self.assertEqual(summary["dev_commits"], 0)
        self.assertEqual(summary["rounds"][0]["issues_closed"], [131])

    def test_accepts_partial_verification_and_rotates_at_issue_limit(self):
        self.run_loop("acceptance-progress", "--prompt-mode", "dev",
                      "--max-same-issue-rounds", "1", "--max-rounds", "2")
        summary = self.summary()
        result, = summary["rounds"]
        self.assertTrue(result["success"])
        self.assertEqual(result["outcome"], "progressed")
        self.assertIn("131", summary["skipped_issues"])

    def test_default_limits_allow_thirty_verified_rounds_on_issue_135(self):
        state_file = self.root / "github.json"
        state = json.loads(state_file.read_text())
        state["open"][0]["number"] = state["target"]["number"] = 135
        state_file.write_text(json.dumps(state))
        self.run_loop("acceptance-progress", "--prompt-mode", "dev", max_rounds=None, agent=None)
        summary = self.summary()
        self.assertEqual(summary["max_rounds"], 30)
        self.assertEqual(summary["max_same_issue_rounds"], 30)
        self.assertEqual(
            [(row["target_issue"], row["outcome"]) for row in summary["rounds"]],
            [(135, "progressed")] * 30,
        )
        self.assertNotIn("135", summary["skipped_issues"])

    def test_counts_new_evidence_on_open_issue_as_progress(self):
        self.run_loop("not-closed")
        result, = self.summary()["rounds"]
        self.assertEqual(result["outcome"], "progressed")
        self.assertEqual(result["issues_closed"], [])

    def test_does_not_count_closure_without_current_evidence(self):
        self.run_loop("closed-without-evidence")
        result, = self.summary()["rounds"]
        self.assertEqual(result["outcome"], "skipped")
        self.assertEqual(result["issues_closed"], [])

    def test_recognizes_github_blocked_state_without_evidence(self):
        self.run_loop("blocked")
        result, = self.summary()["rounds"]
        self.assertEqual(result["outcome"], "blocked")

    def test_rejects_noncompletion_closure(self):
        self.run_loop("closed-not-planned", expected_exit=1)
        self.assertEqual(self.summary()["rounds"][0]["issues_closed"], [])

    def test_rejects_commit_for_wrong_issue(self):
        self.run_loop("wrong-commit-issue", expected_exit=1)
        self.assertIn("没有关联目标 Issue", self.summary()["rounds"][0]["error_reason"])

    def test_rejects_comment_with_wrong_version(self):
        self.run_loop("wrong-version", expected_exit=1)
        self.assertIn("核验版本", self.summary()["rounds"][0]["error_reason"])

    def test_rejects_old_comment_as_current_evidence(self):
        for scenario in ("stale-comment", "old-comment"):
            with self.subTest(scenario=scenario):
                proc = self.run_loop(scenario, expected_exit=1)
                self.assertIn("本轮标记", proc.stderr)

    def test_counts_only_verified_backlog_issues(self):
        self.run_loop("backlog-created", "--prompt-mode", "backlog")
        self.assertEqual(self.summary()["rounds"][0]["issues_created"], [132])

    def test_excludes_issues_created_by_other_work(self):
        self.run_loop("backlog-foreign", "--prompt-mode", "backlog")
        self.assertEqual(self.summary()["issues_created_total"], 0)

    def test_excludes_reopened_issue_from_new_issues(self):
        self.run_loop("backlog-reopened", "--prompt-mode", "backlog")
        self.assertEqual(self.summary()["issues_created_total"], 0)

    def test_rejects_backlog_over_the_limit(self):
        self.run_loop("backlog-over-limit", "--prompt-mode", "backlog",
                      "--replenish-count", "1", expected_exit=1)
        self.assertEqual(self.summary()["issues_created_total"], 0)

    def test_empty_backlog_attempt_does_not_starve_ready_issue(self):
        self.run_loop("acceptance", "--min-backlog", "2", "--max-replenishes", "1", "--max-rounds", "2")
        summary = self.summary()
        self.assertEqual(summary["backlog_attempts"], 1)
        self.assertEqual([row["mode"] for row in summary["rounds"]], ["backlog", "dev"])

    def test_stops_at_existing_local_changes(self):
        pending = self.workspace / "keep.txt"
        pending.write_text("user work")
        self.run_loop("acceptance", "--allow-dirty-start", expected_exit=2)
        self.assertEqual(pending.read_text(), "user work")
        self.assertFalse((self.root / "rounds").exists())

    def test_preserves_agent_changes_by_default(self):
        self.run_loop("dirty", "--max-rounds", "3", expected_exit=1)
        self.assertTrue((self.workspace / "unfinished.txt").is_file())
        self.assertEqual(len(self.summary()["rounds"]), 1)
        self.assertEqual(self.git("stash", "list"), "")

    def test_quarantines_changes_only_when_enabled(self):
        self.run_loop("dirty", "--quarantine-dirty", expected_exit=1)
        summary = self.summary()
        label = summary["rounds"][0]["quarantine_stash"]
        self.assertIn(label, self.git("stash", "list"))
        self.assertIn(label, summary["skipped_issues"]["131"])
        self.assertFalse((self.workspace / "unfinished.txt").exists())

    def test_run_logs_can_live_in_ignored_workspace_directory(self):
        log_dir = self.workspace / "tmp"
        self.run_loop("acceptance", "--log-dir", str(log_dir))
        self.assertTrue(list(log_dir.glob("loop-summary-*.json")))
        self.assertFalse(self.git("status", "--porcelain"))

    def test_cleans_up_helper_when_agent_exits(self):
        self.run_loop("orphan-helper")
        self.assertTrue((self.root / "helper.stopped").exists())

    def test_explicit_timeout_terminates_agent(self):
        self.run_loop("slow", "--round-timeout", "1", expected_exit=1)
        self.assertIn("超过 1 秒", self.summary()["rounds"][0]["error_reason"])
        with self.assertRaises(ProcessLookupError):
            os.kill(int((self.root / "agent.pid").read_text()), 0)

    def assert_stops_agent_and_releases_lock(self, signum):
        with subprocess.Popen(
            self.command(), env={**self.env, "ISSUE_LOOP_TEST_SCENARIO": "slow"},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True,
        ) as running:
            try:
                pid_file = self.root / "agent.pid"
                deadline = time.monotonic() + 8
                while not pid_file.exists() and running.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertTrue(pid_file.exists())
                self.assertIsNone(self.summary()["overall_exit"])
                duplicate = self.run_loop("acceptance", expected_exit=2)
                self.assertIn("已经有 Issue 循环在运行", duplicate.stderr)
                running.send_signal(signum)
                output, _ = running.communicate(timeout=8)
                self.assertEqual(running.returncode, 128 + signum, output)
                summary = self.summary()
                self.assertEqual(summary["overall_exit"], 128 + signum)
                self.assertEqual(summary["rounds"][0]["interrupt_signal"], signum)
                self.assertTrue(Path(summary["rounds"][0]["log_file"]).exists())
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(pid_file.read_text()), 0)
            finally:
                if running.poll() is None:
                    running.send_signal(signal.SIGINT)
                    running.wait(timeout=8)
        self.run_loop("acceptance")

    def test_ctrl_c_terminates_agent_and_releases_workspace_lock(self):
        self.assert_stops_agent_and_releases_lock(signal.SIGINT)

    def test_sigterm_terminates_agent_and_releases_workspace_lock(self):
        self.assert_stops_agent_and_releases_lock(signal.SIGTERM)


if __name__ == "__main__":
    unittest.main()
