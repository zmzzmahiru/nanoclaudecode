import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

import type { ToolContext, ToolResult } from "./read-file.js";

export interface ListFilesArgs {
  path: string;
}

async function resolveInsideProject(
  projectRoot: string,
  requestedPath: string,
): Promise<string> {
  const root = await realpath(projectRoot);
  const target = await realpath(path.resolve(root, requestedPath));

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path is outside the project root: ${requestedPath}`);
  }

  return target;
}

export async function listFilesTool(
  args: ListFilesArgs,
  context: ToolContext,
): Promise<ToolResult> {
  try {
    const requestedPath = args.path || ".";
    const directoryPath = await resolveInsideProject(context.projectRoot, requestedPath);
    const entries = await readdir(directoryPath, { withFileTypes: true });

    const output = entries
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
      .sort()
      .join("\n");

    return {
      success: true,
      output,
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
