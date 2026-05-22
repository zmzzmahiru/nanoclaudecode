import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { confirmEdit } from "../permissions/confirm-edit.js";
import { bashTool } from "./bash.js";
import {
  resolveInsideProject,
  resolveProjectRoot,
  toProjectPath,
} from "./path-safety.js";
import type { ToolContext, ToolResult } from "./read-file.js";

export type EditFileArgs =
  {
    path: string;
    oldText: string;
    newText: string;
    reason: string;
  };

interface EditFileOutput {
  path: string;
  applied: boolean;
  reason: string;
  diff: string;
  approval: EditApproval;
  verification: EditVerification;
  error: string | null;
}

interface EditApproval {
  mode: "manual" | "auto" | "not_required";
  approved: boolean;
}

interface EditVerification {
  ran: boolean;
  results: VerificationResult[];
  passed: boolean;
  message?: string;
}

interface VerificationResult {
  command: string;
  decision: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error: string | null;
}

const DIFF_CONTEXT_LINES = 3;

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let index = text.indexOf(search);

  while (index !== -1) {
    count += 1;
    index = text.indexOf(search, index + search.length);
  }

  return count;
}

function buildReplacement(original: string, args: EditFileArgs): string {
  if (!args.oldText) {
    throw new Error("oldText must not be empty.");
  }

  const occurrences = countOccurrences(original, args.oldText);

  if (occurrences === 0) {
    throw new Error("oldText was not found in the file.");
  }

  if (occurrences > 1) {
    throw new Error("oldText appears multiple times. Provide a more specific oldText.");
  }

  return original.replace(args.oldText, args.newText);
}

function formatOutput(output: EditFileOutput): string {
  return JSON.stringify(output, null, 2);
}

function noVerification(message = "Verification was not run."): EditVerification {
  return {
    ran: false,
    results: [],
    passed: true,
    message,
  };
}

function failedResult(input: {
  path: string;
  reason: string;
  error: string;
  diff?: string;
  approval?: EditApproval;
}): ToolResult {
  return {
    success: false,
    output: formatOutput({
      path: input.path,
      applied: false,
      reason: input.reason,
      diff: input.diff ?? "",
      approval: input.approval ?? {
        mode: "not_required",
        approved: false,
      },
      verification: noVerification(),
      error: input.error,
    }),
    error: input.error,
  };
}

function formatRange(startLine: number, lineCount: number): string {
  return `${startLine},${Math.max(lineCount, 1)}`;
}

function createUnifiedDiff(
  relativePath: string,
  original: string,
  updated: string,
): string {
  const oldLines = splitLines(original);
  const newLines = splitLines(updated);

  let prefixLength = 0;
  while (
    prefixLength < oldLines.length &&
    prefixLength < newLines.length &&
    oldLines[prefixLength] === newLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < oldLines.length - prefixLength &&
    suffixLength < newLines.length - prefixLength &&
    oldLines[oldLines.length - 1 - suffixLength] ===
      newLines[newLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const oldStart = Math.max(prefixLength - DIFF_CONTEXT_LINES, 0);
  const newStart = Math.max(prefixLength - DIFF_CONTEXT_LINES, 0);
  const oldEnd = Math.min(
    oldLines.length - suffixLength + DIFF_CONTEXT_LINES,
    oldLines.length,
  );
  const newEnd = Math.min(
    newLines.length - suffixLength + DIFF_CONTEXT_LINES,
    newLines.length,
  );

  const oldChangedStart = prefixLength;
  const oldChangedEnd = oldLines.length - suffixLength;
  const newChangedStart = prefixLength;
  const newChangedEnd = newLines.length - suffixLength;

  const diffLines = [
    `--- ${relativePath}`,
    `+++ ${relativePath}`,
    `@@ -${formatRange(oldStart + 1, oldEnd - oldStart)} +${formatRange(
      newStart + 1,
      newEnd - newStart,
    )} @@`,
  ];

  for (let index = oldStart; index < oldChangedStart; index += 1) {
    diffLines.push(` ${oldLines[index] ?? ""}`);
  }

  for (let index = oldChangedStart; index < oldChangedEnd; index += 1) {
    diffLines.push(`-${oldLines[index] ?? ""}`);
  }

  for (let index = newChangedStart; index < newChangedEnd; index += 1) {
    diffLines.push(`+${newLines[index] ?? ""}`);
  }

  for (let index = oldChangedEnd; index < oldEnd; index += 1) {
    diffLines.push(` ${oldLines[index] ?? ""}`);
  }

  return diffLines.join("\n");
}

async function runVerification(
  context: ToolContext,
): Promise<EditVerification> {
  const commands = context.verifyAfterEdit ?? [];

  if (commands.length === 0) {
    return noVerification("No verification configured.");
  }

  const results: VerificationResult[] = [];

  for (const command of commands) {
    console.log(`[hook] after_edit: ${command}`);
    const result = await bashTool({ command, cwd: "." }, context);
    const parsed = parseVerificationResult(command, result.output, result.error);
    results.push(parsed);
    console.log(`[hook_result] after_edit success=${result.success}`);

    if (!result.success) {
      if (result.error) {
        console.log(`[hook_result] after_edit error=${result.error}`);
      }

      return {
        ran: true,
        results,
        passed: false,
      };
    }
  }

  return {
    ran: true,
    results,
    passed: true,
  };
}

function parseVerificationResult(
  command: string,
  output: string,
  error: string | null,
): VerificationResult {
  try {
    const parsed = JSON.parse(output) as Partial<VerificationResult>;
    return {
      command: parsed.command ?? command,
      decision: parsed.decision ?? "confirm",
      exitCode: parsed.exitCode ?? null,
      stdout: parsed.stdout ?? "",
      stderr: parsed.stderr ?? "",
      timedOut: parsed.timedOut ?? false,
      error: parsed.error ?? error,
    };
  } catch {
    return {
      command,
      decision: "confirm",
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: error ?? "Unable to parse verification result.",
    };
  }
}

async function approveEdit(
  relativePath: string,
  diff: string,
  context: ToolContext,
): Promise<EditApproval> {
  if (context.autoApproveEdits) {
    console.log(`[edit_file] Auto-approved patch for ${relativePath}`);
    return {
      mode: "auto",
      approved: true,
    };
  }

  return {
    mode: "manual",
    approved: await confirmEdit(relativePath, diff),
  };
}

export async function editFileTool(
  args: EditFileArgs,
  context: ToolContext,
): Promise<ToolResult> {
  const requestedPath = args.path ?? "";
  const reason = args.reason ?? "";

  try {
    if (!requestedPath) {
      throw new Error("Missing required argument: path");
    }

    if (path.isAbsolute(requestedPath)) {
      throw new Error(`Absolute paths are not allowed: ${requestedPath}`);
    }

    if (!args.reason) {
      throw new Error("Missing required argument: reason");
    }

    if (typeof args.oldText !== "string" || typeof args.newText !== "string") {
      throw new Error("edit_file requires path, oldText, newText, and reason.");
    }

    const root = await resolveProjectRoot(context.projectRoot);
    const filePath = await resolveInsideProject(context.projectRoot, requestedPath);
    const original = await readFile(filePath, "utf8");
    const updated = buildReplacement(original, args);
    const relativePath = toProjectPath(path.relative(root, filePath));

    if (updated === original) {
      return {
        success: true,
        output: formatOutput({
          path: relativePath,
          applied: false,
          reason,
          diff: "",
          approval: {
            mode: "not_required",
            approved: false,
          },
          verification: noVerification("No file change was needed."),
          error: null,
        }),
        error: null,
      };
    }

    const diff = createUnifiedDiff(relativePath, original, updated);
    const approval = await approveEdit(relativePath, diff, context);

    if (!approval.approved) {
      return failedResult({
        path: relativePath,
        reason,
        diff,
        approval,
        error: "Edit rejected by user.",
      });
    }

    await writeFile(filePath, updated, "utf8");
    const verification = await runVerification(context);
    const verificationError = verification.passed
      ? null
      : `Verification failed for command: ${
          verification.results.at(-1)?.command ?? "unknown"
        }`;

    return {
      success: verification.passed,
      output: formatOutput({
        path: relativePath,
        applied: true,
        reason,
        diff,
        approval,
        verification,
        error: verificationError,
      }),
      error: verificationError,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failedResult({
      path: requestedPath,
      reason,
      error: message,
    });
  }
}
