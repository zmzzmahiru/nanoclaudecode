import { readFile } from "node:fs/promises";

import type { PermissionPolicy } from "../config.js";
import { resolveInsideProject } from "./path-safety.js";

export interface ToolResult {
  success: boolean;
  output: string;
  error: string | null;
}

export interface ToolContext {
  projectRoot: string;
  permissionPolicy?: PermissionPolicy;
  maxToolOutputChars?: number;
  commandTimeoutMs?: number;
  verifyAfterEdit?: string[];
}

export interface ReadFileArgs {
  path: string;
}

export async function readFileTool(
  args: ReadFileArgs,
  context: ToolContext,
): Promise<ToolResult> {
  try {
    if (!args.path) {
      throw new Error("Missing required argument: path");
    }

    const filePath = await resolveInsideProject(context.projectRoot, args.path);
    const output = await readFile(filePath, "utf8");

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
