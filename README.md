# NanoClaude

NanoClaude is a lightweight AI coding agent framework written in TypeScript.

This first version is intentionally small: it provides a Node.js + TypeScript project, a CLI entry point, an OpenAI-compatible LLM provider (supporting models like OpenAI, DeepSeek, and others via compatible APIs), and a minimal JSON-based agent loop with read-only filesystem tools.

## Current Status

NanoClaude is currently at **v10 (CLI Packaging and Polish)**, implementing a full-featured agent loop with:

- OpenAI-compatible LLM provider support (including DeepSeek, etc.)
- Read-only filesystem tools: `read_file`, `list_files`, `glob`, `grep`
- Permission-controlled bash execution (`bash` tool)
- Safe file editing with diff preview (`edit_file` tool)
- In-memory todo list for complex multi-step tasks (`todo_list`, `todo_update`)
- Project-level markdown rules loaded from `NANOCLAUDE.md`, `AGENTS.md`, or `CLAUDE.md`
- Auditable JSON session traces saved under `.nanoclaude/sessions`
- A hardcoded `after_edit` hook that suggests `npm run build` after successful edits
- A lightweight Vitest suite for core non-LLM behavior
- A packaged `nanoclaude` CLI with help, version, iteration, hook, and rules flags

The project builds successfully, has automated tests, and can run tasks via the CLI. Future work includes adding richer conversation state, configurable hooks, broader tests, and npm publishing polish.

## Quick Start

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

> On Windows, use `copy .env.example .env` instead.

Set your model provider values in `.env`. For OpenAI:

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your_api_key_here
LLM_MODEL=gpt-4.1-mini
```

For DeepSeek via its OpenAI-compatible API:

```bash
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=your_deepseek_api_key_here
LLM_MODEL=deepseek-chat
```

Run a task:

```bash
npm run dev -- "Explain how to create a small TypeScript CLI"
```

After building, run the packaged CLI:

```bash
npm run build
node dist/index.js "Explain how to create a small TypeScript CLI"
```

NanoClaude sends the task to the configured model and prints the response.

## CLI Usage

```bash
nanoclaude [options] "your task here"
```

During local development, the same options work through `npm run dev`:

```bash
npm run dev -- --max-iterations 30 "Inspect the project and summarize it"
```

Options:

```text
--help                 Show help
--version              Show package version
--max-iterations <n>   Override the agent iteration limit
--no-hooks             Disable automatic hooks such as after_edit build checks
--no-rules             Skip NANOCLAUDE.md / AGENTS.md / CLAUDE.md loading
```

Examples:

```bash
node dist/index.js --help
node dist/index.js --version
node dist/index.js --no-rules "Explain this repository"
node dist/index.js --no-hooks "Edit README.md but do not auto-run build"
```

## v1 Tool Calling

NanoClaude v1 uses a simple JSON protocol instead of official OpenAI function calling. The model can either return a final answer:

```json
{
  "type": "final",
  "content": "..."
}
```

Or request one read-only tool call:

```json
{
  "type": "tool_call",
  "tool": "read_file",
  "args": {
    "path": "package.json"
  }
}
```

```json
{
  "type": "tool_call",
  "tool": "list_files",
  "args": {
    "path": "."
  }
}
```

NanoClaude executes the tool, appends a JSON tool result back into the conversation, and continues until the model returns `type: "final"` or the loop reaches the iteration limit (default: 20 iterations, with a warning injected 3 iterations before the limit).

Example:

```bash
npm run dev -- "List the project files, then summarize what this project does"
```

## v2 Codebase Search

NanoClaude v2 adds codebase search tools so the agent can explore before reading specific files.

Find files with `glob`:

```json
{
  "type": "tool_call",
  "tool": "glob",
  "args": {
    "pattern": "src/**/*.ts"
  }
}
```

Search text files with `grep`:

```json
{
  "type": "tool_call",
  "tool": "grep",
  "args": {
    "pattern": "OpenAICompatibleProvider",
    "path": "src"
  }
}
```

Both tools stay inside the project root, ignore `node_modules` and `dist` by default, and return `{ success, output, error }`.

Examples:

```bash
npm run dev -- "Find where the OpenAI-compatible provider is implemented"
npm run dev -- "Use glob to list TypeScript source files, then summarize the project layout"
```

## v3 Permission-Controlled Bash

NanoClaude v3 adds a `bash` tool for development commands. Before any command runs, NanoClaude prints the command and asks for approval with `y/N`.

```json
{
  "type": "tool_call",
  "tool": "bash",
  "args": {
    "command": "npm run build",
    "cwd": "."
  }
}
```

If the command is rejected, the tool returns:

```json
{
  "success": false,
  "output": "",
  "error": "Command rejected by user."
}
```

The tool keeps `cwd` inside the project root, rejects obvious high-risk commands, times out long-running commands, and caps stdout/stderr before returning results to the model.

Example:

```bash
npm run dev -- "Run the build and explain any TypeScript errors"
```

## v4 Safe File Editing

NanoClaude v4 adds an `edit_file` tool. It reads the original file, prepares either a targeted replacement or a full overwrite, prints a unified diff preview, and writes only after approval with `y/N`.

Replace one exact text block:

```json
{
  "type": "tool_call",
  "tool": "edit_file",
  "args": {
    "path": "README.md",
    "oldText": "old text",
    "newText": "new text"
  }
}
```

Overwrite a file:

```json
{
  "type": "tool_call",
  "tool": "edit_file",
  "args": {
    "path": "README.md",
    "content": "full new file content"
  }
}
```

Replacement mode fails if `oldText` is missing or appears more than once. The edit path must stay inside the project root.

Example:

```bash
npm run dev -- "Update the README roadmap to mention safe file editing"
```

## v5 Plan Mode

NanoClaude v5 adds an in-memory todo list for complex tasks. The model can first produce a short plan:

```json
{
  "type": "todo_list",
  "todos": [
    {
      "id": "1",
      "content": "Inspect project structure",
      "status": "in_progress"
    },
    {
      "id": "2",
      "content": "Make the requested change",
      "status": "pending"
    },
    {
      "id": "3",
      "content": "Run npm run build",
      "status": "pending"
    }
  ]
}
```

As work progresses, the model can update individual todos:

```json
{
  "type": "todo_update",
  "id": "1",
  "status": "done"
}
```

Todo state is stored only for one agent run. The CLI prints progress as it changes:

```text
[todo] in_progress: Inspect project structure
[todo] done: Run npm run build
```

Example:

```bash
npm run dev -- "Add a new tool, update docs, and run the build"
```

## v6 Project Rules

NanoClaude v6 loads project-level rules from markdown files in the project root. It checks files in this priority order and loads only the first match:

1. `NANOCLAUDE.md`
2. `AGENTS.md`
3. `CLAUDE.md`

Loaded rule content is capped before being injected into the system prompt. When rules are found, the CLI prints:

```text
[rules] loaded NANOCLAUDE.md
```

Example `NANOCLAUDE.md`:

```markdown
# Project Rules

- Keep changes small and readable.
- Run npm run build after code changes.
- Ask before running commands or editing files.
```

Example:

```bash
npm run dev -- "Follow the project rules and add a small README update"
```

## v7 Session Trace Logging

NanoClaude v7 saves an auditable JSON trace for each agent run in `.nanoclaude/sessions`.

Each session file includes:

- `sessionId`, `startedAt`, `endedAt`, and `status`
- the user task
- the loaded rules file, when present
- todo events
- tool calls
- capped/summarized tool results
- the final answer, or error information

The trace logger avoids storing huge tool outputs, redacts common secret-looking values, and does not intentionally store `.env` contents or API keys.

At the end of a run, the CLI prints:

```text
[session] saved .nanoclaude/sessions/<id>.json
```

Example:

```bash
npm run dev -- "Inspect the project and explain what changed recently"
```

## v8 Hooks / Auto Verification

NanoClaude v8 adds a small hardcoded hook system. When `edit_file` succeeds, NanoClaude proposes a verification command from the project root:

```text
[hook] after_edit: npm run build
```

The hook reuses the existing `bash` tool, so it still asks for `y/N` approval and still records stdout, stderr, and exit code in capped form. Hook-triggered bash calls and results are also saved in the session trace with `source: "hook"`.

The hook does not trigger another hook, which keeps verification from looping forever.

Example:

```bash
npm run dev -- "Edit the README and verify the project still builds"
```

## v9 Basic Automated Tests

NanoClaude v9 adds a lightweight Vitest suite for core logic that does not call the real LLM API.

Run tests once:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

The current tests cover path safety, read/list/search tools, edit validation, session trace redaction, and the `after_edit` hook path.

## v10 CLI Packaging and Polish

NanoClaude v10 adds a proper executable entrypoint and package bin:

```json
{
  "bin": {
    "nanoclaude": "dist/index.js"
  }
}
```

The built CLI includes a shebang and supports `--help`, `--version`, `--max-iterations <n>`, `--no-hooks`, and `--no-rules`.

## Project Structure

```text
src/
  index.ts
  llm/openai-compatible.ts
  agent/hooks.ts
  agent/loop.ts
  agent/project-rules.ts
  agent/session-trace.ts
  tools/read-file.ts
  tools/list-files.ts
  tools/glob.ts
  tools/grep.ts
  tools/bash.ts
  tools/edit-file.ts
  tools/index.ts
  permissions/confirm.ts
  permissions/confirm-edit.ts
```

## Roadmap

- Add richer conversation state and tracing.
- Add more filesystem and shell tools.
- Add explicit permission checks before side effects.
- Add streaming model responses.
- Add tests for providers, CLI parsing, and more agent loop behavior.
- Polish npm publishing metadata.
