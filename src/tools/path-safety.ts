import { realpath } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_IGNORED_DIRS = new Set(["node_modules", "dist"]);

export function toProjectPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function isInsideProject(projectRoot: string, targetPath: string): boolean {
  return targetPath === projectRoot || targetPath.startsWith(`${projectRoot}${path.sep}`);
}

export async function resolveProjectRoot(projectRoot: string): Promise<string> {
  return realpath(projectRoot);
}

export async function resolveInsideProject(
  projectRoot: string,
  requestedPath: string,
): Promise<string> {
  const root = await resolveProjectRoot(projectRoot);
  const target = await realpath(path.resolve(root, requestedPath));

  if (!isInsideProject(root, target)) {
    throw new Error(`Path is outside the project root: ${requestedPath}`);
  }

  return target;
}

export function assertSafeRelativePattern(pattern: string): string {
  const normalized = toProjectPath(pattern.trim()).replace(/^\.\//, "");

  if (!normalized) {
    throw new Error("Missing required argument: pattern");
  }

  if (path.isAbsolute(pattern) || normalized.split("/").includes("..")) {
    throw new Error(`Pattern is outside the project root: ${pattern}`);
  }

  return normalized;
}
