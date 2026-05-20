import { readdir } from "node:fs/promises";

import { resolveInsideProject } from "./path-safety.js";
import type { ToolContext, ToolResult } from "./read-file.js";

export interface ListFilesArgs {
  path: string;
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
