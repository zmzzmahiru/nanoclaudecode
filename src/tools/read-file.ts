import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

export interface ToolResult {
  success: boolean;
  output: string;
  error: string | null;
}

export interface ToolContext {
  projectRoot: string;
}

export interface ReadFileArgs {
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
