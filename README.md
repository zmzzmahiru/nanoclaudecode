# NanoClaude

NanoClaude is a lightweight Claude-Code-style coding agent CLI built in TypeScript, focused on safe local tool execution, patch-based editing, deterministic verification, auditable traces, and reproducible local evals.

It is not a clone of any commercial coding agent. It is a compact infrastructure project that exposes the moving parts behind a coding-agent runtime: model loop, JSON tool protocol, path safety, permission policy, diff-based edits, verification, traces, and local evaluation.

## Why NanoClaude?

Modern coding agents need more than chat completion. A useful local coding agent needs to inspect files, make narrowly scoped edits, run verification, ask before risky actions, and leave behind enough evidence to debug what happened.

NanoClaude exists to make those concerns explicit and readable:

- safe file editing through exact local replacements
- permission-gated shell execution
- project-level configuration
- verification after changes
- structured session traces
- redaction of obvious secrets
- small local eval tasks for repeatable demos

## Features

| Area | Implemented capability |
| --- | --- |
| CLI | TypeScript CLI with `npm run dev -- "task"` and packaged `nanoclaude` binary |
| Model API | OpenAI-compatible provider configured by `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` |
| Agent loop | JSON protocol for final answers, todo updates, and tool calls |
| Read tools | `read_file`, `list_files`, `glob`, and `grep` |
| Editing | `edit_file` uses `path`, `oldText`, `newText`, and `reason` |
| Edit safety | path sandboxing, exact unique `oldText` validation, unified diff preview, approval-gated writes |
| Eval/CI mode | explicit `--auto-approve-edits` for copied eval or CI workspaces |
| Bash tool | allow/confirm/deny `PermissionPolicy`, deny priority, unknown commands default to confirm |
| Config | `nanoclaude.config.json` for verification, permissions, and agent limits |
| Verification | successful real edits trigger configured `verify.afterEdit` commands |
| Traces | structured session trace events with capped and redacted output |
| Eval harness | five small local coding tasks with deterministic checkers under `eval/tasks` |
| Tests | Vitest suite for non-LLM core logic; currently 57 tests |

## Quick Start

Install dependencies:

```bash
npm install
```

Configure an OpenAI-compatible model. You can copy `.env.example` first:

```bash
cp .env.example .env
```

On Windows:

```powershell
copy .env.example .env
```

Set these variables:

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your_api_key_here
LLM_MODEL=your_model_here
```

Build and test:

```bash
npm run build
npm test
```

Run the CLI in development:

```bash
npm run dev -- "Inspect this project and summarize the agent architecture"
```

Run the local eval harness:

```bash
npm run eval
```

Latest release-readiness eval result from this repository:

```text
Success rate: 4/5
```

The Phase 5B release-audit rerun produced 4/5 because the configured model stopped early on `002-add-cli-flag`. This is a small local eval harness, not SWE-bench and not a broad benchmark.

## CLI Usage

```bash
nanoclaude [options] "your task here"
npm run dev -- [options] "your task here"
```

Options:

```text
--help                 Show help
--version              Show package version
--max-iterations <n>   Override the agent iteration limit
--no-hooks             Disable automatic after-edit verification hooks
--no-rules             Skip NANOCLAUDE.md / AGENTS.md / CLAUDE.md loading
--auto-approve-edits   Apply edit_file patches without prompting; intended for eval/CI workspaces
```

Examples:

```bash
npm run dev -- "Explain the tool registry"
npm run dev -- --max-iterations 30 "Fix the failing test"
npm run dev -- --no-rules "Summarize this repo without project rules"
npm run dev -- --auto-approve-edits "Run a controlled eval task in a temp workspace"
```

## Configuration

NanoClaude looks for `nanoclaude.config.json` in the project root. Missing fields are merged with defaults.

See [nanoclaude.config.example.json](nanoclaude.config.example.json) for a copyable example.

```json
{
  "verify": {
    "afterEdit": ["npm test", "npm run build"],
    "timeoutMs": 30000
  },
  "permissions": {
    "allowCommands": [
      "pwd",
      "ls",
      "cat",
      "grep",
      "find",
      "npm test",
      "npm run build",
      "npx tsc",
      "pytest"
    ],
    "confirmCommands": [
      "npm install",
      "pnpm install",
      "yarn install",
      "git checkout",
      "git commit",
      "git reset",
      "rm",
      "mv",
      "cp"
    ],
    "denyCommands": [
      "sudo",
      "ssh",
      "scp",
      "curl",
      "wget",
      "chmod 777",
      "chown"
    ]
  },
  "agent": {
    "maxSteps": 20,
    "maxToolOutputChars": 12000
  }
}
```

## Tool Model

NanoClaude tools return a structured result:

```json
{
  "success": true,
  "output": "...",
  "error": null
}
```

Main tools:

- `read_file`: reads a UTF-8 text file inside the project root.
- `list_files`: lists direct children of a project directory.
- `glob`: returns matching file paths under the project root, ignoring `node_modules` and `dist`.
- `grep`: searches text files and returns paths, line numbers, and snippets.
- `bash`: runs development commands from the project root through the permission policy.
- `edit_file`: applies one exact `oldText` to `newText` replacement after validation and approval.

## Safety Model

NanoClaude is designed to make local side effects explicit:

- `edit_file` uses exact `oldText` / `newText` local replacement.
- Absolute paths are rejected.
- Path traversal outside the project root is rejected.
- `oldText` must appear exactly once.
- A unified diff preview is shown before writes.
- Default write behavior requires approval.
- Non-interactive runs without approval reject edits rather than silently applying them.
- `--auto-approve-edits` is explicit and intended for eval/CI temp workspaces.
- `--auto-approve-edits` does not bypass path safety, unique-match validation, bash policy, or verification hooks.
- `bash` uses allow/confirm/deny command policy.
- Denied commands do not run.
- Unknown commands default to confirm.
- Tool output and traces redact obvious secret-like values where supported.

This is not production-grade sandboxing. It is a conservative local safety model for a small coding-agent framework.

## Verification Hooks

Successful real `edit_file` changes trigger configured `verify.afterEdit` commands.

Verification behavior:

- hooks run from the project root
- hooks use `verify.timeoutMs`
- commands go through the same bash allow/confirm/deny policy
- results include command, decision, exit code, stdout, stderr, timeout state, and error
- the first failing verification command stops later commands
- failed verification is returned to the agent so it can attempt a follow-up fix

No-op edits, rejected edits, missing `oldText`, and duplicate `oldText` do not trigger verification.

## Session Trace

Each run writes a JSON trace under `.nanoclaude/sessions/`. Trace output is capped and redacted.

Example event flow:

```text
model_message
tool_call
tool_result
permission_decision
edit_applied
verification
final
```

Trace events capture model messages, tool calls, tool results, bash permission decisions, edit outcomes, verification results, and final status. Edit trace events include whether a patch was manually approved, auto-approved, rejected, or not required.

## Local Eval Harness

The eval harness lives in `eval/`.

```text
eval/
  run-eval.ts
  tasks/
    001-fix-failing-test/
    002-add-cli-flag/
    003-update-readme/
    004-fix-type-error/
    005-add-unit-test/
```

`npm run eval`:

- discovers tasks under `eval/tasks`
- copies each fixture repo into `eval/results/<run-id>/workspaces`
- runs NanoClaude on `task.md`
- auto-approves `edit_file` patches only in those copied workspaces
- keeps bash allow/confirm/deny policy active
- runs each task's `check.js`
- reports PASS/FAIL, step count, and checker name
- saves summaries and traces under `eval/results/`

Latest release-readiness local run:

```text
Task                   Result   Steps   Verification
001-fix-failing-test   PASS     22      check.js
002-add-cli-flag       FAIL     10      check.js
003-update-readme      PASS     9       check.js
004-fix-type-error     PASS     17      check.js
005-add-unit-test      PASS     20      check.js

Success rate: 4/5
```

This eval is intentionally small and local, with deterministic checkers. It is useful for regression checks and demos, not for broad performance claims.

Eval success still depends on the configured model; the Phase 5B release-audit rerun produced 4/5.

## Architecture

```text
User task
  -> agent loop
  -> model call
  -> tool call validation
  -> permission/path safety
  -> tool execution
  -> edit verification
  -> trace/redaction
  -> final response
```

See [docs/architecture.md](docs/architecture.md) for more detail.

## Demo

See [docs/demo.md](docs/demo.md) for a terminal-style walkthrough showing a failing test fix, patch preview, approval behavior, verification, and trace output.

## Testing

```bash
npm run build
npm test
```

The test suite does not call a real LLM. It focuses on deterministic behavior: path safety, tool results, edit validation, bash permissions, config loading, trace redaction, eval harness utilities, and CLI parsing.

## Limitations

- The local eval harness is small.
- Success depends on the configured model.
- Shell command matching is conservative and simple; it is not a full shell parser.
- `edit_file` is exact string replacement, not a full multi-hunk patch parser.
- `--auto-approve-edits` is all-or-nothing for edit patches during a run.
- NanoClaude is not production-ready security sandboxing.

## Related Docs

- [Project summary](docs/project-summary.md)
- [Interview notes](docs/interview-notes.md)
- [Architecture](docs/architecture.md)
- [Demo transcript](docs/demo.md)
- [Roadmap](docs/roadmap.md)
- [Example prompts](examples/README.md)
- [Eval harness](eval/README.md)
- [Config example](nanoclaude.config.example.json)

## Resume-Friendly Summary

NanoClaude is a TypeScript coding-agent infrastructure project demonstrating LLM orchestration, JSON tool calling, safe patch-style editing, permission-controlled bash execution, configurable verification hooks, auditable redacted traces, CLI packaging, and a reproducible local eval harness.
