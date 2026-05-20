import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ProjectRules {
  fileName: string;
  content: string;
}

const RULE_FILE_PRIORITY = ["NANOCLAUDE.md", "AGENTS.md", "CLAUDE.md"];
const MAX_RULE_CONTENT_LENGTH = 12_000;

export async function loadProjectRules(
  projectRoot: string,
): Promise<ProjectRules | null> {
  for (const fileName of RULE_FILE_PRIORITY) {
    try {
      const filePath = path.join(projectRoot, fileName);
      const content = await readFile(filePath, "utf8");

      return {
        fileName,
        content: content.slice(0, MAX_RULE_CONTENT_LENGTH),
      };
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

      if (code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  return null;
}
