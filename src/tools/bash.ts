import { exec } from "node:child_process";

import {
  configToPermissionPolicy,
  DEFAULT_CONFIG,
  type PermissionPolicy,
} from "../config.js";
import { confirm } from "../permissions/confirm.js";
import { capAndRedact } from "../redaction.js";
import { resolveProjectRoot } from "./path-safety.js";
import type { ToolContext, ToolResult } from "./read-file.js";

export interface BashArgs {
  command: string;
  cwd?: string;
}

export type CommandDecision = "allow" | "confirm" | "deny";

interface CommandResult {
  command: string;
  decision: CommandDecision;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error: string | null;
}

interface ExecError extends Error {
  code?: number | string;
  signal?: string;
  killed?: boolean;
}

export const DEFAULT_POLICY: PermissionPolicy =
  configToPermissionPolicy(DEFAULT_CONFIG);

const MAX_EXEC_BUFFER = 2 * 1024 * 1024;

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}

function stripCommandPunctuation(value: string): string {
  return value.replace(/^[;&|()]+|[;&|()]+$/g, "");
}

function commandParts(command: string): string[] {
  return normalizeCommand(command)
    .split(/[;&|]+/)
    .map((part) => stripCommandPunctuation(part.trim()))
    .filter(Boolean);
}

function matchesRule(commandPart: string, rule: string): boolean {
  const normalizedRule = normalizeCommand(rule);
  return (
    commandPart === normalizedRule ||
    commandPart.startsWith(`${normalizedRule} `)
  );
}

function matchesAnyRule(command: string, rules: string[]): boolean {
  const parts = commandParts(command);
  return parts.some((part) => rules.some((rule) => matchesRule(part, rule)));
}

export function decideCommand(
  command: string,
  policy: PermissionPolicy = DEFAULT_POLICY,
): CommandDecision {
  if (matchesAnyRule(command, policy.deny)) {
    return "deny";
  }

  if (matchesAnyRule(command, policy.allow)) {
    return "allow";
  }

  if (matchesAnyRule(command, policy.confirm)) {
    return "confirm";
  }

  return "confirm";
}

function formatOutput(result: CommandResult): string {
  return JSON.stringify(result, null, 2);
}

function rejectedResult(
  command: string,
  decision: CommandDecision,
  error: string,
): ToolResult {
  return {
    success: false,
    output: formatOutput({
      command,
      decision,
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error,
    }),
    error,
  };
}

function runCommand(
  command: string,
  cwd: string,
  decision: CommandDecision,
  timeoutMs: number,
  maxOutputChars: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_EXEC_BUFFER,
      },
      (error: ExecError | null, stdout, stderr) => {
        const timedOut = error?.killed === true || error?.signal === "SIGTERM";
        const exitCode =
          typeof error?.code === "number" ? error.code : error ? 1 : 0;

        resolve({
          command,
          decision,
          exitCode,
          stdout: capAndRedact(stdout, maxOutputChars, "\n... output truncated"),
          stderr: capAndRedact(stderr, maxOutputChars, "\n... output truncated"),
          timedOut,
          error:
            exitCode === 0
              ? null
              : timedOut
                ? `Command timed out after ${timeoutMs}ms.`
                : `Command exited with code ${exitCode}.`,
        });
      },
    );
  });
}

export async function bashTool(
  args: BashArgs,
  context: ToolContext,
): Promise<ToolResult> {
  const command = args.command ?? "";

  try {
    if (!command) {
      throw new Error("Missing required argument: command");
    }

    const policy = context.permissionPolicy ?? DEFAULT_POLICY;
    const timeoutMs = context.commandTimeoutMs ?? DEFAULT_CONFIG.verify.timeoutMs;
    const maxToolOutputChars =
      context.maxToolOutputChars ?? DEFAULT_CONFIG.agent.maxToolOutputChars;
    const decision = decideCommand(command, policy);

    if (decision === "deny") {
      return rejectedResult(command, decision, "Command denied by policy.");
    }

    const cwd = await resolveProjectRoot(context.projectRoot);

    if (decision === "confirm") {
      const approved = await confirm(`[bash] Run command in ${cwd}: ${command}`);

      if (!approved) {
        return rejectedResult(command, decision, "Command rejected by user.");
      }
    }

    const result = await runCommand(
      command,
      cwd,
      decision,
      timeoutMs,
      maxToolOutputChars,
    );

    return {
      success: result.exitCode === 0,
      output: formatOutput(result),
      error: result.error,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return rejectedResult(command, "confirm", message);
  }
}
