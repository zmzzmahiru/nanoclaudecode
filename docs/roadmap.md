# NanoClaude Roadmap

## Completed Milestones

| Milestone | Summary |
| --- | --- |
| v0 | Node.js and TypeScript project setup |
| v1 | JSON-based tool calling with `read_file` and `list_files` |
| v2 | Codebase search with `glob` and `grep` |
| v3 | Permission-controlled `bash` tool |
| v4 | Safe `edit_file` with unified diff preview |
| v5 | Todo / Plan Mode with in-memory progress tracking |
| v6 | Project rules loading from `NANOCLAUDE.md`, `AGENTS.md`, or `CLAUDE.md` |
| v7 | Redacted session trace logging |
| v8 | `after_edit` verification hook |
| v9 | Vitest suite for core non-LLM logic |
| v10 | Packaged CLI with help, version, iteration, hook, and rules flags |
| v11 | Documentation, demo material, examples, and GitHub polish |
| Phase 3 | `nanoclaude.config.json`, configurable verification, permission policy wiring, and improved traces |
| Phase 4 | Local five-task eval harness and explicit edit auto-approval for eval/CI workspaces |

## Future Ideas

### Skills

Add reusable task recipes, such as "review code", "add tests", or "prepare release notes", that can inject specialized instructions and workflows.

### Resumable Sessions

Allow a saved session trace to be reloaded so an agent can continue from previous context with explicit user consent.

### Config Evolution

Extend `nanoclaude.config.json` with more explicit ignore patterns, per-tool limits, and named profiles while keeping defaults easy to audit.

### Richer Patch Editing

Support structured patches or multi-file edits while keeping diff previews and approval gates.

### Sandbox / Container Mode

Run commands inside a constrained environment for stronger safety around build scripts and test execution.

### Multi-Provider Benchmarks

Compare OpenAI-compatible providers on tool-call reliability, JSON formatting, latency, and cost across the same benchmark prompts.

## Non-Goals For Now

- Hiding permission prompts behind automation
- Building a large plugin system before the core stays simple
- Storing API keys or raw `.env` contents in traces
- Replacing established tools such as Git or package managers
