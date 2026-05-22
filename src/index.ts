#!/usr/bin/env node
import "dotenv/config";

import { fileURLToPath } from "node:url";

import type { AgentLoopInput } from "./agent/loop.js";
import { runAgent } from "./agent/loop.js";
import { createOpenAICompatibleProvider } from "./llm/openai-compatible.js";

export interface CliOptions {
  task: string;
  help: boolean;
  version: boolean;
  hooksEnabled: boolean;
  rulesEnabled: boolean;
  autoApproveEdits: boolean;
  maxIterations?: number;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const taskParts: string[] = [];
  const options: CliOptions = {
    task: "",
    help: false,
    version: false,
    hooksEnabled: true,
    rulesEnabled: true,
    autoApproveEdits: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      options.version = true;
      continue;
    }

    if (arg === "--no-hooks") {
      options.hooksEnabled = false;
      continue;
    }

    if (arg === "--no-rules") {
      options.rulesEnabled = false;
      continue;
    }

    if (arg === "--auto-approve-edits") {
      options.autoApproveEdits = true;
      continue;
    }

    if (arg === "--max-iterations") {
      const value = argv[index + 1];
      const parsed = Number(value);

      if (!value || !Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--max-iterations requires a positive integer.");
      }

      options.maxIterations = parsed;
      index += 1;
      continue;
    }

    taskParts.push(arg ?? "");
  }

  options.task = taskParts.join(" ").trim();
  return options;
}

function helpText(): string {
  return `NanoClaude

Usage:
  nanoclaude [options] "your task here"
  npm run dev -- [options] "your task here"

Options:
  --help                 Show this help message
  --version              Show the package version
  --max-iterations <n>   Override the agent iteration limit
  --no-hooks             Disable automatic hooks such as after_edit build checks
  --no-rules             Do not load NANOCLAUDE.md, AGENTS.md, or CLAUDE.md
  --auto-approve-edits   Apply edit_file patches without prompting; intended for eval/CI workspaces
`;
}

async function packageVersion(): Promise<string> {
  const packageJson = await import("../package.json", {
    with: { type: "json" },
  });

  return packageJson.default.version as string;
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv);

  if (options.help) {
    console.log(helpText());
    return;
  }

  if (options.version) {
    console.log(await packageVersion());
    return;
  }

  if (!options.task) {
    console.error(helpText());
    process.exitCode = 1;
    return;
  }

  const provider = createOpenAICompatibleProvider();
  const agentInput: AgentLoopInput = {
    task: options.task,
    llm: provider,
    hooksEnabled: options.hooksEnabled,
    rulesEnabled: options.rulesEnabled,
    autoApproveEdits: options.autoApproveEdits,
  };

  if (options.maxIterations !== undefined) {
    agentInput.maxIterations = options.maxIterations;
  }

  const response = await runAgent(agentInput);

  console.log(response);
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (process.argv[1] && entryPath === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`NanoClaude failed: ${message}`);
    process.exitCode = 1;
  });
}
