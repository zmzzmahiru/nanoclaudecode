import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  assertSafeRelativePattern,
  DEFAULT_IGNORED_DIRS,
  isInsideProject,
  resolveProjectRoot,
  toProjectPath,
} from "./path-safety.js";
import type { ToolContext, ToolResult } from "./read-file.js";

export interface GlobArgs {
  pattern: string;
}

const MAX_RESULTS = 500;

function escapeRegExp(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

function globPatternToRegExp(pattern: string): RegExp {
  let regex = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      const afterGlobstar = pattern[index + 2];
      if (afterGlobstar === "/") {
        regex += "(?:.*/)?";
        index += 2;
      } else {
        regex += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += escapeRegExp(char ?? "");
  }

  return new RegExp(`^${regex}$`);
}

async function walkFiles(
  root: string,
  currentDirectory: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (DEFAULT_IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) {
      continue;
    }

    const fullPath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      await walkFiles(root, fullPath, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const realFilePath = await realpath(fullPath);
    if (!isInsideProject(root, realFilePath)) {
      continue;
    }

    files.push(toProjectPath(path.relative(root, realFilePath)));
  }
}

export async function globTool(
  args: GlobArgs,
  context: ToolContext,
): Promise<ToolResult> {
  try {
    if (!args.pattern) {
      throw new Error("Missing required argument: pattern");
    }

    const pattern = assertSafeRelativePattern(args.pattern);
    const matcher = globPatternToRegExp(pattern);
    const root = await resolveProjectRoot(context.projectRoot);
    const files: string[] = [];

    await walkFiles(root, root, files);

    const matches = files.filter((filePath) => matcher.test(filePath)).sort();
    const capped = matches.slice(0, MAX_RESULTS);
    const suffix = matches.length > MAX_RESULTS ? "\n... results truncated" : "";

    return {
      success: true,
      output: `${capped.join("\n")}${suffix}`,
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
