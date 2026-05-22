# NanoClaude Project Summary

NanoClaude is a lightweight TypeScript coding-agent CLI that demonstrates the infrastructure around a local AI coding agent: an OpenAI-compatible model loop, JSON tool calls, project-root-safe file access, patch-based editing, permission-gated shell commands, config-driven verification hooks, auditable session traces, redaction, and a small local eval harness.

## Core Problem

Simple chat wrappers can generate code, but they usually do not answer the harder engineering questions: how edits are scoped, how shell commands are approved, how changes are verified, how failures are recorded, and how behavior is evaluated. NanoClaude focuses on those agent-runtime concerns rather than on adding a large feature surface.

## Implemented Architecture

The runtime is organized around a JSON protocol agent loop:

```text
User task
  -> agent loop
  -> OpenAI-compatible model call
  -> JSON tool request
  -> tool registry
  -> path safety / permission policy
  -> tool execution
  -> verification hooks
  -> redacted session trace
  -> final response
```

Implemented tools include `read_file`, `list_files`, `glob`, `grep`, `bash`, and `edit_file`. Configuration is loaded from `nanoclaude.config.json` and covers agent step limits, tool output limits, command permissions, and after-edit verification commands.

## Safety Model

NanoClaude uses conservative local controls:

- project-root path sandboxing
- absolute path and traversal rejection for edits
- exact `oldText` / `newText` replacement instead of whole-file overwrite
- `oldText` must appear exactly once
- unified diff preview before writes
- approval-gated edits by default
- explicit `--auto-approve-edits` only for eval/CI-style temp workspaces
- allow/confirm/deny bash policy with deny priority
- unknown shell commands default to confirm
- trace and output redaction for obvious secret-like values

This is not production-grade sandboxing; it is a clear, auditable safety model for a small local agent.

## Verification Loop

Successful real edits trigger `verify.afterEdit` commands from `nanoclaude.config.json`. Verification runs from the project root through the same bash permission policy. Results include command, decision, exit code, stdout, stderr, timeout state, and error. The first failing verification command stops later hooks and returns failure details to the agent for possible repair.

## Eval Harness

The local eval harness under `eval/` runs twelve small local coding-agent tasks with deterministic checkers in copied temporary workspaces:

- fix a failing test
- add a CLI flag
- update README content
- fix a type error
- add a unit test
- make a multi-file CLI change
- repair after verification output
- follow project rules from `NANOCLAUDE.md`
- prove trace completeness
- refuse unsafe outside-root access
- enforce denied command policy
- reject duplicate `oldText` edits before refining

Each task has a `check.js` checker that produces PASS/FAIL. The harness records richer runtime metrics: steps, tool calls, edit attempts, verification status, failure reason, and trace path. Per-task summary JSON also includes the extracted metrics and relative trace path.

The latest local eval run reached 12/12. Results are still model-dependent; this is a small local eval harness, not a broad benchmark.

## What Makes It More Than An API Wrapper

NanoClaude is not just a call to an LLM API. It implements the operational pieces around the model: controlled tool access, safe patch application, deterministic permission decisions, config-driven verification, traceability, redaction, and local eval scoring. Those pieces are what turn model output into a coding-agent workflow that can be inspected and improved.

## Honest Limitations

- The eval harness is small and local.
- Success depends on the configured model.
- Shell command matching is conservative and simple, not a full shell parser.
- `edit_file` is exact string replacement, not a full multi-hunk patch parser.
- `--auto-approve-edits` is all-or-nothing for edit patches during a run.
- NanoClaude does not provide production-grade sandboxing.
- NanoClaude does not claim Claude Code equivalence, SWE-bench performance, or broad benchmark results.

## Resume Bullets

- Built a lightweight TypeScript coding-agent CLI with OpenAI-compatible APIs, patch-based file editing, permission-gated shell execution, config-driven verification hooks, auditable traces, and a local eval harness.
- Designed safety controls including project-root path sandboxing, unique `oldText` validation, diff preview, allow/confirm/deny command policy, and secret redaction.
- Implemented a 12-task local coding-agent eval harness with isolated temp workspaces, checker-based PASS/FAIL scoring, runtime metrics, saved traces, and a latest local result of 12/12.
