# NanoClaude Architecture

NanoClaude is a small TypeScript coding-agent runtime. The implementation is intentionally direct: the goal is to make the control flow, safety checks, verification, and trace evidence easy to inspect.

## Flow

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

## LLM Provider Layer

The provider lives in `src/llm/openai-compatible.ts`.

It uses the OpenAI SDK against any OpenAI-compatible endpoint configured by:

- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

The agent loop only depends on a small `LLMProvider` interface:

```ts
interface LLMProvider {
  complete(messages: LLMMessage[]): Promise<string>;
}
```

That keeps provider concerns separate from tool execution and agent state.

## Agent Loop

The main loop lives in `src/agent/loop.ts`.

Responsibilities:

- load `nanoclaude.config.json`
- optionally load project rules
- build the system prompt
- call the model
- parse the JSON response
- execute requested tools
- append tool results back into the conversation
- track todo updates
- stop on final answer or max step limit
- write the session trace

The loop has a finite step limit controlled by `agent.maxSteps` or `--max-iterations`.

## JSON Protocol

NanoClaude does not use official OpenAI function calling. The model responds with plain JSON.

Final answer:

```json
{
  "type": "final",
  "content": "..."
}
```

Tool call:

```json
{
  "type": "tool_call",
  "tool": "read_file",
  "args": {
    "path": "package.json"
  }
}
```

Todo update:

```json
{
  "type": "todo_update",
  "id": "1",
  "status": "done"
}
```

This protocol is simple to inspect and easy to test, but it is less robust than a mature structured function-calling API.

## Tool Registry

The registry lives in `src/tools/index.ts`.

Registered tools:

- `read_file`
- `list_files`
- `glob`
- `grep`
- `bash`
- `edit_file`

Tools return:

```json
{
  "success": true,
  "output": "...",
  "error": null
}
```

Tool implementations receive a shared context containing the project root, permission policy, output limits, verification commands, timeout, and edit auto-approval flag.

## Path Safety

Path safety lives in `src/tools/path-safety.ts`.

Tools resolve paths relative to the project root and reject paths that escape it. This includes direct traversal attempts such as `../outside.txt`. Absolute paths are rejected for `edit_file`.

Search tools ignore `node_modules` and `dist` by default to reduce noise and avoid huge output.

## Edit Model

The `edit_file` tool lives in `src/tools/edit-file.ts`.

Input shape:

```json
{
  "path": "relative/path.ts",
  "oldText": "exact text to replace",
  "newText": "replacement text",
  "reason": "why this edit is needed"
}
```

Safety checks:

- path must resolve inside the project root
- absolute paths are rejected
- `oldText` must be non-empty
- `oldText` must exist
- `oldText` must appear exactly once
- only that exact occurrence is replaced
- a unified diff preview is generated before writing
- default writes require approval

For eval and CI workflows, `--auto-approve-edits` can auto-approve `edit_file` patches. That option only affects edit approval. It does not bypass path checks, unique-match validation, bash policy, or verification hooks.

## Permission System

The bash permission policy is defined by:

```ts
interface PermissionPolicy {
  allow: string[];
  confirm: string[];
  deny: string[];
}
```

Decision rules:

- deny rules take priority
- allow rules run without extra confirmation
- confirm rules ask for approval
- unknown commands default to confirm
- denied commands do not run

The matching logic is intentionally conservative and simple. It is not a full shell parser.

## Configuration

The config loader lives in `src/config.ts` and reads `nanoclaude.config.json` from the project root.

Supported fields:

- `verify.afterEdit`
- `verify.timeoutMs`
- `permissions.allowCommands`
- `permissions.confirmCommands`
- `permissions.denyCommands`
- `agent.maxSteps`
- `agent.maxToolOutputChars`

Missing config files use defaults. Partial configs are merged with defaults. Invalid field types produce clear errors.

## Verification Hooks

After a successful real edit, `edit_file` runs configured `verify.afterEdit` commands.

Verification commands:

- run from the project root
- use `verify.timeoutMs`
- go through the bash permission policy
- return structured stdout, stderr, exit code, timeout state, and error
- stop on the first failure

The verification result is included in the `edit_file` tool output so the model can attempt a follow-up repair.

## Plan Mode

Plan Mode is in-memory and lives inside the agent loop.

The model can produce todo lists and todo updates. The CLI prints lines such as:

```text
[todo] in_progress: Inspect project structure
[todo] done: Run npm run build
```

Todo events are also recorded in the session trace.

## Project Rules Loading

Project rules are loaded from the project root in priority order:

1. `NANOCLAUDE.md`
2. `AGENTS.md`
3. `CLAUDE.md`

Only the first matching file is loaded, and content is capped before being injected into the system prompt.

## Session Traces

Trace logging lives in `src/agent/session-trace.ts`.

Each run writes JSON under `.nanoclaude/sessions/`. The trace includes:

- session metadata
- user task
- loaded rules file, if any
- todo events
- legacy tool call/result arrays
- structured `steps`
- final answer or error status

Current `steps` event types:

- `model_message`
- `tool_call`
- `tool_result`
- `permission_decision`
- `edit_applied`
- `verification`
- `final`

Trace output is capped and redacted. Redaction covers obvious `.env`-style secrets, bearer tokens, variables containing `KEY`, `TOKEN`, `SECRET`, or `PASSWORD`, and long secret-looking values where practical.

## Local Eval Harness

The eval harness lives in `eval/run-eval.ts`.

It discovers twelve small local tasks under `eval/tasks`, copies each fixture repo into `eval/results/<run-id>/workspaces`, runs NanoClaude with edit auto-approval enabled only for those copied workspaces, runs each deterministic `check.js`, and prints a PASS/FAIL table with runtime metrics.

The table reports `Task`, `Result`, `Steps`, `ToolCalls`, `EditAttempts`, `Verification`, `FailureReason`, and `Trace`. Per-task summary JSON includes the extracted metrics, verification status, failure reason, and relative trace path.

The latest local eval run in this repository produced 12/12 with the configured model. Results remain model-dependent. This is a small local regression and demo harness, not SWE-bench and not a broad benchmark.

## Testing Strategy

Tests live in `tests/core.test.ts` and use Vitest.

The suite avoids real LLM calls. It covers:

- path safety
- filesystem tools
- search tools
- patch-style edit validation
- approval behavior
- bash permission decisions
- config loading
- verification hooks
- session trace redaction and event extraction
- eval harness utilities
- CLI option parsing

Filesystem tests use temporary directories so they do not depend on repository state.
