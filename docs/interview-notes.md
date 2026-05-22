# NanoClaude Interview Notes

## 2-Minute Explanation

NanoClaude is a lightweight coding-agent CLI written in TypeScript. It uses an OpenAI-compatible model API, but the interesting part is the agent infrastructure around the model: JSON tool calling, safe project-root file access, exact patch-style edits with diff previews, permission-controlled shell commands, config-driven verification after edits, redacted session traces, and a small local eval harness. The goal was to build a demonstrable coding-agent runtime that is safe enough to inspect locally and honest about its limitations.

## 5-Minute Technical Explanation

NanoClaude runs an agent loop that sends the task and current conversation to a model, expects JSON responses, executes requested tools, appends tool results back into the conversation, and stops on a final answer or max step limit. The model can use read/search tools, a permission-controlled `bash` tool, and a patch-style `edit_file` tool.

The edit path is intentionally narrow: `edit_file` takes `path`, `oldText`, `newText`, and `reason`. It rejects absolute paths and traversal, reads the target file, verifies `oldText` appears exactly once, generates a unified diff, and writes only after approval. For eval and CI-style copied workspaces, an explicit `--auto-approve-edits` flag can approve edit patches, but it does not bypass path checks, unique-match validation, bash permissions, or verification hooks.

Shell execution uses a deterministic allow/confirm/deny policy. Deny rules win, unknown commands default to confirm, and allowed verification commands can run from the project root. Project behavior is configurable through `nanoclaude.config.json`, including `verify.afterEdit`, timeouts, allowed/confirmed/denied commands, max steps, and output caps.

Every run writes a redacted session trace with model messages, tool calls, tool results, permission decisions, edit events, verification events, and final status. A local eval harness runs five small coding-agent tasks in isolated temp workspaces and checks results with `check.js`. The latest release-readiness eval was 4/5; the failed task was model behavior variability where the model stopped early.

## Key Design Decisions

### Patch Editing Instead Of Whole-File Overwrite

`oldText` / `newText` replacement keeps edits small and reviewable. Requiring a unique match prevents accidental broad replacement, and the diff preview makes side effects visible before writing.

### Allow / Confirm / Deny Bash Policy

Shell commands are useful for builds and tests, but risky. NanoClaude uses a simple deterministic policy: denied commands never run, allowed commands can run directly, confirm commands ask, and unknown commands default to confirm.

### Config-Driven Verification Hooks

Verification belongs in project configuration because different repositories have different checks. `verify.afterEdit` lets a project run commands such as `npm test` or `npm run build` after successful real edits.

### Trace And Redaction

Session traces make runs auditable. Redaction reduces accidental leakage of `.env` values, API keys, bearer tokens, passwords, and long secret-like strings.

### Eval-Only Auto Approval

Manual edit approval is the default. `--auto-approve-edits` exists so the local eval harness can run non-interactively inside copied temp workspaces. It only affects edit approval, not bash confirmation, deny rules, path safety, validation, or verification.

## Likely Interview Questions

### How do you prevent unsafe edits?

Edits are project-root scoped, absolute paths and traversal are rejected, `oldText` must appear exactly once, and NanoClaude shows a unified diff before writing. By default, writes require user approval.

### How do you prevent unsafe shell commands?

The `bash` tool uses an allow/confirm/deny policy. Deny rules take priority, denied commands do not run, and unknown commands default to confirm. Commands run from the project root with timeout and output caps.

### How do you verify edits?

Successful real edits trigger configured `verify.afterEdit` commands. These run through the bash permission policy and return structured results. If verification fails, the failure is returned to the agent so it can attempt a repair.

### How does eval work?

The eval harness discovers tasks under `eval/tasks`, copies each repo fixture into a temp results workspace, runs NanoClaude on `task.md`, runs the task's `check.js`, reports PASS/FAIL and step count, and saves summaries and traces.

### Why did the latest eval get 4/5 instead of 5/5?

The latest release-readiness run got 4/5 because the configured model inspected `002-add-cli-flag` and stopped early without applying an edit. It was not caused by edit approval rejection; auto-approval was active for eval temp workspaces. This is a useful reminder that the harness measures model behavior too.

### What are the limitations?

The eval is small and local, success depends on the model, command matching is not a full shell parser, edits are exact string replacements rather than a full patch engine, auto-approval is all-or-nothing for edit patches during a run, and this is not production-grade sandboxing.

### What would you build next?

Near-term improvements would be richer patch application, more eval tasks, resumable sessions, stronger command parsing, better isolation through a container/sandbox mode, and model/provider comparison using the same local tasks.

## Resume Bullets

- Built a lightweight TypeScript coding-agent CLI with OpenAI-compatible APIs, patch-based file editing, permission-gated shell execution, config-driven verification hooks, auditable traces, and a local eval harness.
- Designed safety controls including project-root path sandboxing, unique `oldText` validation, diff preview, allow/confirm/deny command policy, and secret redaction.
- Implemented a 5-task local coding-agent eval harness with isolated temp workspaces, checker-based PASS/FAIL scoring, saved traces, and a latest release-readiness result of 4/5.
