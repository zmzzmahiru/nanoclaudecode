const DEFAULT_MAX_TEXT_LENGTH = 4_000;

const SECRET_ENV_NAME_PATTERN = /(?:KEY|TOKEN|SECRET|PASSWORD)/i;

export function capAndRedact(
  value: string,
  maxLength: number = DEFAULT_MAX_TEXT_LENGTH,
  suffix = "\n... trace content truncated",
): string {
  const redacted = redactSensitiveText(value);

  if (redacted.length <= maxLength) {
    return redacted;
  }

  return `${redacted.slice(0, maxLength)}${suffix}`;
}

export function redactSensitiveText(value: string): string {
  let redacted = value;

  for (const [name, secret] of Object.entries(process.env)) {
    if (
      SECRET_ENV_NAME_PATTERN.test(name) &&
      typeof secret === "string" &&
      secret.length > 3
    ) {
      redacted = redacted.split(secret).join("<redacted>");
    }
  }

  redacted = redacted.replace(
    /\b([A-Z0-9_]*(?:API[_-]?KEY|KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|[^\s\\]+)/gi,
    "$1=<redacted>",
  );

  redacted = redacted.replace(
    /\b(Authorization:\s*)?Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    (_match, prefix: string | undefined) => `${prefix ?? ""}Bearer <redacted>`,
  );

  redacted = redacted.replace(
    /\b(?=[A-Za-z0-9_-]{40,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{40,}\b/g,
    "<redacted-secret-like-value>",
  );

  return redacted;
}
