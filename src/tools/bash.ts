import { exec } from "node:child_process";

import { confirm } from "../permissions/confirm.js";
import { resolveInsideProject } from "./path-safety.js";
import type { ToolContext, ToolResult } from "./read-file.js";

export interface BashArgs {
  command: string;
  cwd?: string;
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface ExecError extends Error {
  code?: number | string;
  signal?: string;
}

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 12_000;
const MAX_EXEC_BUFFER = 2 * 1024 * 1024;

const HIGH_RISK_PATTERNS = [
  /(^|\s)(rm|del|erase)\s+.*(?:-r|-f|\/s|\*)/i,
  /(^|\s)(rmdir|rd)\s+.*(?:\/s|-r)/i,
  /(^|\s)remove-item\b.*(?:-recurse|-force)/i,
  /(^|\s)git\s+reset\s+--hard\b/i,
  /(^|\s)git\s+clean\b/i,
  /(^|\s)(shutdown|reboot|halt|poweroff|format|mkfs)\b/i,
  /(^|\s)(sudo|su)\b/i,
  /(^|\s)(chmod|chown)\s+-R\b/i,
  /\b(curl|wget)\b.*\|\s*(sh|bash|powershell|pwsh|cmd)\b/i,
];

function capOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_OUTPUT_LENGTH)}\n... output truncated`;
}

function isHighRiskCommand(command: string): boolean {
  return HIGH_RISK_PATTERNS.some((pattern) => pattern.test(command));
}

function runCommand(command: string, cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_EXEC_BUFFER,
      },
      (error: ExecError | null, stdout, stderr) => {
        const exitCode =
          typeof error?.code === "number" ? error.code : error ? 1 : 0;

        resolve({
          exitCode,
          stdout: capOutput(stdout),
          stderr: capOutput(stderr),
        });
      },
    );
  });
}

export async function bashTool(
  args: BashArgs,
  context: ToolContext,
): Promise<ToolResult> {
  try {
    if (!args.command) {
      throw new Error("Missing required argument: command");
    }

    if (isHighRiskCommand(args.command)) {
      throw new Error("Command rejected because it looks high risk.");
    }

    const cwd = await resolveInsideProject(context.projectRoot, args.cwd || ".");
    const approved = await confirm(`[bash] Run command in ${cwd}: ${args.command}`);

    if (!approved) {
      return {
        success: false,
        output: "",
        error: "Command rejected by user.",
      };
    }

    const result = await runCommand(args.command, cwd);

    return {
      success: result.exitCode === 0,
      output: JSON.stringify(result, null, 2),
      error:
        result.exitCode === 0
          ? null
          : `Command exited with code ${result.exitCode}.`,
    };
  } catch (error: unknown) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
