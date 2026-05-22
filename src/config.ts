import { readFile } from "node:fs/promises";
import path from "node:path";

export interface PermissionPolicy {
  allow: string[];
  confirm: string[];
  deny: string[];
}

export interface NanoClaudeConfig {
  verify: {
    afterEdit: string[];
    timeoutMs: number;
  };
  permissions: {
    allowCommands: string[];
    confirmCommands: string[];
    denyCommands: string[];
  };
  agent: {
    maxSteps: number;
    maxToolOutputChars: number;
  };
}

export const CONFIG_FILE_NAME = "nanoclaude.config.json";

export const DEFAULT_CONFIG: NanoClaudeConfig = {
  verify: {
    afterEdit: ["npm test", "npm run build"],
    timeoutMs: 30_000,
  },
  permissions: {
    allowCommands: [
      "pwd",
      "ls",
      "cat",
      "grep",
      "find",
      "npm test",
      "npm run build",
      "npx tsc",
      "pytest",
    ],
    confirmCommands: [
      "npm install",
      "pnpm install",
      "yarn install",
      "git checkout",
      "git commit",
      "git reset",
      "rm",
      "mv",
      "cp",
    ],
    denyCommands: ["sudo", "ssh", "scp", "curl", "wget", "chmod 777", "chown"],
  },
  agent: {
    maxSteps: 20,
    maxToolOutputChars: 12_000,
  },
};

type PartialConfig = {
  verify?: Partial<NanoClaudeConfig["verify"]>;
  permissions?: Partial<NanoClaudeConfig["permissions"]>;
  agent?: Partial<NanoClaudeConfig["agent"]>;
};

export function configToPermissionPolicy(
  config: NanoClaudeConfig,
): PermissionPolicy {
  return {
    allow: config.permissions.allowCommands,
    confirm: config.permissions.confirmCommands,
    deny: config.permissions.denyCommands,
  };
}

export async function loadConfig(projectRoot: string): Promise<NanoClaudeConfig> {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error: unknown) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return structuredClone(DEFAULT_CONFIG);
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${CONFIG_FILE_NAME} contains malformed JSON: ${message}`);
  }

  validatePartialConfig(parsed);
  return mergeConfig(parsed);
}

function mergeConfig(config: PartialConfig): NanoClaudeConfig {
  return {
    verify: {
      afterEdit: config.verify?.afterEdit ?? DEFAULT_CONFIG.verify.afterEdit,
      timeoutMs: config.verify?.timeoutMs ?? DEFAULT_CONFIG.verify.timeoutMs,
    },
    permissions: {
      allowCommands:
        config.permissions?.allowCommands ??
        DEFAULT_CONFIG.permissions.allowCommands,
      confirmCommands:
        config.permissions?.confirmCommands ??
        DEFAULT_CONFIG.permissions.confirmCommands,
      denyCommands:
        config.permissions?.denyCommands ??
        DEFAULT_CONFIG.permissions.denyCommands,
    },
    agent: {
      maxSteps: config.agent?.maxSteps ?? DEFAULT_CONFIG.agent.maxSteps,
      maxToolOutputChars:
        config.agent?.maxToolOutputChars ??
        DEFAULT_CONFIG.agent.maxToolOutputChars,
    },
  };
}

function validatePartialConfig(value: unknown): asserts value is PartialConfig {
  if (!isPlainObject(value)) {
    throw new Error(`${CONFIG_FILE_NAME} must contain a JSON object.`);
  }

  validateObjectField(value, "verify", validateVerifyConfig);
  validateObjectField(value, "permissions", validatePermissionsConfig);
  validateObjectField(value, "agent", validateAgentConfig);
}

function validateVerifyConfig(value: Record<string, unknown>): void {
  validateStringArrayField(value, "afterEdit");
  validatePositiveNumberField(value, "timeoutMs");
}

function validatePermissionsConfig(value: Record<string, unknown>): void {
  validateStringArrayField(value, "allowCommands");
  validateStringArrayField(value, "confirmCommands");
  validateStringArrayField(value, "denyCommands");
}

function validateAgentConfig(value: Record<string, unknown>): void {
  validatePositiveIntegerField(value, "maxSteps");
  validatePositiveIntegerField(value, "maxToolOutputChars");
}

function validateObjectField(
  parent: Record<string, unknown>,
  fieldName: string,
  validate: (value: Record<string, unknown>) => void,
): void {
  const value = parent[fieldName];
  if (value === undefined) {
    return;
  }

  if (!isPlainObject(value)) {
    throw new Error(`${fieldName} must be an object in ${CONFIG_FILE_NAME}.`);
  }

  validate(value);
}

function validateStringArrayField(
  parent: Record<string, unknown>,
  fieldName: string,
): void {
  const value = parent[fieldName];
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} must be an array of strings in ${CONFIG_FILE_NAME}.`);
  }
}

function validatePositiveIntegerField(
  parent: Record<string, unknown>,
  fieldName: string,
): void {
  const value = parent[fieldName];
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`${fieldName} must be a positive integer in ${CONFIG_FILE_NAME}.`);
  }
}

function validatePositiveNumberField(
  parent: Record<string, unknown>,
  fieldName: string,
): void {
  const value = parent[fieldName];
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive number in ${CONFIG_FILE_NAME}.`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
