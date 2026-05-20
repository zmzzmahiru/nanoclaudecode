import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_IGNORED_DIRS,
  isInsideProject,
  resolveInsideProject,
  resolveProjectRoot,
  toProjectPath,
} from "./path-safety.js";
import type { ToolContext, ToolResult } from "./read-file.js";

export interface GrepArgs {
  pattern: string;
  path?: string;
}

const MAX_RESULTS = 100;
const MAX_SNIPPET_LENGTH = 160;

async function collectFiles(
  root: string,
  currentPath: string,
  files: string[],
): Promise<void> {
  const currentStat = await stat(currentPath);

  if (currentStat.isFile()) {
    const realFilePath = await realpath(currentPath);
    if (isInsideProject(root, realFilePath)) {
      files.push(realFilePath);
    }
    return;
  }

  if (!currentStat.isDirectory()) {
    return;
  }

  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (DEFAULT_IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) {
      continue;
    }

    await collectFiles(root, path.join(currentPath, entry.name), files);
  }
}

function isTextBuffer(buffer: Buffer): boolean {
  return !buffer.includes(0);
}

function formatSnippet(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, MAX_SNIPPET_LENGTH);
}

export async function grepTool(
  args: GrepArgs,
  context: ToolContext,
): Promise<ToolResult> {
  try {
    if (!args.pattern) {
      throw new Error("Missing required argument: pattern");
    }

    const root = await resolveProjectRoot(context.projectRoot);
    const searchPath = await resolveInsideProject(context.projectRoot, args.path || ".");
    const files: string[] = [];
    const results: string[] = [];

    await collectFiles(root, searchPath, files);

    for (const filePath of files.sort()) {
      const buffer = await readFile(filePath);
      if (!isTextBuffer(buffer)) {
        continue;
      }

      const lines = buffer.toString("utf8").split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (!line.includes(args.pattern)) {
          continue;
        }

        const relativePath = toProjectPath(path.relative(root, filePath));
        results.push(`${relativePath}:${index + 1}: ${formatSnippet(line)}`);

        if (results.length >= MAX_RESULTS) {
          return {
            success: true,
            output: `${results.join("\n")}\n... results truncated`,
            error: null,
          };
        }
      }
    }

    return {
      success: true,
      output: results.join("\n"),
      error: null,
    };
  } catch (error: unknown) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
